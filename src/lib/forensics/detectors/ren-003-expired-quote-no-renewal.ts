/**
 * REN-003 — Quote expired, no renewal action.
 *
 * SBQQ__Quote__c.SBQQ__ExpirationDate__c < TODAY (or implicit via
 * EndDate logic) AND no renewal Quote for the same Account was
 * created after the expiration. The customer's pricing window
 * lapsed and nobody opened a new one.
 *
 * Category: PIPELINE. The revenue isn't lost YET — but if nobody
 * acts, it will be. Annual contract value of the lapsed quote
 * becomes "at-risk ARR."
 *
 * Detection model:
 *   1. Pull quotes that expired in the last 90 days (window — older
 *      ones are stale leads, not actionable risk).
 *   2. For each, check if a Renewal quote exists for the same
 *      Account created AFTER the expiration date.
 *   3. If not, flag.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface QuoteRow {
  Id: string;
  Name: string;
  SBQQ__Account__c: string | null;
  SBQQ__ExpirationDate__c: string | null;
  SBQQ__EndDate__c: string | null;
  SBQQ__NetAmount__c: string | number | null;
  SBQQ__Type__c: string | null;
  SBQQ__Status__c: string | null;
  SBQQ__Account__r?: { Name?: string } | null;
}

const REN_003: ForensicDetector = {
  id: 'REN-003',
  label: 'Quote expired with no renewal action',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'pipeline',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    const todayIso = new Date().toISOString().slice(0, 10);
    // Use date-only (YYYY-MM-DD) for SBQQ__ExpirationDate__c / EndDate
    // (which are DATE fields), but full ISO datetime for CreatedDate
    // (which is a DATETIME field — SOQL rejects date-only literals).
    const ninetyDaysAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ninetyDaysAgoDt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Probe for SBQQ__ExpirationDate__c — not in every org.
    let hasExpirationDate = false;
    try {
      const qDesc = await ctx.conn.describe('SBQQ__Quote__c');
      hasExpirationDate = (qDesc.fields ?? []).some((f) => f.name === 'SBQQ__ExpirationDate__c');
    } catch {
      // describe failure — proceed without the field
    }

    // 1. Build the where clause: prefer SBQQ__ExpirationDate__c if it
    //    exists, else fall back to SBQQ__EndDate__c.
    const expClause = hasExpirationDate
      ? `(SBQQ__ExpirationDate__c < ${todayIso} AND SBQQ__ExpirationDate__c >= ${ninetyDaysAgoIso})`
      : `(SBQQ__EndDate__c < ${todayIso} AND SBQQ__EndDate__c >= ${ninetyDaysAgoIso})`;

    const expiredRes = await ctx.conn.query<QuoteRow>(`
      SELECT Id, Name, SBQQ__Account__c, ${hasExpirationDate ? 'SBQQ__ExpirationDate__c,' : ''} SBQQ__EndDate__c,
             SBQQ__NetAmount__c, SBQQ__Type__c, SBQQ__Status__c,
             SBQQ__Account__r.Name
      FROM SBQQ__Quote__c
      WHERE ${expClause}
        AND (SBQQ__Type__c IN ('Quote', 'Renewal') OR SBQQ__Type__c = null)
        AND SBQQ__Account__c != null
    `);
    console.log(`[REN-003] Quotes expired in last 90 days: ${expiredRes.records.length}`);
    if (expiredRes.records.length === 0) return [];

    // 2. Look for renewal quotes per account, created after each
    //    expired quote's expiration date. One query, all accounts.
    const accountIds = Array.from(new Set(
      expiredRes.records.map((q) => q.SBQQ__Account__c).filter((id): id is string => !!id)
    ));
    const renewalsByAccount = new Map<string, Array<{ created: string }>>();
    if (accountIds.length > 0) {
      for (let i = 0; i < accountIds.length; i += 500) {
        const chunk = accountIds.slice(i, i + 500);
        const renRes = await ctx.conn.query<{
          SBQQ__Account__c: string;
          CreatedDate: string;
        }>(`
          SELECT SBQQ__Account__c, CreatedDate
          FROM SBQQ__Quote__c
          WHERE SBQQ__Account__c IN (${chunk.map((id) => `'${id}'`).join(',')})
            AND SBQQ__Type__c = 'Renewal'
            AND CreatedDate >= ${ninetyDaysAgoDt}
        `);
        for (const r of renRes.records) {
          const list = renewalsByAccount.get(r.SBQQ__Account__c) ?? [];
          list.push({ created: r.CreatedDate });
          renewalsByAccount.set(r.SBQQ__Account__c, list);
        }
      }
    }

    // 3. Build findings.
    const findings: DetectorResult[] = [];
    for (const q of expiredRes.records) {
      if (!q.SBQQ__Account__c) continue;
      const expirationDate = (hasExpirationDate
        ? q.SBQQ__ExpirationDate__c
        : q.SBQQ__EndDate__c) ?? null;
      if (!expirationDate) continue;

      // Has any renewal quote been created AFTER this expiration?
      const renewals = renewalsByAccount.get(q.SBQQ__Account__c) ?? [];
      const hasRenewal = renewals.some((r) => new Date(r.created) > new Date(expirationDate));
      if (hasRenewal) continue;

      const accountName = q.SBQQ__Account__r?.Name ?? `Account ${q.SBQQ__Account__c}`;
      const arrAtRisk = Number(q.SBQQ__NetAmount__c ?? 0);
      const daysSinceExpiration = Math.floor(
        (Date.now() - new Date(expirationDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      const primaryRecord: SourceRecord = {
        type: 'SBQQ__Quote__c',
        id: q.Id,
        name: q.Name,
        financials: {
          net_amount: arrAtRisk,
          expiration_date: expirationDate,
          days_expired: daysSinceExpiration,
          quote_type: q.SBQQ__Type__c ?? 'Quote',
          quote_status: q.SBQQ__Status__c ?? null,
        },
      };
      const supportingRecords: SourceRecord[] = [
        { type: 'Account', id: q.SBQQ__Account__c, name: accountName },
      ];

      const ccy = ctx.defaultCurrencyIsoCode;
      // Severity escalates with time since expiration — the longer
      // nobody acts, the harder the customer is to bring back.
      const severity = daysSinceExpiration > 60 || arrAtRisk >= 100_000
        ? 'critical'
        : daysSinceExpiration > 30 || arrAtRisk >= 10_000
          ? 'warning'
          : 'info';

      findings.push({
        detectorId: 'REN-003',
        severity,
        // For pipeline findings: entitledUsd is "what we could keep
        // if action is taken." realizedUsd = 0 because nothing is
        // happening. gapUsd = the at-risk amount.
        entitledUsd: round2(arrAtRisk),
        realizedUsd: 0,
        gapUsd: round2(arrAtRisk),
        currencyIsoCode: ccy,
        // Recoverability: high if recent, dropping over time.
        recoverabilityScore: Math.max(0.3, 0.95 - daysSinceExpiration * 0.01),
        primaryRecord,
        supportingRecords,
        title: `Quote ${q.Name} expired ${daysSinceExpiration}d ago — no renewal opened (${ccy} ${Math.round(arrAtRisk).toLocaleString()} ARR at risk)`,
        description: `Quote for ${accountName} expired on ${expirationDate}. ${ccy} ${Math.round(arrAtRisk).toLocaleString()} of annual revenue is at risk. No renewal Quote has been created for this Account since the expiration. ${
          daysSinceExpiration > 60
            ? 'Customer is likely actively shopping or has churned.'
            : daysSinceExpiration > 30
              ? 'Pipeline rot — owner outreach needed this week.'
              : 'Window is still open — open a renewal Quote now.'
        }`,
        metadata: {
          quote_id: q.Id,
          quote_name: q.Name,
          account_id: q.SBQQ__Account__c,
          account_name: accountName,
          arr_at_risk: arrAtRisk,
          expiration_date: expirationDate,
          days_expired: daysSinceExpiration,
          quote_type: q.SBQQ__Type__c ?? 'Quote',
        },
      });
    }

    console.log(
      `[REN-003] Emitting ${findings.length} findings (sum ARR at risk = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`
    );
    return findings;
  },
};

export default REN_003;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
