/**
 * OPP-FOR-001 — Closed-Won Opportunity, no Quote.
 *
 * Opportunity.StageName='Closed Won' but Opportunity.SBQQ__PrimaryQuote__c
 * is null. Deal booked, no quoting trail. Almost always means an
 * irregular order — pricing wasn't documented, approval wasn't
 * captured, and downstream provisioning/billing may or may not
 * have happened correctly.
 *
 * Category: GOVERNANCE. We don't claim a $ leak — Opportunity.Amount
 * is what the AE booked, which may already be invoiced + collected.
 * What's broken is the AUDIT TRAIL. Surface for manual review, not
 * for Data Loader patching.
 *
 * Window: last 12 months (cap how far back we audit).
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface OppRow {
  Id: string;
  Name: string;
  AccountId: string | null;
  Amount: string | number | null;
  CloseDate: string;
  StageName: string;
  CreatedDate: string;
  SBQQ__PrimaryQuote__c: string | null;
  Account: { Name?: string } | null;
}

const OPP_FOR_001: ForensicDetector = {
  id: 'OPP-FOR-001',
  label: 'Closed-Won Opportunity has no Primary Quote',
  appliesTo: ['cpq', 'cpq_billing', 'arm'],
  freeTier: false,
  category: 'governance',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    const sinceIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const res = await ctx.conn.query<OppRow>(`
      SELECT Id, Name, AccountId, Amount, CloseDate, StageName, CreatedDate,
             SBQQ__PrimaryQuote__c, Account.Name
      FROM Opportunity
      WHERE StageName = 'Closed Won'
        AND CloseDate >= ${sinceIso}
        AND SBQQ__PrimaryQuote__c = null
    `);
    console.log(`[OPP-FOR-001] Closed-Won without Quote: ${res.records.length}`);
    if (res.records.length === 0) return [];

    const findings: DetectorResult[] = [];
    for (const opp of res.records) {
      const amount = Number(opp.Amount ?? 0);
      const accountName = opp.Account?.Name ?? `Account ${opp.AccountId ?? 'unknown'}`;
      const daysSinceClose = Math.floor(
        (Date.now() - new Date(opp.CloseDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      const primaryRecord: SourceRecord = {
        type: 'Opportunity',
        id: opp.Id,
        name: opp.Name,
        financials: {
          booked_amount: amount,
          close_date: opp.CloseDate,
          days_since_close: daysSinceClose,
        },
      };
      const supportingRecords: SourceRecord[] = opp.AccountId
        ? [{ type: 'Account', id: opp.AccountId, name: accountName }]
        : [];

      const ccy = ctx.defaultCurrencyIsoCode;
      findings.push({
        detectorId: 'OPP-FOR-001',
        // Governance findings are 'warning' by default — auditors care,
        // but the $ may not actually be lost. Critical only if very
        // large + very recent (suggests active leak).
        severity: amount >= 100_000 && daysSinceClose < 90 ? 'critical' : 'warning',
        // For governance, we report the booked amount as 'entitled'
        // but realized = entitled too (we don't actually know it's
        // unbilled — we just don't have a Quote to verify against).
        // Gap is intentionally 0 — this is NOT a $ leak claim.
        entitledUsd: round2(amount),
        realizedUsd: round2(amount),
        gapUsd: 0,
        currencyIsoCode: ccy,
        recoverabilityScore: 0.5, // requires manual investigation
        primaryRecord,
        supportingRecords,
        title: `Opportunity ${opp.Name} closed ${ccy} ${Math.round(amount).toLocaleString()} without a Quote`,
        description: `Deal closed ${daysSinceClose} days ago for ${accountName} at ${ccy} ${Math.round(amount).toLocaleString()}, but no Quote was created or linked. No pricing audit trail, no approval signature. Verify billing and pricing match the booked amount.`,
        metadata: {
          opportunity_id: opp.Id,
          opportunity_name: opp.Name,
          account_id: opp.AccountId,
          account_name: accountName,
          booked_amount: amount,
          close_date: opp.CloseDate,
          days_since_close: daysSinceClose,
        },
      });
    }

    console.log(
      `[OPP-FOR-001] Emitting ${findings.length} findings (sum booked = $${Math.round(findings.reduce((s, f) => s + Number(f.entitledUsd), 0)).toLocaleString()})`
    );
    return findings;
  },
};

export default OPP_FOR_001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
