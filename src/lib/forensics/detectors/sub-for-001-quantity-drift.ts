/**
 * SUB-FOR-001 — Subscription quantity drift.
 *
 * Customer's active Subscription says they have N units, but the
 * provisioned Asset says they have M units. The two should agree;
 * when they don't, the customer is either:
 *   - Under-billed (asset_qty > sub_qty) → revenue leak
 *   - Over-billed  (asset_qty < sub_qty) → refund risk + compliance
 *
 * Both flagged. Common root causes:
 *   - Amendment Q→O sync dropped a quantity change
 *   - Manual edit to Asset.Quantity after activation
 *   - Custom integration writing to Asset but not Subscription
 *
 * Detection model:
 *   1. Probe for Asset (standard SF object, but some orgs disable).
 *   2. Pull active Subscriptions + their Account/Product/Qty.
 *   3. Pull Assets with same Account/Product.
 *   4. For each (Account, Product) tuple where both exist,
 *      compare quantities. If they differ, emit a finding.
 *
 * Gap calculation: |sub_qty − asset_qty| × Subscription.SBQQ__NetPrice__c
 *   This is the per-unit-per-period delta. The detector reports
 *   one period's worth (year). Annualized leakage upstream.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface SubRow {
  Id: string;
  Name: string;
  SBQQ__Account__c: string | null;
  SBQQ__Product__c: string | null;
  SBQQ__Quantity__c: string | number | null;
  SBQQ__NetPrice__c: string | number | null;
  SBQQ__SubscriptionStartDate__c: string | null;
  SBQQ__SubscriptionEndDate__c: string | null;
}

interface AssetRow {
  Id: string;
  Name: string;
  AccountId: string;
  Product2Id: string | null;
  Product2: { Name?: string } | null;
  Quantity: string | number | null;
  Status: string | null;
}

const SUB_FOR_001: ForensicDetector = {
  id: 'SUB-FOR-001',
  label: 'Subscription quantity drift vs Asset',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'revenue_leakage',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    // Probe Asset — standard object, but some orgs have it disabled
    // or stripped of fields. Bail cleanly if so.
    try {
      await ctx.conn.describe('Asset');
    } catch {
      console.log('[SUB-FOR-001] Asset object unavailable — skipping detector.');
      return [];
    }

    // 1. Active subscriptions.
    const subRes = await ctx.conn.query<SubRow>(`
      SELECT Id, Name, SBQQ__Account__c, SBQQ__Product__c, SBQQ__Quantity__c,
             SBQQ__NetPrice__c, SBQQ__SubscriptionStartDate__c, SBQQ__SubscriptionEndDate__c
      FROM SBQQ__Subscription__c
      WHERE SBQQ__SubscriptionEndDate__c >= TODAY OR SBQQ__SubscriptionEndDate__c = null
    `);
    console.log(`[SUB-FOR-001] Active subscriptions: ${subRes.records.length}`);
    if (subRes.records.length === 0) return [];

    // 2. Active assets for the same accounts.
    const accountIds = Array.from(new Set(subRes.records.map((s) => s.SBQQ__Account__c).filter((id): id is string => !!id)));
    if (accountIds.length === 0) return [];

    const assetsByAcctProduct = new Map<string, AssetRow[]>();
    const productIds = Array.from(new Set(subRes.records.map((s) => s.SBQQ__Product__c).filter((id): id is string => !!id)));
    if (productIds.length === 0) return [];

    // Chunk the IN(...) — Salesforce caps at ~4k IDs but SOQL queries
    // have a 100KB limit too. 500 per batch is safe.
    for (let i = 0; i < accountIds.length; i += 500) {
      const acctChunk = accountIds.slice(i, i + 500);
      for (let j = 0; j < productIds.length; j += 500) {
        const prodChunk = productIds.slice(j, j + 500);
        const assetsRes = await ctx.conn.query<AssetRow>(`
          SELECT Id, Name, AccountId, Product2Id, Product2.Name, Quantity, Status
          FROM Asset
          WHERE AccountId IN (${acctChunk.map((id) => `'${id}'`).join(',')})
            AND Product2Id IN (${prodChunk.map((id) => `'${id}'`).join(',')})
            AND Status IN ('Installed', 'Active', 'Purchased', 'Registered')
        `);
        for (const a of assetsRes.records) {
          const key = `${a.AccountId}::${a.Product2Id}`;
          const list = assetsByAcctProduct.get(key) ?? [];
          list.push(a);
          assetsByAcctProduct.set(key, list);
        }
      }
    }
    console.log(`[SUB-FOR-001] Asset rows matched: ${Array.from(assetsByAcctProduct.values()).flat().length}`);

    // 3. For each subscription, find matching asset(s) and compare.
    // Sum across multiple assets per (account, product) — some orgs
    // create one asset per unit; some bundle.
    const findings: DetectorResult[] = [];
    const seen = new Set<string>(); // dedupe per (account, product)

    for (const sub of subRes.records) {
      if (!sub.SBQQ__Account__c || !sub.SBQQ__Product__c) continue;
      const key = `${sub.SBQQ__Account__c}::${sub.SBQQ__Product__c}`;
      if (seen.has(key)) continue; // multiple subs for same account/product — only flag once
      seen.add(key);

      const assets = assetsByAcctProduct.get(key) ?? [];
      if (assets.length === 0) continue; // PROV-FOR-001 covers the inverse

      const subQty = Number(sub.SBQQ__Quantity__c ?? 0);
      const assetQty = assets.reduce((s, a) => s + Number(a.Quantity ?? 0), 0);
      if (subQty === assetQty) continue;
      if (subQty === 0 && assetQty === 0) continue;

      const unitPrice = Number(sub.SBQQ__NetPrice__c ?? 0);
      const delta = assetQty - subQty; // positive = asset has more = under-billed
      const gap = Math.abs(delta) * unitPrice;
      if (gap < 1) continue; // sub-dollar noise

      const direction: 'under_billed' | 'over_billed' = delta > 0 ? 'under_billed' : 'over_billed';
      const productName = assets[0]?.Product2?.Name ?? sub.SBQQ__Product__c;

      const primaryRecord: SourceRecord = {
        type: 'SBQQ__Subscription__c',
        id: sub.Id,
        name: sub.Name,
        financials: {
          subscription_quantity: subQty,
          asset_quantity: assetQty,
          quantity_delta: delta,
          unit_net_price: unitPrice,
          direction,
        },
      };
      const supportingRecords: SourceRecord[] = [
        {
          type: 'Account',
          id: sub.SBQQ__Account__c,
          name: `Account ${sub.SBQQ__Account__c}`,
        },
        ...assets.slice(0, 3).map<SourceRecord>((a) => ({
          type: 'Asset',
          id: a.Id,
          name: a.Name,
          financials: { quantity: Number(a.Quantity ?? 0), status: a.Status ?? null },
        })),
        {
          type: 'Product2',
          id: sub.SBQQ__Product__c,
          name: productName,
        },
      ];

      const ccy = ctx.defaultCurrencyIsoCode;
      const directionLabel = direction === 'under_billed' ? 'under-billed' : 'over-billed';
      findings.push({
        detectorId: 'SUB-FOR-001',
        severity: gap >= 100_000 ? 'critical' : gap >= 10_000 ? 'warning' : 'info',
        entitledUsd: round2(assetQty * unitPrice),
        realizedUsd: round2(subQty * unitPrice),
        gapUsd: round2(gap),
        currencyIsoCode: ccy,
        recoverabilityScore: 0.85,
        primaryRecord,
        supportingRecords,
        title: `Subscription ${sub.Name} ${directionLabel} — billing ${subQty} units, customer has ${assetQty} (${ccy} ${Math.round(gap).toLocaleString()})`,
        description:
          direction === 'under_billed'
            ? `Customer is provisioned ${assetQty} units of ${productName} but only billed for ${subQty}. Gap of ${Math.abs(delta)} units at ${ccy} ${unitPrice.toLocaleString()}/unit = ${ccy} ${Math.round(gap).toLocaleString()} annual leakage.`
            : `Customer is billed for ${subQty} units of ${productName} but only has ${assetQty} provisioned. Over-billed by ${Math.abs(delta)} units = ${ccy} ${Math.round(gap).toLocaleString()} annual exposure.`,
        metadata: {
          account_id: sub.SBQQ__Account__c,
          product_id: sub.SBQQ__Product__c,
          product_name: productName,
          subscription_quantity: subQty,
          asset_quantity: assetQty,
          quantity_delta: delta,
          unit_net_price: unitPrice,
          direction,
          asset_ids: assets.map((a) => a.Id),
        },
      });
    }

    console.log(
      `[SUB-FOR-001] Emitting ${findings.length} findings (sum gap = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`
    );
    return findings;
  },
};

export default SUB_FOR_001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
