/**
 * QL-FOR-001 — Bundle required option charged at $0.
 *
 * Pattern: a Bundle parent product has a required option that should
 * always be charged with the parent. The Quote Line for the option
 * gets NetPrice = 0 (rep edited manually, missing pricebook entry,
 * or a Price Rule wiped it). Customer received the option for free —
 * that's the leak.
 *
 * Why this needs bundle-aware guards (was previously disabled):
 *   Inclusive bundle pricing is legitimate — "starter kit $1000,
 *   includes free installation". The installation line will have
 *   NetPrice=0 and SBQQ__RequiredBy__c set. Without guards, the
 *   detector flags every legitimate inclusive bundle as a leak.
 *
 * Four guards (in order):
 *
 *   GUARD 1 — SBQQ__Bundled__c = true → SKIP
 *     CPQ itself sets this flag when the line's price is rolled up
 *     into the parent. Cleanest signal of "intentional free."
 *
 *   GUARD 2 — REMOVED in v2.
 *     The 'parent NetTotal >= option_expected × 0.95' heuristic was
 *     too greedy. A \$54K PC bundle being expensive doesn't mean a
 *     \$5K CPU option inside it is 'included' — they could be priced
 *     independently. SBQQ__Bundled__c (Guard 1) is the CPQ-native
 *     signal of intentional inclusion. The math-based check produced
 *     false negatives on real leakage in test orgs.
 *
 *   GUARD 3 — Product has no resolvable list price → emit as
 *             'unresolved_price' (low confidence)
 *     Same behavior as the v1 detector — Class E tracer reports
 *     this with OPTION_PRICE_UNRESOLVED reason code.
 *
 *   GUARD 4 — Product IS charged on other quote lines → boost
 *             confidence (HIGH)
 *     If the same Product2 has any other quote line with NetPrice>0,
 *     it CAN be charged. Being $0 here is suspect — strong signal
 *     of a real leak. Recoverability stays at 0.9, severity
 *     escalates per gap size.
 *
 *   No guard matches → emit as 'isolated_free_option' (moderate
 *     confidence — manual review, recoverability 0.6).
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface BundleOptionLineRow {
  Id: string;
  Name: string;
  SBQQ__Quote__c: string;
  SBQQ__Quote__r?: { Name: string };
  SBQQ__RequiredBy__c: string;
  SBQQ__RequiredBy__r?: { Id: string; SBQQ__NetTotal__c?: string | number | null };
  SBQQ__Product__c: string;
  SBQQ__Product__r?: { Name: string; SBQQ__ChargeType__c?: string | null };
  SBQQ__NetPrice__c: string;
  SBQQ__ListPrice__c: string;
  SBQQ__Quantity__c: string;
  SBQQ__Bundled__c?: boolean | null;
}

interface PricebookEntryRow {
  Id: string;
  Product2Id: string;
  UnitPrice: string;
}

interface PaidCountRow {
  SBQQ__Product__c: string;
  paid_count: number;
}

const QL_FOR_001: ForensicDetector = {
  id: 'QL-FOR-001',
  label: 'Bundle required option charged at $0',
  // Re-activated in Slice 13 with the 4-guard system above.
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'revenue_leakage',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    const sinceIso = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();

    // Probe for SBQQ__Bundled__c — present in most CPQ installs but
    // not guaranteed. If absent, Guard 1 silently skips (everything
    // falls through to other guards).
    let hasBundledField = false;
    try {
      const qlDesc = await ctx.conn.describe('SBQQ__QuoteLine__c');
      hasBundledField = (qlDesc.fields ?? []).some((f) => f.name === 'SBQQ__Bundled__c');
    } catch {
      hasBundledField = false;
    }

    // 1. Candidate lines: required-bundle-option with $0 net price.
    const bundledFieldSelect = hasBundledField ? 'SBQQ__Bundled__c,' : '';
    const linesRes = await ctx.conn.query<BundleOptionLineRow>(`
      SELECT Id, Name,
        SBQQ__Quote__c, SBQQ__Quote__r.Name,
        SBQQ__RequiredBy__c, SBQQ__RequiredBy__r.SBQQ__NetTotal__c,
        SBQQ__Product__c, SBQQ__Product__r.Name,
        SBQQ__NetPrice__c, SBQQ__ListPrice__c, SBQQ__Quantity__c,
        ${bundledFieldSelect}
        CreatedDate
      FROM SBQQ__QuoteLine__c
      WHERE SBQQ__RequiredBy__c != null
        AND SBQQ__NetPrice__c = 0
        AND CreatedDate >= ${sinceIso}
    `);
    console.log(`[QL-FOR-001] Candidate zero-price bundle-option lines: ${linesRes.records.length}`);
    if (linesRes.records.length === 0) return [];

    // 2. Pricebook list prices for those products.
    const productIds = Array.from(new Set(linesRes.records.map((l) => l.SBQQ__Product__c).filter(Boolean)));
    const pbeByProduct = new Map<string, PricebookEntryRow>();
    if (productIds.length > 0) {
      for (let i = 0; i < productIds.length; i += 500) {
        const chunk = productIds.slice(i, i + 500);
        const pbeRes = await ctx.conn.query<PricebookEntryRow>(`
          SELECT Id, Product2Id, UnitPrice
          FROM PricebookEntry
          WHERE Product2Id IN (${chunk.map((id) => `'${id}'`).join(',')})
            AND Pricebook2.IsStandard = TRUE
            AND IsActive = TRUE
        `);
        for (const e of pbeRes.records) pbeByProduct.set(e.Product2Id, e);
      }
    }

    // 3. GUARD 4 prep — count other quote lines per product with NetPrice > 0.
    //    These are the "this product CAN be paid" signals.
    const paidCountByProduct = new Map<string, number>();
    if (productIds.length > 0) {
      for (let i = 0; i < productIds.length; i += 500) {
        const chunk = productIds.slice(i, i + 500);
        const paidRes = await ctx.conn.query<PaidCountRow>(`
          SELECT SBQQ__Product__c, COUNT(Id) paid_count
          FROM SBQQ__QuoteLine__c
          WHERE SBQQ__Product__c IN (${chunk.map((id) => `'${id}'`).join(',')})
            AND SBQQ__NetPrice__c > 0
          GROUP BY SBQQ__Product__c
        `);
        for (const r of paidRes.records) {
          if (r.SBQQ__Product__c) paidCountByProduct.set(r.SBQQ__Product__c, Number(r.paid_count ?? 0));
        }
      }
    }

    // 4. Per-line evaluation through the guards.
    const findings: DetectorResult[] = [];
    let skippedByGuard1 = 0;

    for (const line of linesRes.records) {
      // GUARD 1: CPQ-declared bundled. Skip outright.
      if (hasBundledField && line.SBQQ__Bundled__c === true) {
        skippedByGuard1 += 1;
        continue;
      }

      const lineList = parseFloat(line.SBQQ__ListPrice__c || '0');
      const pbeList = parseFloat(pbeByProduct.get(line.SBQQ__Product__c)?.UnitPrice || '0');
      const resolvedList = pbeList > 0 ? pbeList : lineList;
      const quantity = parseFloat(line.SBQQ__Quantity__c || '1') || 1;
      const expectedRevenue = resolvedList * quantity;
      const parentNetTotal = Number(line.SBQQ__RequiredBy__r?.SBQQ__NetTotal__c ?? 0);

      // GUARD 3: no resolvable list price → emit as unresolved.
      if (resolvedList <= 0) {
        findings.push({
          detectorId: 'QL-FOR-001',
          severity: 'info',
          entitledUsd: 0,
          realizedUsd: 0,
          gapUsd: 0,
          currencyIsoCode: ctx.defaultCurrencyIsoCode,
          recoverabilityScore: 0.3,
          primaryRecord: lineRecord(line, 0),
          supportingRecords: supportingRecords(line, null),
          title: `Required bundle option "${line.SBQQ__Product__r?.Name ?? 'option'}" has no resolvable price`,
          description: `Quote line ${line.Name} is a required bundle option but neither the line nor the product carries a list price. Manual review needed.`,
          metadata: {
            sub_case: 'unresolved_price',
            line_list_price: lineList,
            product_list_price: pbeList,
            quantity,
            parent_net_total: parentNetTotal,
            paid_count_elsewhere: paidCountByProduct.get(line.SBQQ__Product__c) ?? 0,
          },
        });
        continue;
      }

      const gap = expectedRevenue;
      if (gap < 1) continue;

      // GUARD 4: Has this product been charged anywhere else?
      const paidCountElsewhere = paidCountByProduct.get(line.SBQQ__Product__c) ?? 0;
      const productPaidElsewhere = paidCountElsewhere > 0;

      // High-confidence leak vs moderate-confidence outlier:
      //   - Same product is paid elsewhere → strong signal it CAN be
      //     charged. Original behavior, full recoverability.
      //   - Same product is never paid anywhere → could be a "free
      //     options product" by design. Surface with lower confidence
      //     and tag for manual review.
      const isHighConfidence = productPaidElsewhere;

      findings.push({
        detectorId: 'QL-FOR-001',
        severity: gap >= 10_000 ? 'critical' : gap >= 1_000 ? 'warning' : 'info',
        entitledUsd: round2(gap),
        realizedUsd: 0,
        gapUsd: round2(gap),
        currencyIsoCode: ctx.defaultCurrencyIsoCode,
        recoverabilityScore: isHighConfidence ? 0.9 : 0.6,
        primaryRecord: lineRecord(line, gap),
        supportingRecords: supportingRecords(line, resolvedList),
        title: isHighConfidence
          ? `Required bundle option "${line.SBQQ__Product__r?.Name ?? 'option'}" given away free (${ctx.defaultCurrencyIsoCode} ${Math.round(gap).toLocaleString()})`
          : `Required bundle option "${line.SBQQ__Product__r?.Name ?? 'option'}" free on this Quote — paid status elsewhere unknown (${ctx.defaultCurrencyIsoCode} ${Math.round(gap).toLocaleString()})`,
        description: isHighConfidence
          ? `Quote line ${line.Name} is a required bundle option (linked to parent ${line.SBQQ__RequiredBy__c}) priced at $0. This product is paid on ${paidCountElsewhere} other line${paidCountElsewhere === 1 ? '' : 's'} — strong signal the $0 here is unintentional. Current list ${ctx.defaultCurrencyIsoCode} ${resolvedList.toLocaleString()}/unit × ${quantity}.`
          : `Quote line ${line.Name} is a required bundle option priced at $0. The product has never been charged on any other quote line, so the $0 may be by design. Manual review needed before treating as a leak.`,
        metadata: {
          sub_case: isHighConfidence ? 'price_override_missing' : 'isolated_free_option',
          line_list_price: lineList,
          product_list_price: pbeList,
          resolved_list_price: resolvedList,
          quantity,
          parent_net_total: parentNetTotal,
          paid_count_elsewhere: paidCountElsewhere,
          // Surface guard outcomes for transparency in the UI
          guards: {
            cpq_bundled: false,
            unresolved_price: false,
            product_paid_elsewhere: productPaidElsewhere,
          },
        },
      });
    }

    console.log(
      `[QL-FOR-001] Emitting ${findings.length} findings ` +
      `(skipped by Guard 1 SBQQ__Bundled__c: ${skippedByGuard1}, ` +
      `sum gap = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`
    );
    return findings;
  },
};

export default QL_FOR_001;

function lineRecord(line: BundleOptionLineRow, gap: number): SourceRecord {
  return {
    type: 'SBQQ__QuoteLine__c',
    id: line.Id,
    name: line.Name,
    financials: {
      net_price: parseFloat(line.SBQQ__NetPrice__c || '0'),
      quantity: parseFloat(line.SBQQ__Quantity__c || '1') || 1,
      list_price: parseFloat(line.SBQQ__ListPrice__c || '0'),
      gap,
    },
  };
}

function supportingRecords(line: BundleOptionLineRow, resolvedList: number | null): SourceRecord[] {
  return [
    {
      type: 'SBQQ__Quote__c',
      id: line.SBQQ__Quote__c,
      name: line.SBQQ__Quote__r?.Name ?? line.SBQQ__Quote__c,
    },
    {
      type: 'SBQQ__QuoteLine__c',
      id: line.SBQQ__RequiredBy__c,
      name: `Bundle parent (RequiredBy=${line.SBQQ__RequiredBy__c.slice(0, 6)}…)`,
    },
    {
      type: 'Product2',
      id: line.SBQQ__Product__c,
      name: line.SBQQ__Product__r?.Name ?? line.SBQQ__Product__c,
      financials: resolvedList != null
        ? { resolved_list_price: resolvedList }
        : { note: 'No list price resolved' },
    },
  ];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
