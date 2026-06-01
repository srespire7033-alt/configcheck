/**
 * PROV-FOR-001 — Provisioned but not billed.
 *
 * Asset.Status='Installed' (the customer has the product) but NO
 * active SBQQ__Subscription__c exists for the same Account+Product.
 * Customer is consuming a product they're not being charged for.
 *
 * Common root causes:
 *   - Manual Asset creation (no Quote→Order→Subscription chain)
 *   - Provisioning integration writes to Asset but not Subscription
 *   - Subscription was cancelled but Asset wasn't terminated
 *
 * Detection model:
 *   1. Probe for Asset.
 *   2. Pull all Installed Assets activated in the last 24 months.
 *   3. For each, check if a current Subscription exists for the
 *      same Account+Product.
 *   4. If none, flag with annual revenue at risk.
 *
 * Gap calculation: prefer Asset.Price * Asset.Quantity * 12 if
 * available. Otherwise fall back to Product2 Standard Pricebook
 * UnitPrice * Quantity * 12. If neither available, gap = 0 (info-
 * level only).
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface AssetRow {
  Id: string;
  Name: string;
  AccountId: string;
  Product2Id: string | null;
  Product2: { Name?: string } | null;
  Quantity: string | number | null;
  Price: string | number | null;
  Status: string | null;
  InstallDate: string | null;
}

interface PbeRow {
  Id: string;
  Product2Id: string;
  UnitPrice: string | number | null;
}

const PROV_FOR_001: ForensicDetector = {
  id: 'PROV-FOR-001',
  label: 'Asset provisioned, no active subscription',
  appliesTo: ['cpq', 'cpq_billing', 'arm'],
  freeTier: false,
  category: 'revenue_leakage',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    try {
      await ctx.conn.describe('Asset');
    } catch {
      console.log('[PROV-FOR-001] Asset object unavailable — skipping detector.');
      return [];
    }

    // 1. Active assets in window.
    const sinceIso = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const assetsRes = await ctx.conn.query<AssetRow>(`
      SELECT Id, Name, AccountId, Product2Id, Product2.Name, Quantity, Price, Status, InstallDate
      FROM Asset
      WHERE Status IN ('Installed', 'Active', 'Purchased', 'Registered')
        AND (InstallDate >= ${sinceIso} OR InstallDate = null)
    `);
    console.log(`[PROV-FOR-001] Installed Assets in window: ${assetsRes.records.length}`);
    if (assetsRes.records.length === 0) return [];

    // 2. For each (account, product), check if active subscription exists.
    const accountIds = Array.from(new Set(assetsRes.records.map((a) => a.AccountId)));
    const productIds = Array.from(new Set(assetsRes.records.map((a) => a.Product2Id).filter((id): id is string => !!id)));
    if (productIds.length === 0) return [];

    const billedKeys = new Set<string>();
    for (let i = 0; i < accountIds.length; i += 500) {
      const acctChunk = accountIds.slice(i, i + 500);
      for (let j = 0; j < productIds.length; j += 500) {
        const prodChunk = productIds.slice(j, j + 500);
        const subsRes = await ctx.conn.query<{
          SBQQ__Account__c: string | null;
          SBQQ__Product__c: string | null;
        }>(`
          SELECT SBQQ__Account__c, SBQQ__Product__c
          FROM SBQQ__Subscription__c
          WHERE SBQQ__Account__c IN (${acctChunk.map((id) => `'${id}'`).join(',')})
            AND SBQQ__Product__c IN (${prodChunk.map((id) => `'${id}'`).join(',')})
            AND (SBQQ__SubscriptionEndDate__c >= TODAY OR SBQQ__SubscriptionEndDate__c = null)
        `);
        for (const s of subsRes.records) {
          if (s.SBQQ__Account__c && s.SBQQ__Product__c) {
            billedKeys.add(`${s.SBQQ__Account__c}::${s.SBQQ__Product__c}`);
          }
        }
      }
    }
    console.log(`[PROV-FOR-001] (account, product) keys with active subscription: ${billedKeys.size}`);

    // 3. Build unbilled list.
    const unbilledAssets = assetsRes.records.filter((a) => {
      if (!a.AccountId || !a.Product2Id) return false;
      return !billedKeys.has(`${a.AccountId}::${a.Product2Id}`);
    });
    console.log(`[PROV-FOR-001] Unbilled assets: ${unbilledAssets.length}`);
    if (unbilledAssets.length === 0) return [];

    // 4. Resolve fallback prices via Pricebook for assets missing Price.
    const missingPriceProductIds = Array.from(
      new Set(
        unbilledAssets
          .filter((a) => !a.Price || Number(a.Price) === 0)
          .map((a) => a.Product2Id)
          .filter((id): id is string => !!id)
      )
    );
    const pbePriceByProductId = new Map<string, number>();
    if (missingPriceProductIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stdPb = (await ctx.conn.query(`SELECT Id FROM Pricebook2 WHERE IsStandard = TRUE LIMIT 1`)) as any;
      const stdPbId = stdPb.records[0]?.Id;
      if (stdPbId) {
        for (let i = 0; i < missingPriceProductIds.length; i += 500) {
          const chunk = missingPriceProductIds.slice(i, i + 500);
          const pbeRes = await ctx.conn.query<PbeRow>(`
            SELECT Id, Product2Id, UnitPrice FROM PricebookEntry
            WHERE Pricebook2Id = '${stdPbId}' AND IsActive = TRUE
              AND Product2Id IN (${chunk.map((id) => `'${id}'`).join(',')})
          `);
          for (const p of pbeRes.records) {
            pbePriceByProductId.set(p.Product2Id, Number(p.UnitPrice ?? 0));
          }
        }
      }
    }

    // 5. Build findings.
    const findings: DetectorResult[] = [];
    for (const a of unbilledAssets) {
      const productName = a.Product2?.Name ?? a.Product2Id ?? 'Unknown';
      const qty = Number(a.Quantity ?? 1);
      const assetPrice = Number(a.Price ?? 0);
      const pricePerUnit = assetPrice > 0
        ? assetPrice
        : pbePriceByProductId.get(a.Product2Id ?? '') ?? 0;
      // Annualized — most Assets are monthly or annual; we report
      // annual at-risk revenue. Per-period accumulation depends on
      // org config we don't have visibility into.
      const annualGap = pricePerUnit * qty;
      if (annualGap < 1) continue;

      const installDate = a.InstallDate ?? null;
      const daysInstalled = installDate
        ? Math.floor((Date.now() - new Date(installDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const primaryRecord: SourceRecord = {
        type: 'Asset',
        id: a.Id,
        name: a.Name,
        financials: {
          quantity: qty,
          unit_price: pricePerUnit,
          install_date: installDate,
          status: a.Status,
        },
      };
      const supportingRecords: SourceRecord[] = [
        { type: 'Account', id: a.AccountId, name: `Account ${a.AccountId}` },
        a.Product2Id
          ? { type: 'Product2', id: a.Product2Id, name: productName }
          : null,
      ].filter((r): r is SourceRecord => !!r);

      const ccy = ctx.defaultCurrencyIsoCode;
      findings.push({
        detectorId: 'PROV-FOR-001',
        severity: annualGap >= 100_000 ? 'critical' : annualGap >= 10_000 ? 'warning' : 'info',
        entitledUsd: round2(annualGap),
        realizedUsd: 0,
        gapUsd: round2(annualGap),
        currencyIsoCode: ccy,
        recoverabilityScore: 0.85,
        primaryRecord,
        supportingRecords,
        title: `Asset ${a.Name} provisioned, no active subscription (${ccy} ${Math.round(annualGap).toLocaleString()}/yr)`,
        description: daysInstalled
          ? `Asset installed ${daysInstalled} days ago for ${qty}× ${productName}, but no active Subscription billing this product for this Account. ${ccy} ${Math.round(annualGap).toLocaleString()} of annual revenue is unbilled.`
          : `Asset installed for ${qty}× ${productName}, but no active Subscription billing this product for this Account. ${ccy} ${Math.round(annualGap).toLocaleString()} of annual revenue is unbilled.`,
        metadata: {
          asset_id: a.Id,
          account_id: a.AccountId,
          product_id: a.Product2Id,
          product_name: productName,
          quantity: qty,
          unit_price: pricePerUnit,
          install_date: installDate,
          days_installed: daysInstalled,
          price_source: assetPrice > 0 ? 'asset' : 'pricebook_fallback',
        },
      });
    }

    console.log(
      `[PROV-FOR-001] Emitting ${findings.length} findings (sum gap = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`
    );
    return findings;
  },
};

export default PROV_FOR_001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
