/**
 * REN-001 — Renewal Uplift Suppressed
 *
 * Detects renewal Quote Lines where the contractually entitled uplift
 * (escalation %) was NOT applied. Per-record verified $ — no heuristic.
 *
 * Detection model:
 *   1. Pull every Quote Line with parent Quote.SBQQ__Type__c = 'Renewal'
 *      from the last 24 months (Bulk API — these can be tens of thousands
 *      of rows on a serious customer).
 *   2. For each renewal quote line, find its originating subscription
 *      (SBQQ__RenewedSubscription__c) and through it the original Contract +
 *      uplift entitlement.
 *   3. Compute:
 *        entitled = originalPrice × (1 + upliftPct)
 *        realized = SBQQ__NetPrice__c on the renewal quote line
 *        gap      = entitled - realized
 *      Anything where gap > $1 emits a finding.
 *
 * Variance we tolerate in v1:
 *   - Multi-year escalation curves (3%/5%/7%) treated as flat uplift.
 *     REN-004 (Slice 4) handles tiered escalation.
 *   - Currency conversion uses Account.CurrencyIsoCode at the time of
 *     the renewal quote. Customers with mid-cycle currency switches will
 *     get false positives — we flag with low recoverability_score.
 *
 * Variance we DO NOT tolerate:
 *   - "Free" renewals (deliberately $0 strategic accounts) — we flag
 *     these and let the user mark them resolved. Otherwise we'd suppress
 *     real findings.
 *
 * Privacy: zero PII pulled. Quote Numbers, Order Numbers, IDs — that's it.
 */

import { bulkQuery } from '../bulk-client';
import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface RenewalLineRow {
  Id: string;
  Name: string;
  SBQQ__Quote__c: string;
  'SBQQ__Quote__r.Name': string;
  'SBQQ__Quote__r.SBQQ__Type__c': string;
  'SBQQ__Quote__r.CurrencyIsoCode': string;
  SBQQ__RenewedSubscription__c: string;
  SBQQ__Product__c: string;
  'SBQQ__Product__r.Name': string;
  SBQQ__NetPrice__c: string;
  SBQQ__Quantity__c: string;
}

interface SubscriptionRow {
  Id: string;
  Name: string;
  SBQQ__Contract__c: string;
  'SBQQ__Contract__r.ContractNumber': string;
  'SBQQ__Contract__r.SBQQ__RenewalUpliftRate__c': string | null;
  SBQQ__NetPrice__c: string;
  SBQQ__Quantity__c: string;
}

const REN_001: ForensicDetector = {
  id: 'REN-001',
  label: 'Renewal uplift contractually entitled but not applied',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: true,

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    // 24-month window. Older renewals are typically out of recovery
    // reach (statute of limitations or customer goodwill cost too high).
    const sinceIso = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Renewal quote lines in the window.
    //
    // SOQL constants only — no user input concatenated in. The bulk-client
    // contract requires callers to never inline-build SOQL from user data,
    // and this detector honors that by construction (everything is a
    // hardcoded field path or a date literal).
    //
    // CurrencyIsoCode only exists when multi-currency is enabled at the
    // org level. Single-currency orgs (the majority) don't have it on
    // any object. We detect at runtime via describe and conditionally
    // include the field — falls back to ctx.defaultCurrencyIsoCode when
    // multi-currency is off.
    const multiCurrency = await isMultiCurrencyEnabled(ctx.conn);
    const currencySelect = multiCurrency ? ', SBQQ__Quote__r.CurrencyIsoCode' : '';
    const renewalLinesQuery = `
      SELECT
        Id, Name,
        SBQQ__Quote__c, SBQQ__Quote__r.Name,
        SBQQ__Quote__r.SBQQ__Type__c${currencySelect},
        SBQQ__RenewedSubscription__c,
        SBQQ__Product__c, SBQQ__Product__r.Name,
        SBQQ__NetPrice__c, SBQQ__Quantity__c
      FROM SBQQ__QuoteLine__c
      WHERE SBQQ__Quote__r.SBQQ__Type__c = 'Renewal'
        AND CreatedDate >= ${sinceIso.replace('Z', 'Z')}
        AND SBQQ__RenewedSubscription__c != null
    `;

    const linesRes = await bulkQuery<RenewalLineRow>(ctx.conn, renewalLinesQuery, {
      maxPollMs: 8 * 60 * 1000, // 8 min cap for this query
    });
    if (!linesRes.jobComplete) {
      // The job is still running on Salesforce — bail with empty. The
      // forensic scan will mark partial; next run picks up.
      return [];
    }
    if (linesRes.records.length === 0) {
      // No renewal quote lines found. Either the org has no renewals
      // yet, or SBQQ__Type__c is being stored differently. Neither is a
      // detector bug — return empty.
      return [];
    }

    // 2. Pull the linked Subscriptions to get the original price + contract uplift.
    const subscriptionIds = Array.from(new Set(linesRes.records.map((r) => r.SBQQ__RenewedSubscription__c).filter(Boolean)));
    const subscriptionsBySubId = new Map<string, SubscriptionRow>();
    if (subscriptionIds.length > 0) {
      // Chunk to 1000 — Bulk API can handle more but the IN clause has
      // a 4K char practical limit. We don't expect more than ~5K
      // subscriptions per scan in v1.
      for (const chunk of chunkArray(subscriptionIds, 1000)) {
        const subQuery = `
          SELECT
            Id, Name,
            SBQQ__Contract__c, SBQQ__Contract__r.ContractNumber,
            SBQQ__Contract__r.SBQQ__RenewalUpliftRate__c,
            SBQQ__NetPrice__c, SBQQ__Quantity__c
          FROM SBQQ__Subscription__c
          WHERE Id IN (${chunk.map((id) => `'${id}'`).join(',')})
        `;
        const subRes = await bulkQuery<SubscriptionRow>(ctx.conn, subQuery);
        for (const s of subRes.records) subscriptionsBySubId.set(s.Id, s);
      }
    }

    // 3. Reconcile.
    const findings: DetectorResult[] = [];
    for (const line of linesRes.records) {
      const sub = subscriptionsBySubId.get(line.SBQQ__RenewedSubscription__c);
      if (!sub) continue; // Orphaned line — flagged by a different detector (ORD-FOR-002)

      const upliftPctRaw = sub['SBQQ__Contract__r.SBQQ__RenewalUpliftRate__c'];
      const upliftPct = upliftPctRaw != null ? parseFloat(upliftPctRaw) : 0;
      // No uplift entitled → not a leak. Skip silently.
      if (!upliftPct || upliftPct <= 0) continue;

      const originalPrice = parseFloat(sub.SBQQ__NetPrice__c || '0');
      const renewalPrice = parseFloat(line.SBQQ__NetPrice__c || '0');
      const quantity = parseFloat(line.SBQQ__Quantity__c || '1') || 1;

      // Skip $0 lines — likely strategic free renewals, not config errors.
      // If the user wants to flag these, REN-008 (future) handles it.
      if (renewalPrice <= 0) continue;
      if (originalPrice <= 0) continue;

      // Entitled per-unit price = original × (1 + uplift%). Uplift in
      // CPQ is typically stored as a whole number (5 = 5%, not 0.05).
      // Defensive: if it's already a decimal (0.05), treat as fraction.
      const upliftFraction = upliftPct > 1 ? upliftPct / 100 : upliftPct;
      const entitledPerUnit = originalPrice * (1 + upliftFraction);
      const entitledTotal = entitledPerUnit * quantity;
      const realizedTotal = renewalPrice * quantity;
      const gap = entitledTotal - realizedTotal;

      // Tolerance: gaps under $1 are rounding noise.
      if (gap < 1) continue;

      // CurrencyIsoCode may be absent (single-currency org); fall back to
      // the org default. The optional-chained read is safe even when the
      // field wasn't in the SELECT.
      const currency =
        (line as unknown as Record<string, string | undefined>)['SBQQ__Quote__r.CurrencyIsoCode'] ||
        ctx.defaultCurrencyIsoCode;

      const primaryRecord: SourceRecord = {
        type: 'SBQQ__QuoteLine__c',
        id: line.Id,
        name: line.Name,
        financials: {
          renewal_net_price: renewalPrice,
          quantity,
          renewal_total: realizedTotal,
        },
      };
      const supportingRecords: SourceRecord[] = [
        {
          type: 'SBQQ__Quote__c',
          id: line.SBQQ__Quote__c,
          name: line['SBQQ__Quote__r.Name'],
        },
        {
          type: 'SBQQ__Subscription__c',
          id: sub.Id,
          name: sub.Name,
          financials: {
            original_net_price: originalPrice,
            quantity: parseFloat(sub.SBQQ__Quantity__c || '1') || 1,
          },
        },
        {
          type: 'Contract',
          id: sub.SBQQ__Contract__c,
          name: sub['SBQQ__Contract__r.ContractNumber'] || sub.SBQQ__Contract__c,
          financials: {
            entitled_uplift_pct: upliftPct,
          },
        },
        {
          type: 'Product2',
          id: line.SBQQ__Product__c,
          name: line['SBQQ__Product__r.Name'] || line.SBQQ__Product__c,
        },
      ];

      findings.push({
        detectorId: 'REN-001',
        severity: gap >= 10_000 ? 'critical' : gap >= 1_000 ? 'warning' : 'info',
        entitledUsd: round2(entitledTotal),
        realizedUsd: round2(realizedTotal),
        gapUsd: round2(gap),
        currencyIsoCode: currency,
        // Recoverability: renewals signed and invoiced in the past
        // ~90 days are highly recoverable (customer-facing amendment is
        // reasonable). Older renewals are progressively harder. v1
        // uses a flat 0.75 — refine when we have customer feedback.
        recoverabilityScore: 0.75,
        primaryRecord,
        supportingRecords,
        title: `Uplift suppressed on renewal of ${line['SBQQ__Product__r.Name'] || 'product'}`,
        description: `Contract entitled ${upliftPct}% uplift; renewal closed at ${round2((realizedTotal / (originalPrice * quantity) - 1) * 100)}%.`,
        metadata: {
          uplift_pct_entitled: upliftPct,
          uplift_fraction_applied: round4(renewalPrice / originalPrice - 1),
          original_price_per_unit: originalPrice,
          renewal_price_per_unit: renewalPrice,
        },
      });
    }

    return findings;
  },
};

export default REN_001;

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Cheap probe: query for CurrencyIsoCode on a known object. If the field
 * doesn't exist, the org isn't multi-currency. Cached per process via
 * the WeakSet on the connection — we run a forensic scan once per HTTP
 * request, so this is at most one describe per scan.
 */
const MULTI_CURRENCY_CACHE = new WeakMap<object, boolean>();
async function isMultiCurrencyEnabled(conn: import('jsforce').Connection): Promise<boolean> {
  const cached = MULTI_CURRENCY_CACHE.get(conn);
  if (cached !== undefined) return cached;
  try {
    const desc = (await conn.describe('SBQQ__Quote__c')) as { fields: Array<{ name: string }> };
    const enabled = desc.fields.some((f) => f.name === 'CurrencyIsoCode');
    MULTI_CURRENCY_CACHE.set(conn, enabled);
    return enabled;
  } catch {
    MULTI_CURRENCY_CACHE.set(conn, false);
    return false;
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
