/**
 * DSC-FOR-002 — Stacked discounts exceed approved cap.
 *
 * Pattern: a QuoteLine has multiple discount sources stacked
 * (SBQQ__Discount__c + SBQQ__AdditionalDiscount__c, sometimes a
 * partner discount on top) whose cumulative effective discount
 * exceeds the org's approved-discount threshold for that product
 * tier. Approval rule either didn't fire or was overridden.
 *
 * v1 simplification: we don't try to read every approval rule
 * (they're complex). Instead we compute the EFFECTIVE total
 * discount = (1 − NetPrice/ListPrice) × 100, compare against a
 * configurable cap (default 50%), and flag anything above with
 * the gap = (NetPrice difference if capped at threshold).
 *
 * Category: revenue_leakage. Direct $ that should have been
 * collected if the approval cap had held.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

const CAP_PCT = 50; // % — anything above is a "stacked beyond cap" finding

interface QlRow {
  Id: string;
  Name: string;
  SBQQ__Quote__c: string;
  SBQQ__Quote__r?: { Name?: string; SBQQ__Account__c?: string | null; SBQQ__Account__r?: { Name?: string } | null } | null;
  SBQQ__Product__c: string | null;
  SBQQ__Product__r?: { Name?: string } | null;
  SBQQ__ListPrice__c: string | number | null;
  SBQQ__NetPrice__c: string | number | null;
  SBQQ__Quantity__c: string | number | null;
  SBQQ__Discount__c: string | number | null;
  SBQQ__AdditionalDiscount__c?: string | number | null;
  SBQQ__PartnerDiscount__c?: string | number | null;
}

const DSC_FOR_002: ForensicDetector = {
  id: 'DSC-FOR-002',
  label: 'Stacked discounts exceed approved cap',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'revenue_leakage',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    // Probe optional discount columns.
    let hasAddl = false;
    let hasPartner = false;
    try {
      const qlDesc = await ctx.conn.describe('SBQQ__QuoteLine__c');
      hasAddl = qlDesc.fields.some((f) => f.name === 'SBQQ__AdditionalDiscount__c');
      hasPartner = qlDesc.fields.some((f) => f.name === 'SBQQ__PartnerDiscount__c');
    } catch {
      // proceed without
    }
    const addlSelect = hasAddl ? 'SBQQ__AdditionalDiscount__c,' : '';
    const partnerSelect = hasPartner ? 'SBQQ__PartnerDiscount__c,' : '';
    const sinceIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    // Pull lines that ALREADY look discounted (NetPrice < ListPrice).
    // We don't filter on Discount__c alone because some orgs put the
    // discount in different fields.
    const res = await ctx.conn.query<QlRow>(`
      SELECT Id, Name,
             SBQQ__Quote__c, SBQQ__Quote__r.Name,
             SBQQ__Quote__r.SBQQ__Account__c, SBQQ__Quote__r.SBQQ__Account__r.Name,
             SBQQ__Product__c, SBQQ__Product__r.Name,
             SBQQ__ListPrice__c, SBQQ__NetPrice__c, SBQQ__Quantity__c,
             SBQQ__Discount__c, ${addlSelect} ${partnerSelect}
             CreatedDate
      FROM SBQQ__QuoteLine__c
      WHERE SBQQ__ListPrice__c > 0
        AND SBQQ__NetPrice__c > 0
        AND SBQQ__NetPrice__c < SBQQ__ListPrice__c
        AND CreatedDate >= ${sinceIso}
    `);
    console.log(`[DSC-FOR-002] Candidate discounted lines: ${res.records.length}`);
    if (res.records.length === 0) return [];

    const findings: DetectorResult[] = [];
    for (const ql of res.records) {
      const listPrice = Number(ql.SBQQ__ListPrice__c ?? 0);
      const netPrice = Number(ql.SBQQ__NetPrice__c ?? 0);
      const qty = Number(ql.SBQQ__Quantity__c ?? 1);
      if (listPrice <= 0 || netPrice >= listPrice) continue;

      const effectiveDiscountPct = ((listPrice - netPrice) / listPrice) * 100;
      if (effectiveDiscountPct <= CAP_PCT) continue;

      // Sources breakdown (for the narrative).
      const standardDisc = Number(ql.SBQQ__Discount__c ?? 0);
      const addlDisc = Number(ql.SBQQ__AdditionalDiscount__c ?? 0);
      const partnerDisc = Number(ql.SBQQ__PartnerDiscount__c ?? 0);

      // Gap = revenue that SHOULD have come in if we had capped at CAP_PCT.
      const cappedNet = listPrice * (1 - CAP_PCT / 100);
      const gapPerUnit = cappedNet - netPrice;
      const gap = gapPerUnit * qty;
      if (gap < 1) continue;

      const productName = ql.SBQQ__Product__r?.Name ?? ql.SBQQ__Product__c ?? 'Unknown';
      const accountName = ql.SBQQ__Quote__r?.SBQQ__Account__r?.Name ?? `Account ${ql.SBQQ__Quote__r?.SBQQ__Account__c ?? 'unknown'}`;
      const ccy = ctx.defaultCurrencyIsoCode;

      const primaryRecord: SourceRecord = {
        type: 'SBQQ__QuoteLine__c',
        id: ql.Id,
        name: ql.Name,
        financials: {
          list_price: listPrice,
          net_price: netPrice,
          effective_discount_pct: round2(effectiveDiscountPct),
          standard_discount_pct: standardDisc,
          additional_discount_pct: addlDisc,
          partner_discount_pct: partnerDisc,
          quantity: qty,
        },
      };
      const supportingRecords: SourceRecord[] = [];
      if (ql.SBQQ__Quote__c) {
        supportingRecords.push({
          type: 'SBQQ__Quote__c',
          id: ql.SBQQ__Quote__c,
          name: ql.SBQQ__Quote__r?.Name ?? ql.SBQQ__Quote__c,
        });
      }
      if (ql.SBQQ__Quote__r?.SBQQ__Account__c) {
        supportingRecords.push({ type: 'Account', id: ql.SBQQ__Quote__r.SBQQ__Account__c, name: accountName });
      }
      if (ql.SBQQ__Product__c) {
        supportingRecords.push({ type: 'Product2', id: ql.SBQQ__Product__c, name: productName });
      }

      findings.push({
        detectorId: 'DSC-FOR-002',
        severity: effectiveDiscountPct >= 75 ? 'critical' : 'warning',
        entitledUsd: round2(cappedNet * qty),
        realizedUsd: round2(netPrice * qty),
        gapUsd: round2(gap),
        currencyIsoCode: ccy,
        recoverabilityScore: 0.7,
        primaryRecord,
        supportingRecords,
        title: `Quote line ${ql.Name} discounted ${round2(effectiveDiscountPct)}% — exceeds ${CAP_PCT}% cap (${ccy} ${Math.round(gap).toLocaleString()})`,
        description: `Quote line "${productName}" for ${accountName} has effective discount ${round2(effectiveDiscountPct)}%. Sources: standard ${standardDisc}%, additional ${addlDisc}%, partner ${partnerDisc}%. Approval cap of ${CAP_PCT}% was either not enforced or overridden. If capped, ${ccy} ${Math.round(gap).toLocaleString()} more would have been collected.`,
        metadata: {
          quote_line_id: ql.Id,
          quote_id: ql.SBQQ__Quote__c,
          account_name: accountName,
          product_name: productName,
          list_price: listPrice,
          net_price: netPrice,
          effective_discount_pct: round2(effectiveDiscountPct),
          standard_discount_pct: standardDisc,
          additional_discount_pct: addlDisc,
          partner_discount_pct: partnerDisc,
          cap_pct: CAP_PCT,
          quantity: qty,
        },
      });
    }

    console.log(`[DSC-FOR-002] Emitting ${findings.length} findings (sum gap = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`);
    return findings;
  },
};

export default DSC_FOR_002;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
