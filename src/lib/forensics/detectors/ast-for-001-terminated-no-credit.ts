/**
 * AST-FOR-001 — Asset terminated mid-contract, no credit memo.
 *
 * Pattern: an Asset went into Status='Terminated' or 'Obsolete' but
 * a related Subscription is still active AND no Credit Memo exists
 * for that customer in the corresponding period. Customer paid for
 * service they're no longer receiving.
 *
 * Multiple failure modes:
 *   - CSM marked Asset terminated, didn't notify billing
 *   - Termination workflow didn't auto-issue a credit memo
 *   - Refund cycle skipped due to manual override
 *
 * Category: revenue_leakage. Direct $ owed back to customer +
 * compliance exposure if not addressed.
 *
 * Detection:
 *   1. Probe Asset object.
 *   2. Find Assets with Status IN ('Terminated','Obsolete','Cancelled')
 *      modified in last 12 months.
 *   3. For each, look for an ACTIVE subscription for same Account+Product.
 *   4. If active subscription exists, check for Credit Memo (Salesforce
 *      Billing's blng__CreditMemo__c if present) in the same window.
 *   5. If no credit memo → flag with full sub annual value as exposure.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface TerminatedAssetRow {
  Id: string;
  Name: string;
  AccountId: string;
  Product2Id: string | null;
  Product2?: { Name?: string } | null;
  Quantity: string | number | null;
  Price: string | number | null;
  Status: string | null;
  UsageEndDate: string | null;
}

const AST_FOR_001: ForensicDetector = {
  id: 'AST-FOR-001',
  label: 'Asset terminated, billing still active, no credit memo',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'revenue_leakage',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    try {
      await ctx.conn.describe('Asset');
    } catch {
      console.log('[AST-FOR-001] Asset unavailable — skipping');
      return [];
    }

    const sinceIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // 1. Terminated assets in window.
    const assetsRes = await ctx.conn.query<TerminatedAssetRow>(`
      SELECT Id, Name, AccountId, Product2Id, Product2.Name,
             Quantity, Price, Status, UsageEndDate
      FROM Asset
      WHERE Status IN ('Terminated', 'Obsolete', 'Cancelled', 'Expired')
        AND (UsageEndDate >= ${sinceIso} OR UsageEndDate = null)
    `);
    console.log(`[AST-FOR-001] Terminated assets in window: ${assetsRes.records.length}`);
    if (assetsRes.records.length === 0) return [];

    // 2. Map: terminated (Account, Product) → asset row
    const terminatedKeys = new Map<string, TerminatedAssetRow>();
    for (const a of assetsRes.records) {
      if (a.AccountId && a.Product2Id) {
        terminatedKeys.set(`${a.AccountId}::${a.Product2Id}`, a);
      }
    }
    if (terminatedKeys.size === 0) return [];

    // 3. Active subscriptions for those (Account, Product) pairs.
    const accountIds = Array.from(new Set(assetsRes.records.map((a) => a.AccountId)));
    const productIds = Array.from(new Set(assetsRes.records.map((a) => a.Product2Id).filter((id): id is string => !!id)));
    const subsByKey = new Map<string, { id: string; netPrice: number; qty: number; endDate: string | null }>();
    for (let i = 0; i < accountIds.length; i += 500) {
      const acctChunk = accountIds.slice(i, i + 500);
      for (let j = 0; j < productIds.length; j += 500) {
        const prodChunk = productIds.slice(j, j + 500);
        const subsRes = await ctx.conn.query<{
          Id: string;
          SBQQ__Account__c: string;
          SBQQ__Product__c: string;
          SBQQ__Quantity__c: string | number | null;
          SBQQ__NetPrice__c: string | number | null;
          SBQQ__SubscriptionEndDate__c: string | null;
        }>(`
          SELECT Id, SBQQ__Account__c, SBQQ__Product__c, SBQQ__Quantity__c,
                 SBQQ__NetPrice__c, SBQQ__SubscriptionEndDate__c
          FROM SBQQ__Subscription__c
          WHERE SBQQ__Account__c IN (${acctChunk.map((id) => `'${id}'`).join(',')})
            AND SBQQ__Product__c IN (${prodChunk.map((id) => `'${id}'`).join(',')})
            AND (SBQQ__SubscriptionEndDate__c >= TODAY OR SBQQ__SubscriptionEndDate__c = null)
        `);
        for (const s of subsRes.records) {
          subsByKey.set(`${s.SBQQ__Account__c}::${s.SBQQ__Product__c}`, {
            id: s.Id,
            netPrice: Number(s.SBQQ__NetPrice__c ?? 0),
            qty: Number(s.SBQQ__Quantity__c ?? 0),
            endDate: s.SBQQ__SubscriptionEndDate__c,
          });
        }
      }
    }

    // 4. Credit memo probe (Billing-only). If Billing isn't installed,
    //    we assume no credit memo exists for any of these accounts.
    let hasBilling = false;
    const accountsWithCreditMemo = new Set<string>();
    try {
      await ctx.conn.describe('blng__CreditMemo__c');
      hasBilling = true;
    } catch {
      hasBilling = false;
    }
    if (hasBilling && accountIds.length > 0) {
      for (let i = 0; i < accountIds.length; i += 500) {
        const chunk = accountIds.slice(i, i + 500);
        try {
          const cmRes = await ctx.conn.query<{ blng__Account__c: string | null }>(`
            SELECT blng__Account__c
            FROM blng__CreditMemo__c
            WHERE blng__Account__c IN (${chunk.map((id) => `'${id}'`).join(',')})
              AND CreatedDate >= ${new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()}
          `);
          for (const cm of cmRes.records) {
            if (cm.blng__Account__c) accountsWithCreditMemo.add(cm.blng__Account__c);
          }
        } catch {
          // Some orgs structure Credit Memo differently; ignore failures
        }
      }
    }

    // 5. Build findings.
    const findings: DetectorResult[] = [];
    for (const [key, asset] of Array.from(terminatedKeys.entries()) as Array<[string, TerminatedAssetRow]>) {
      const sub = subsByKey.get(key);
      if (!sub) continue; // no active billing — nothing to flag
      // If a credit memo exists for this Account in the window, assume
      // it covers this termination. Not perfect (could be unrelated)
      // but reduces noise.
      if (accountsWithCreditMemo.has(asset.AccountId)) continue;

      const annualExposure = sub.netPrice * sub.qty;
      if (annualExposure < 1) continue;

      const productName = asset.Product2?.Name ?? asset.Product2Id ?? 'Unknown';
      const ccy = ctx.defaultCurrencyIsoCode;
      const daysSinceTerminated = asset.UsageEndDate
        ? Math.floor((Date.now() - new Date(asset.UsageEndDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const primaryRecord: SourceRecord = {
        type: 'Asset',
        id: asset.Id,
        name: asset.Name,
        financials: {
          status: asset.Status,
          terminated_date: asset.UsageEndDate,
          days_since_terminated: daysSinceTerminated,
        },
      };
      const supportingRecords: SourceRecord[] = [
        { type: 'Account', id: asset.AccountId, name: `Account ${asset.AccountId}` },
        { type: 'SBQQ__Subscription__c', id: sub.id, name: `Active sub ($${annualExposure.toFixed(2)}/yr)` },
      ];
      if (asset.Product2Id) {
        supportingRecords.push({ type: 'Product2', id: asset.Product2Id, name: productName });
      }

      findings.push({
        detectorId: 'AST-FOR-001',
        severity: annualExposure >= 50_000 ? 'critical' : annualExposure >= 5_000 ? 'warning' : 'info',
        entitledUsd: 0,
        realizedUsd: round2(annualExposure),
        gapUsd: round2(annualExposure),
        currencyIsoCode: ccy,
        recoverabilityScore: 0.7,
        primaryRecord,
        supportingRecords,
        title: `Asset ${asset.Name} terminated but subscription still billing — no credit memo (${ccy} ${Math.round(annualExposure).toLocaleString()}/yr exposure)`,
        description: `Asset for ${productName} is in '${asset.Status}' status${daysSinceTerminated != null ? ` (${daysSinceTerminated} days ago)` : ''}, but an active Subscription continues to bill ${ccy} ${Math.round(annualExposure).toLocaleString()}/yr. ${hasBilling ? 'No Credit Memo found in the last 12 months for this Account.' : 'Salesforce Billing not installed — confirm via your billing system whether a credit/refund was issued.'} Customer is paying for a product they no longer have.`,
        metadata: {
          asset_id: asset.Id,
          account_id: asset.AccountId,
          product_id: asset.Product2Id,
          product_name: productName,
          asset_status: asset.Status,
          terminated_date: asset.UsageEndDate,
          days_since_terminated: daysSinceTerminated,
          subscription_id: sub.id,
          annual_exposure: annualExposure,
          credit_memo_check_available: hasBilling,
        },
      });
    }

    console.log(
      `[AST-FOR-001] Emitting ${findings.length} findings (sum exposure = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`
    );
    return findings;
  },
};

export default AST_FOR_001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
