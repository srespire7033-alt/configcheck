/**
 * PROV-FOR-002 — Active Subscription, no Asset.
 *
 * Inverse of PROV-FOR-001. Customer is being billed (active
 * Subscription) but no Asset exists to back it up. Two failure modes:
 *
 *   A) Customer cancelled but billing wasn't stopped (over-billing,
 *      refund risk, compliance issue).
 *   B) Provisioning never happened — customer is paying but never
 *      received the product (churn risk + customer success failure).
 *
 * Both surfaced as warning-level revenue_leakage findings.
 *
 * Detection:
 *   1. Probe Asset object.
 *   2. Pull active subscriptions.
 *   3. For each, check if (Account, Product) has any installed Asset.
 *   4. If none, flag.
 *
 * Gap calculation: Subscription.SBQQ__NetPrice__c × SBQQ__Quantity__c.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface SubRow {
  Id: string;
  Name: string;
  SBQQ__Account__c: string | null;
  SBQQ__Account__r?: { Name?: string } | null;
  SBQQ__Product__c: string | null;
  SBQQ__Product__r?: { Name?: string } | null;
  SBQQ__Quantity__c: string | number | null;
  SBQQ__NetPrice__c: string | number | null;
  SBQQ__SubscriptionStartDate__c: string | null;
  SBQQ__SubscriptionEndDate__c: string | null;
}

const PROV_FOR_002: ForensicDetector = {
  id: 'PROV-FOR-002',
  label: 'Active subscription with no Asset',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'revenue_leakage',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    try {
      await ctx.conn.describe('Asset');
    } catch {
      console.log('[PROV-FOR-002] Asset unavailable — skipping');
      return [];
    }

    const subsRes = await ctx.conn.query<SubRow>(`
      SELECT Id, Name, SBQQ__Account__c, SBQQ__Account__r.Name,
             SBQQ__Product__c, SBQQ__Product__r.Name,
             SBQQ__Quantity__c, SBQQ__NetPrice__c,
             SBQQ__SubscriptionStartDate__c, SBQQ__SubscriptionEndDate__c
      FROM SBQQ__Subscription__c
      WHERE (SBQQ__SubscriptionEndDate__c >= TODAY OR SBQQ__SubscriptionEndDate__c = null)
    `);
    console.log(`[PROV-FOR-002] Active subscriptions: ${subsRes.records.length}`);
    if (subsRes.records.length === 0) return [];

    // Build set of (Account, Product) pairs that DO have an installed Asset.
    const accountIds = Array.from(new Set(subsRes.records.map((s) => s.SBQQ__Account__c).filter((id): id is string => !!id)));
    const productIds = Array.from(new Set(subsRes.records.map((s) => s.SBQQ__Product__c).filter((id): id is string => !!id)));
    if (productIds.length === 0) return [];

    const assetKeys = new Set<string>();
    for (let i = 0; i < accountIds.length; i += 500) {
      const acctChunk = accountIds.slice(i, i + 500);
      for (let j = 0; j < productIds.length; j += 500) {
        const prodChunk = productIds.slice(j, j + 500);
        const assetsRes = await ctx.conn.query<{ AccountId: string; Product2Id: string | null }>(`
          SELECT AccountId, Product2Id FROM Asset
          WHERE AccountId IN (${acctChunk.map((id) => `'${id}'`).join(',')})
            AND Product2Id IN (${prodChunk.map((id) => `'${id}'`).join(',')})
            AND Status IN ('Installed', 'Active', 'Purchased', 'Registered')
        `);
        for (const a of assetsRes.records) {
          if (a.AccountId && a.Product2Id) assetKeys.add(`${a.AccountId}::${a.Product2Id}`);
        }
      }
    }

    const findings: DetectorResult[] = [];
    const seen = new Set<string>();
    for (const sub of subsRes.records) {
      if (!sub.SBQQ__Account__c || !sub.SBQQ__Product__c) continue;
      const key = `${sub.SBQQ__Account__c}::${sub.SBQQ__Product__c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (assetKeys.has(key)) continue;

      const qty = Number(sub.SBQQ__Quantity__c ?? 0);
      const unitPrice = Number(sub.SBQQ__NetPrice__c ?? 0);
      const annualExposure = qty * unitPrice;
      if (annualExposure < 1) continue;

      const productName = sub.SBQQ__Product__r?.Name ?? sub.SBQQ__Product__c;
      const accountName = sub.SBQQ__Account__r?.Name ?? `Account ${sub.SBQQ__Account__c}`;
      const ccy = ctx.defaultCurrencyIsoCode;

      const primaryRecord: SourceRecord = {
        type: 'SBQQ__Subscription__c',
        id: sub.Id,
        name: sub.Name,
        financials: { quantity: qty, unit_price: unitPrice, annual_exposure: annualExposure },
      };
      const supportingRecords: SourceRecord[] = [
        { type: 'Account', id: sub.SBQQ__Account__c, name: accountName },
        { type: 'Product2', id: sub.SBQQ__Product__c, name: productName },
      ];

      findings.push({
        detectorId: 'PROV-FOR-002',
        severity: annualExposure >= 50_000 ? 'critical' : annualExposure >= 5_000 ? 'warning' : 'info',
        entitledUsd: 0,
        realizedUsd: round2(annualExposure),
        gapUsd: round2(annualExposure),
        currencyIsoCode: ccy,
        // Lower than PROV-FOR-001: this could be either over-billing
        // (refund needed) or provisioning gap — either way it requires
        // investigation, not auto-patch.
        recoverabilityScore: 0.5,
        primaryRecord,
        supportingRecords,
        title: `Active subscription ${sub.Name} bills ${qty}× ${productName} — no Asset on file (${ccy} ${Math.round(annualExposure).toLocaleString()}/yr)`,
        description: `Customer ${accountName} is being billed for ${qty}× ${productName} (${ccy} ${Math.round(annualExposure).toLocaleString()}/yr) but no installed Asset exists for this Account+Product. Either the customer cancelled and billing wasn't stopped (refund risk) OR provisioning never happened (customer success gap).`,
        metadata: {
          subscription_id: sub.Id,
          account_id: sub.SBQQ__Account__c,
          account_name: accountName,
          product_id: sub.SBQQ__Product__c,
          product_name: productName,
          quantity: qty,
          unit_price: unitPrice,
          annual_exposure: annualExposure,
        },
      });
    }

    console.log(
      `[PROV-FOR-002] Emitting ${findings.length} findings (sum exposure = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`
    );
    return findings;
  },
};

export default PROV_FOR_002;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
