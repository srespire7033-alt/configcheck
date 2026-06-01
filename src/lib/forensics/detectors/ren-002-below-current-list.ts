/**
 * REN-002 — Renewal closed below current list price.
 *
 * The pattern: list prices increased (annual price book update,
 * inflation adjustment, repackaging) but the renewal quote inherited
 * last year's pricing — either because the rep reused the prior
 * QuoteLine NetPrice, or because the renewal logic didn't rebind to
 * the current PricebookEntry. Net effect: the company under-quoted
 * the renewal against the actual current list, leaving recurring $
 * on the table.
 *
 * Detection model:
 *   1. Pull every renewal Quote Line (SBQQ__Quote__r.SBQQ__Type__c='Renewal')
 *      from the last 24 months.
 *   2. Look up the current Standard Pricebook entry for each line's
 *      product.
 *   3. Compare line.SBQQ__NetPrice__c to entry.UnitPrice.
 *   4. If NetPrice < (UnitPrice × 0.90), flag with gap
 *      = (UnitPrice - NetPrice) × Quantity. The 10% tolerance is the
 *      negotiation room we don't want to false-positive on; tunable
 *      per-org later.
 *
 * What we deliberately don't flag:
 *   - Lines where the schedule's discount accounts for the gap
 *     (DSC-FOR-001 owns that path)
 *   - Lines with NetPrice ≥ 90% of current list (within negotiation
 *     tolerance)
 *   - Lines with $0 NetPrice (strategic-free; QL-FOR-002 territory)
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface RenewalLineRow {
  Id: string;
  Name: string;
  SBQQ__Quote__c: string;
  'SBQQ__Quote__r.Name': string;
  SBQQ__Product__c: string;
  'SBQQ__Product__r.Name': string;
  SBQQ__NetPrice__c: string;
  SBQQ__Quantity__c: string;
  SBQQ__PricingMethod__c?: string | null;
}

interface PricebookEntryRow {
  Id: string;
  Product2Id: string;
  UnitPrice: string;
  Pricebook2Id: string;
  IsActive: boolean;
}

// 10% negotiation tolerance — anything within 10% of current list is
// treated as "negotiated normally." Below 90% trips the detector.
// Aggressive customers may want this tighter (95%); customers with
// heavily-discounted SKUs may want it looser (75%). Keeping it
// configurable per-org is on the v1.5 roadmap; for now, 90% is the
// rule of thumb that matches the consultative pitch.
const LIST_PRICE_TOLERANCE = 0.9;

const REN_002: ForensicDetector = {
  id: 'REN-002',
  label: 'Renewal closed below current list price',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    const sinceIso = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Renewal quote lines in window. We include PricingMethod so the
    //    Class B tracer can assess manual-override confidence without
    //    a second query.
    const linesQuery = `
      SELECT Id, Name,
        SBQQ__Quote__c, SBQQ__Quote__r.Name,
        SBQQ__Product__c, SBQQ__Product__r.Name,
        SBQQ__NetPrice__c, SBQQ__Quantity__c,
        SBQQ__PricingMethod__c
      FROM SBQQ__QuoteLine__c
      WHERE SBQQ__Quote__r.SBQQ__Type__c = 'Renewal'
        AND CreatedDate >= ${sinceIso}
        AND SBQQ__NetPrice__c > 0
    `;
    const linesRes = await ctx.conn.query<RenewalLineRow>(linesQuery);
    console.log(`[REN-002] Renewal lines query: ${linesRes.records.length} rows`);
    if (linesRes.records.length === 0) return [];

    // 2. Pull current Standard Pricebook entries for the affected
    //    products. Standard Pricebook is the canonical 'current list'
    //    — custom price books are out of scope for v1 (different leak
    //    scenario, REN-003 territory).
    const productIds = Array.from(new Set(linesRes.records.map((r) => r.SBQQ__Product__c).filter(Boolean)));
    const entriesByProductId = new Map<string, PricebookEntryRow>();
    if (productIds.length > 0) {
      // Chunk IN-clause to stay under SOQL string-length limits.
      for (let i = 0; i < productIds.length; i += 500) {
        const chunk = productIds.slice(i, i + 500);
        const entryQuery = `
          SELECT Id, Product2Id, UnitPrice, Pricebook2Id, IsActive
          FROM PricebookEntry
          WHERE Product2Id IN (${chunk.map((id) => `'${id}'`).join(',')})
            AND Pricebook2.IsStandard = TRUE
            AND IsActive = TRUE
        `;
        const entryRes = await ctx.conn.query<PricebookEntryRow>(entryQuery);
        for (const e of entryRes.records) entriesByProductId.set(e.Product2Id, e);
      }
      console.log(`[REN-002] Pricebook entries loaded: ${entriesByProductId.size}`);
    }

    // 3. Reconcile per-line.
    const findings: DetectorResult[] = [];
    for (const line of linesRes.records) {
      const entry = entriesByProductId.get(line.SBQQ__Product__c);
      if (!entry) continue; // No current list price → can't reconcile.

      const currentList = parseFloat(entry.UnitPrice || '0');
      const renewalPrice = parseFloat(line.SBQQ__NetPrice__c || '0');
      const quantity = parseFloat(line.SBQQ__Quantity__c || '1') || 1;
      if (currentList <= 0 || renewalPrice <= 0) continue;

      // Within negotiation tolerance — clean.
      if (renewalPrice >= currentList * LIST_PRICE_TOLERANCE) continue;

      const gap = (currentList - renewalPrice) * quantity;
      if (gap < 1) continue;

      const percentBelowList = ((currentList - renewalPrice) / currentList) * 100;

      const primaryRecord: SourceRecord = {
        type: 'SBQQ__QuoteLine__c',
        id: line.Id,
        name: line.Name,
        financials: {
          renewal_net_price: renewalPrice,
          current_list_price: currentList,
          quantity,
          gap_per_unit: currentList - renewalPrice,
          percent_below_list: Math.round(percentBelowList * 100) / 100,
        },
      };
      const supportingRecords: SourceRecord[] = [
        {
          type: 'SBQQ__Quote__c',
          id: line.SBQQ__Quote__c,
          name: line['SBQQ__Quote__r.Name'],
        },
        {
          type: 'PricebookEntry',
          id: entry.Id,
          name: `Standard list for ${line['SBQQ__Product__r.Name']}`,
          financials: {
            current_unit_price: currentList,
          },
        },
        {
          type: 'Product2',
          id: line.SBQQ__Product__c,
          name: line['SBQQ__Product__r.Name'] || line.SBQQ__Product__c,
        },
      ];

      findings.push({
        detectorId: 'REN-002',
        severity: gap >= 10_000 ? 'critical' : gap >= 1_000 ? 'warning' : 'info',
        entitledUsd: round2(currentList * quantity),
        realizedUsd: round2(renewalPrice * quantity),
        gapUsd: round2(gap),
        currencyIsoCode: ctx.defaultCurrencyIsoCode,
        // High recoverability — this is a price conversation on next
        // renewal cycle, not a clawback. Customer-facing it's "the
        // standard price for next term is X."
        recoverabilityScore: 0.85,
        primaryRecord,
        supportingRecords,
        title: `Renewal ${round2(percentBelowList)}% below current list for ${line['SBQQ__Product__r.Name'] || 'product'}`,
        description: `Quoted at ${ctx.defaultCurrencyIsoCode} ${renewalPrice.toLocaleString()}/unit vs current list of ${ctx.defaultCurrencyIsoCode} ${currentList.toLocaleString()}/unit.`,
        metadata: {
          current_list_price: currentList,
          renewal_net_price: renewalPrice,
          percent_below_list: percentBelowList,
          pricing_method: line.SBQQ__PricingMethod__c ?? null,
          tolerance_used: LIST_PRICE_TOLERANCE,
        },
      });
    }

    console.log(`[REN-002] Emitting ${findings.length} findings (sum gap = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`);
    return findings;
  },
};

export default REN_002;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
