/**
 * QL-FOR-001 — Bundle required option charged at $0.
 *
 * Pattern: a Bundle parent product has a required option that should
 * always be charged with the parent. The Quote Line for the option
 * gets NetPrice = 0 (rep edited manually, missing pricebook entry,
 * or a Price Rule wiped it). Customer received the option for free —
 * that's the leak.
 *
 * Detection model:
 *   1. Pull Quote Lines where SBQQ__RequiredBy__c IS NOT NULL
 *      (these are the bundle option lines tied to a parent line)
 *      AND SBQQ__NetPrice__c = 0
 *      AND the line was created in the last 24 months.
 *   2. Look up the Product2 of each affected line. If Product2.ListPrice
 *      OR a current Pricebook entry has UnitPrice > 0, flag it.
 *   3. Gap per finding = the resolved current price × quantity
 *      (or List as fallback). That's the "should have charged" amount.
 *
 * What we deliberately don't flag:
 *   - Lines with NetPrice > 0 (priced normally)
 *   - Lines whose product genuinely has no list price set (those
 *     route through Class E with lower confidence — covered separately)
 *   - Non-bundle lines (top-of-cart products that intentionally have
 *     promotional zero pricing)
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface BundleOptionLineRow {
  Id: string;
  Name: string;
  SBQQ__Quote__c: string;
  SBQQ__Quote__r?: { Name: string };
  SBQQ__RequiredBy__c: string;
  SBQQ__Product__c: string;
  SBQQ__Product__r?: { Name: string; SBQQ__ChargeType__c?: string | null };
  SBQQ__NetPrice__c: string;
  SBQQ__ListPrice__c: string;
  SBQQ__Quantity__c: string;
}

interface PricebookEntryRow {
  Id: string;
  Product2Id: string;
  UnitPrice: string;
}

const QL_FOR_001: ForensicDetector = {
  id: 'QL-FOR-001',
  label: 'Bundle required option charged at $0',
  // DISABLED: the detector as written false-positives on customers
  // using inclusive bundle pricing (parent ListPrice covers options,
  // so option NetPrice = 0 is intentional). Real-world version needs
  // 4 disqualifying-signal checks (SBQQ__Bundled__c, ProductOption
  // Discount=100, math-based inclusive check, OptionType=Related) to
  // avoid massive false positives. Keeping the code as the reference
  // implementation of Class E attribution; not running it on scans
  // until the false-positive guards are added.
  appliesTo: [],
  freeTier: false,

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    const sinceIso = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Required-bundle-option lines with $0 NetPrice.
    const linesQuery = `
      SELECT Id, Name,
        SBQQ__Quote__c, SBQQ__Quote__r.Name,
        SBQQ__RequiredBy__c,
        SBQQ__Product__c, SBQQ__Product__r.Name,
        SBQQ__NetPrice__c, SBQQ__ListPrice__c, SBQQ__Quantity__c
      FROM SBQQ__QuoteLine__c
      WHERE SBQQ__RequiredBy__c != null
        AND SBQQ__NetPrice__c = 0
        AND CreatedDate >= ${sinceIso}
    `;
    const linesRes = await ctx.conn.query<BundleOptionLineRow>(linesQuery);
    console.log(`[QL-FOR-001] Bundle-option zero-price lines: ${linesRes.records.length}`);
    if (linesRes.records.length === 0) return [];

    // 2. Look up current Pricebook entries for these products. List
    //    price on the Quote Line is one signal; the current Pricebook
    //    UnitPrice is the more reliable one for "should have charged."
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

    // 3. Reconcile per-line.
    const findings: DetectorResult[] = [];
    for (const line of linesRes.records) {
      const lineList = parseFloat(line.SBQQ__ListPrice__c || '0');
      const pbeList = parseFloat(pbeByProduct.get(line.SBQQ__Product__c)?.UnitPrice || '0');
      // Prefer Pricebook list price; fall back to line list. If neither
      // is set, the product genuinely has no current price — Class E
      // tracer will surface this as OPTION_PRICE_UNRESOLVED with lower
      // confidence rather than skipping outright.
      const resolvedList = pbeList > 0 ? pbeList : lineList;
      const quantity = parseFloat(line.SBQQ__Quantity__c || '1') || 1;

      // No resolvable list price → emit a finding but mark recoverability
      // lower; the rep can't have been expected to charge a price the
      // product doesn't carry.
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
          },
        });
        continue;
      }

      const gap = resolvedList * quantity;
      if (gap < 1) continue;

      findings.push({
        detectorId: 'QL-FOR-001',
        severity: gap >= 10_000 ? 'critical' : gap >= 1_000 ? 'warning' : 'info',
        entitledUsd: round2(gap),
        realizedUsd: 0,
        gapUsd: round2(gap),
        currencyIsoCode: ctx.defaultCurrencyIsoCode,
        // Highly recoverable: this is a re-pricing on the next quote/
        // amendment, not a clawback. Customer-facing it's "this required
        // add-on is part of the bundle and carries a standard price."
        recoverabilityScore: 0.9,
        primaryRecord: lineRecord(line, gap),
        supportingRecords: supportingRecords(line, resolvedList),
        title: `Required bundle option "${line.SBQQ__Product__r?.Name ?? 'option'}" given away free (${ctx.defaultCurrencyIsoCode} ${Math.round(gap).toLocaleString()})`,
        description: `Quote line ${line.Name} is a required bundle option (linked to parent ${line.SBQQ__RequiredBy__c}) but was priced at $0. Current list is ${ctx.defaultCurrencyIsoCode} ${resolvedList.toLocaleString()}/unit × ${quantity}.`,
        metadata: {
          sub_case: 'price_override_missing',
          line_list_price: lineList,
          product_list_price: pbeList,
          resolved_list_price: resolvedList,
          quantity,
        },
      });
    }

    console.log(`[QL-FOR-001] Emitting ${findings.length} findings (sum gap = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`);
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
