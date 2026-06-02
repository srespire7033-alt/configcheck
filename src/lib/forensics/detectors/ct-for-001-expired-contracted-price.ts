/**
 * CT-FOR-001 — Contracted Price expired but still applied.
 *
 * Pattern: a QuoteLine references SBQQ__ContractedPrice__c (a
 * pre-negotiated price lock for the customer) whose
 * EffectiveDate window has lapsed. The customer is locked into
 * stale pricing that's lower than current list — and the lock
 * itself was supposed to expire.
 *
 * Detection:
 *   1. Probe SBQQ__ContractedPrice__c object (not in every install).
 *   2. Pull active QuoteLines that reference a contracted price.
 *   3. For each ContractedPrice record, check its End/Expiration
 *      date. If past today, flag the line.
 *
 * Gap = (current_list - locked_price) × quantity.
 *
 * Category: revenue_leakage. Real $ being given away due to a
 * stale price lock.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface ContractedPriceRow {
  Id: string;
  Name: string;
  SBQQ__Account__c: string | null;
  SBQQ__Product__c: string | null;
  SBQQ__Price__c: string | number | null;
  SBQQ__EffectiveDate__c: string | null;
  SBQQ__ExpirationDate__c: string | null;
}

interface QlReferencingCp {
  Id: string;
  Name: string;
  SBQQ__Quote__c: string;
  SBQQ__Quote__r?: { Name?: string; SBQQ__Account__c?: string | null } | null;
  SBQQ__ContractedPrice__c: string | null;
  SBQQ__Product__c: string | null;
  SBQQ__Product__r?: { Name?: string } | null;
  SBQQ__ListPrice__c: string | number | null;
  SBQQ__NetPrice__c: string | number | null;
  SBQQ__Quantity__c: string | number | null;
}

const CT_FOR_001: ForensicDetector = {
  id: 'CT-FOR-001',
  label: 'Contracted Price expired but still applied',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'revenue_leakage',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    try {
      await ctx.conn.describe('SBQQ__ContractedPrice__c');
    } catch {
      console.log('[CT-FOR-001] SBQQ__ContractedPrice__c not in this org — skipping');
      return [];
    }
    // Also probe SBQQ__ContractedPrice__c on QuoteLine.
    let hasContractedPriceField = false;
    try {
      const qlDesc = await ctx.conn.describe('SBQQ__QuoteLine__c');
      hasContractedPriceField = qlDesc.fields.some((f) => f.name === 'SBQQ__ContractedPrice__c');
    } catch {
      hasContractedPriceField = false;
    }
    if (!hasContractedPriceField) {
      console.log('[CT-FOR-001] QuoteLine has no SBQQ__ContractedPrice__c — skipping');
      return [];
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const sinceIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    // 1. QuoteLines that reference any contracted price, created in window.
    const linesRes = await ctx.conn.query<QlReferencingCp>(`
      SELECT Id, Name, SBQQ__Quote__c, SBQQ__Quote__r.Name, SBQQ__Quote__r.SBQQ__Account__c,
             SBQQ__ContractedPrice__c, SBQQ__Product__c, SBQQ__Product__r.Name,
             SBQQ__ListPrice__c, SBQQ__NetPrice__c, SBQQ__Quantity__c
      FROM SBQQ__QuoteLine__c
      WHERE SBQQ__ContractedPrice__c != null
        AND CreatedDate >= ${sinceIso}
    `);
    console.log(`[CT-FOR-001] QuoteLines referencing a ContractedPrice: ${linesRes.records.length}`);
    if (linesRes.records.length === 0) return [];

    // 2. Pull all referenced ContractedPrice records.
    const cpIds = Array.from(new Set(linesRes.records.map((l) => l.SBQQ__ContractedPrice__c).filter((id): id is string => !!id)));
    const cpById = new Map<string, ContractedPriceRow>();
    for (let i = 0; i < cpIds.length; i += 500) {
      const chunk = cpIds.slice(i, i + 500);
      const cpRes = await ctx.conn.query<ContractedPriceRow>(`
        SELECT Id, Name, SBQQ__Account__c, SBQQ__Product__c, SBQQ__Price__c,
               SBQQ__EffectiveDate__c, SBQQ__ExpirationDate__c
        FROM SBQQ__ContractedPrice__c
        WHERE Id IN (${chunk.map((id) => `'${id}'`).join(',')})
      `);
      for (const c of cpRes.records) cpById.set(c.Id, c);
    }

    // 3. Pricebook list lookup for the gap math (current list vs locked price).
    const productIds = Array.from(new Set(linesRes.records.map((l) => l.SBQQ__Product__c).filter((id): id is string => !!id)));
    const currentListByProduct = new Map<string, number>();
    if (productIds.length > 0) {
      for (let i = 0; i < productIds.length; i += 500) {
        const chunk = productIds.slice(i, i + 500);
        const pbeRes = await ctx.conn.query<{ Product2Id: string; UnitPrice: string | number }>(`
          SELECT Product2Id, UnitPrice FROM PricebookEntry
          WHERE Product2Id IN (${chunk.map((id) => `'${id}'`).join(',')})
            AND Pricebook2.IsStandard = TRUE AND IsActive = TRUE
        `);
        for (const p of pbeRes.records) currentListByProduct.set(p.Product2Id, Number(p.UnitPrice ?? 0));
      }
    }

    // 4. Flag lines whose referenced ContractedPrice has expired.
    const findings: DetectorResult[] = [];
    for (const ql of linesRes.records) {
      if (!ql.SBQQ__ContractedPrice__c) continue;
      const cp = cpById.get(ql.SBQQ__ContractedPrice__c);
      if (!cp) continue;
      const expiration = cp.SBQQ__ExpirationDate__c;
      if (!expiration) continue; // open-ended — different detector
      if (new Date(expiration) >= new Date(todayIso)) continue; // still valid

      const lockedPrice = Number(cp.SBQQ__Price__c ?? 0);
      const currentList = ql.SBQQ__Product__c ? currentListByProduct.get(ql.SBQQ__Product__c) ?? 0 : 0;
      const qty = Number(ql.SBQQ__Quantity__c ?? 1);
      // If current list is below the locked price, no leak (customer
      // would have paid less anyway).
      if (currentList <= lockedPrice) continue;
      const gap = (currentList - lockedPrice) * qty;
      if (gap < 1) continue;

      const daysExpired = Math.floor(
        (Date.now() - new Date(expiration).getTime()) / (1000 * 60 * 60 * 24)
      );

      const primaryRecord: SourceRecord = {
        type: 'SBQQ__QuoteLine__c',
        id: ql.Id,
        name: ql.Name,
        financials: {
          locked_price: lockedPrice,
          current_list: currentList,
          quantity: qty,
          days_expired: daysExpired,
        },
      };
      const supportingRecords: SourceRecord[] = [
        { type: 'SBQQ__ContractedPrice__c', id: cp.Id, name: cp.Name },
      ];
      if (ql.SBQQ__Quote__c) {
        supportingRecords.push({ type: 'SBQQ__Quote__c', id: ql.SBQQ__Quote__c, name: ql.SBQQ__Quote__r?.Name ?? ql.SBQQ__Quote__c });
      }
      if (ql.SBQQ__Product__c) {
        supportingRecords.push({ type: 'Product2', id: ql.SBQQ__Product__c, name: ql.SBQQ__Product__r?.Name ?? ql.SBQQ__Product__c });
      }

      const ccy = ctx.defaultCurrencyIsoCode;
      findings.push({
        detectorId: 'CT-FOR-001',
        severity: gap >= 50_000 ? 'critical' : gap >= 5_000 ? 'warning' : 'info',
        entitledUsd: round2(currentList * qty),
        realizedUsd: round2(lockedPrice * qty),
        gapUsd: round2(gap),
        currencyIsoCode: ccy,
        recoverabilityScore: 0.8,
        primaryRecord,
        supportingRecords,
        title: `Quote line ${ql.Name} locked to expired contracted price (${ccy} ${Math.round(gap).toLocaleString()} below current list)`,
        description: `Quote line for ${ql.SBQQ__Product__r?.Name ?? 'product'} references Contracted Price "${cp.Name}" which expired ${daysExpired} days ago. Locked at ${ccy} ${lockedPrice}/unit vs current list ${ccy} ${currentList}/unit. ${ccy} ${Math.round(gap).toLocaleString()} of margin foregone on this line alone.`,
        metadata: {
          quote_line_id: ql.Id,
          contracted_price_id: cp.Id,
          contracted_price_expiration: expiration,
          locked_price: lockedPrice,
          current_list_price: currentList,
          days_expired: daysExpired,
          quantity: qty,
        },
      });
    }

    console.log(`[CT-FOR-001] Emitting ${findings.length} findings (sum gap = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`);
    return findings;
  },
};

export default CT_FOR_001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
