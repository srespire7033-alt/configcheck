/**
 * QL-FOR-002 — Quote line approval skipped.
 *
 * Pattern: a QuoteLine has a discount above the threshold of an
 * active SBQQ__ApprovalRule__c, but no SBQQ__Approval__c record
 * exists for that line. The approval rule either failed to fire
 * or was bypassed.
 *
 * v1 simplification: we don't parse approval-rule conditions in
 * detail (they're free-form SOQL). Instead:
 *   1. Read all active approval rules with a discount threshold
 *      field (SBQQ__DiscountAmount__c or equivalent).
 *   2. For each line with NetPrice < ListPrice, compute effective
 *      discount %.
 *   3. If effective discount > min(threshold) of any active rule
 *      that targets the line's product/quote, expect an Approval
 *      record. If none exists, flag.
 *
 * Category: governance. The $ may already be billed — we're
 * flagging the missing approval signature.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface ApprovalRuleRow {
  Id: string;
  Name: string;
  SBQQ__Active__c: boolean | null;
  SBQQ__DiscountAmount__c?: string | number | null;
}

interface DiscountedQlRow {
  Id: string;
  Name: string;
  SBQQ__Quote__c: string;
  SBQQ__Quote__r?: { Name?: string; SBQQ__Account__r?: { Name?: string } } | null;
  SBQQ__Product__c: string | null;
  SBQQ__Product__r?: { Name?: string } | null;
  SBQQ__ListPrice__c: string | number | null;
  SBQQ__NetPrice__c: string | number | null;
  SBQQ__Quantity__c: string | number | null;
  SBQQ__Discount__c: string | number | null;
}

interface ApprovalRow {
  Id: string;
  SBQQ__QuoteLine__c: string | null;
}

const QL_FOR_002: ForensicDetector = {
  id: 'QL-FOR-002',
  label: 'QuoteLine discount exceeded approval threshold, no approval recorded',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'governance',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    // Probe Approval Rule + Approval objects.
    let hasApprovalRule = false;
    let hasApproval = false;
    try {
      await ctx.conn.describe('SBQQ__ApprovalRule__c');
      hasApprovalRule = true;
    } catch {
      hasApprovalRule = false;
    }
    try {
      await ctx.conn.describe('SBQQ__Approval__c');
      hasApproval = true;
    } catch {
      hasApproval = false;
    }
    if (!hasApprovalRule || !hasApproval) {
      console.log('[QL-FOR-002] Approval objects not in org — skipping');
      return [];
    }

    // 1. Active approval rules — find the LOWEST discount threshold.
    //    A line above any threshold (whichever is the smallest) should
    //    require approval.
    let minThreshold = Infinity;
    try {
      const rulesRes = await ctx.conn.query<ApprovalRuleRow>(`
        SELECT Id, Name, SBQQ__Active__c, SBQQ__DiscountAmount__c
        FROM SBQQ__ApprovalRule__c
        WHERE SBQQ__Active__c = TRUE AND SBQQ__DiscountAmount__c != null
      `);
      for (const r of rulesRes.records) {
        const t = Number(r.SBQQ__DiscountAmount__c ?? 0);
        if (t > 0 && t < minThreshold) minThreshold = t;
      }
    } catch {
      // SBQQ__DiscountAmount__c may not be the right field name in
      // every org. Without a parseable threshold we can't run.
    }
    if (!isFinite(minThreshold)) {
      console.log('[QL-FOR-002] No parseable approval thresholds — skipping');
      return [];
    }
    console.log(`[QL-FOR-002] Minimum approval threshold: ${minThreshold}%`);

    // 2. Discounted QuoteLines in window above that threshold.
    const sinceIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const linesRes = await ctx.conn.query<DiscountedQlRow>(`
      SELECT Id, Name, SBQQ__Quote__c, SBQQ__Quote__r.Name, SBQQ__Quote__r.SBQQ__Account__r.Name,
             SBQQ__Product__c, SBQQ__Product__r.Name,
             SBQQ__ListPrice__c, SBQQ__NetPrice__c, SBQQ__Quantity__c, SBQQ__Discount__c
      FROM SBQQ__QuoteLine__c
      WHERE SBQQ__Discount__c >= ${minThreshold}
        AND CreatedDate >= ${sinceIso}
    `);
    if (linesRes.records.length === 0) {
      console.log(`[QL-FOR-002] No lines exceed ${minThreshold}% discount threshold`);
      return [];
    }

    // 3. For each line, check if an Approval__c record exists.
    const lineIds = linesRes.records.map((l) => l.Id);
    const linesWithApproval = new Set<string>();
    for (let i = 0; i < lineIds.length; i += 500) {
      const chunk = lineIds.slice(i, i + 500);
      const apprRes = await ctx.conn.query<ApprovalRow>(`
        SELECT Id, SBQQ__QuoteLine__c
        FROM SBQQ__Approval__c
        WHERE SBQQ__QuoteLine__c IN (${chunk.map((id) => `'${id}'`).join(',')})
      `);
      for (const a of apprRes.records) {
        if (a.SBQQ__QuoteLine__c) linesWithApproval.add(a.SBQQ__QuoteLine__c);
      }
    }

    // 4. Emit findings for lines lacking approval.
    const findings: DetectorResult[] = [];
    for (const ql of linesRes.records) {
      if (linesWithApproval.has(ql.Id)) continue;
      const discount = Number(ql.SBQQ__Discount__c ?? 0);
      const listPrice = Number(ql.SBQQ__ListPrice__c ?? 0);
      const netPrice = Number(ql.SBQQ__NetPrice__c ?? 0);
      const qty = Number(ql.SBQQ__Quantity__c ?? 1);
      const accountName = ql.SBQQ__Quote__r?.SBQQ__Account__r?.Name ?? 'unknown account';
      const productName = ql.SBQQ__Product__r?.Name ?? ql.SBQQ__Product__c ?? 'Unknown';
      const ccy = ctx.defaultCurrencyIsoCode;

      const primaryRecord: SourceRecord = {
        type: 'SBQQ__QuoteLine__c',
        id: ql.Id,
        name: ql.Name,
        financials: {
          discount_pct: discount,
          threshold_pct: minThreshold,
          list_price: listPrice,
          net_price: netPrice,
          quantity: qty,
        },
      };
      const supportingRecords: SourceRecord[] = [];
      if (ql.SBQQ__Quote__c) {
        supportingRecords.push({ type: 'SBQQ__Quote__c', id: ql.SBQQ__Quote__c, name: ql.SBQQ__Quote__r?.Name ?? ql.SBQQ__Quote__c });
      }
      if (ql.SBQQ__Product__c) {
        supportingRecords.push({ type: 'Product2', id: ql.SBQQ__Product__c, name: productName });
      }

      findings.push({
        detectorId: 'QL-FOR-002',
        severity: discount >= 50 ? 'critical' : 'warning',
        // Governance category — no $ leak claim. Both entitled/realized
        // reflect the line's actual net value; gap is 0.
        entitledUsd: round2(netPrice * qty),
        realizedUsd: round2(netPrice * qty),
        gapUsd: 0,
        currencyIsoCode: ccy,
        recoverabilityScore: 0.5,
        primaryRecord,
        supportingRecords,
        title: `Quote line ${ql.Name} given ${discount}% discount, no approval recorded`,
        description: `Quote line for "${productName}" on ${accountName} carries a ${discount}% discount. Org's lowest approval threshold is ${minThreshold}% — this discount should have required approval, but no SBQQ__Approval__c record exists for this line. Likely cause: approval rule failed to fire (inactive trigger, missing condition coverage) or was overridden.`,
        metadata: {
          quote_line_id: ql.Id,
          quote_id: ql.SBQQ__Quote__c,
          discount_pct: discount,
          threshold_pct: minThreshold,
          list_price: listPrice,
          net_price: netPrice,
          quantity: qty,
          account_name: accountName,
        },
      });
    }

    console.log(`[QL-FOR-002] Emitting ${findings.length} findings`);
    return findings;
  },
};

export default QL_FOR_002;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
