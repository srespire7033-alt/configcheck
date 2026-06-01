/**
 * CON-FOR-001 — Contract is Activated but all subscriptions expired.
 *
 * Contract.Status='Activated' and Contract.EndDate is in the future,
 * but every SBQQ__Subscription__c on the contract has
 * SBQQ__SubscriptionEndDate__c in the past. Means the contract
 * paper is live but the customer has nothing actively subscribed
 * under it.
 *
 * Two failure modes this catches:
 *   1. Renewal/amendment didn't propagate end-dates correctly —
 *      subscriptions died but the contract didn't get updated.
 *   2. Contract was activated without subscriptions ever being
 *      created (data-quality issue).
 *
 * Category: GOVERNANCE. No $ amount per se — we're flagging
 * inconsistent state, not lost revenue. Recovery is "audit and
 * decide" not "patch and reupload."
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface ContractRow {
  Id: string;
  ContractNumber: string;
  AccountId: string | null;
  StartDate: string | null;
  EndDate: string | null;
  Status: string;
  Account: { Name?: string } | null;
}

interface SubMaxRow {
  SBQQ__Contract__c: string | null;
  max_end: string | null;
  sub_count: number;
}

const CON_FOR_001: ForensicDetector = {
  id: 'CON-FOR-001',
  label: 'Contract activated, all subscriptions expired',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'governance',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    const todayIso = new Date().toISOString().slice(0, 10);

    // 1. Activated contracts that are still live on paper.
    const contractsRes = await ctx.conn.query<ContractRow>(`
      SELECT Id, ContractNumber, AccountId, StartDate, EndDate, Status, Account.Name
      FROM Contract
      WHERE Status = 'Activated'
        AND (EndDate > ${todayIso} OR EndDate = null)
    `);
    console.log(`[CON-FOR-001] Activated contracts in window: ${contractsRes.records.length}`);
    if (contractsRes.records.length === 0) return [];

    // 2. For each contract, aggregate subscription end dates.
    //    Use a GROUP BY query for efficiency — one SOQL call.
    const contractIds = contractsRes.records.map((c) => c.Id);
    const subStateByContract = new Map<string, { max_end: string | null; count: number }>();
    for (let i = 0; i < contractIds.length; i += 500) {
      const chunk = contractIds.slice(i, i + 500);
      const subRes = await ctx.conn.query<SubMaxRow>(`
        SELECT SBQQ__Contract__c, MAX(SBQQ__SubscriptionEndDate__c) max_end, COUNT(Id) sub_count
        FROM SBQQ__Subscription__c
        WHERE SBQQ__Contract__c IN (${chunk.map((id) => `'${id}'`).join(',')})
        GROUP BY SBQQ__Contract__c
      `);
      for (const row of subRes.records) {
        if (row.SBQQ__Contract__c) {
          subStateByContract.set(row.SBQQ__Contract__c, {
            max_end: row.max_end ?? null,
            count: Number(row.sub_count ?? 0),
          });
        }
      }
    }

    // 3. Flag contracts where ALL subscriptions have ended.
    const findings: DetectorResult[] = [];
    for (const c of contractsRes.records) {
      const state = subStateByContract.get(c.Id);
      const subCount = state?.count ?? 0;
      const maxEnd = state?.max_end ?? null;

      // Two flag conditions:
      //  A: contract has zero subscriptions at all (data quality)
      //  B: contract has subscriptions, but every one ended before today
      let flag: 'no_subs' | 'all_expired' | null = null;
      if (subCount === 0) {
        flag = 'no_subs';
      } else if (maxEnd && new Date(maxEnd) < new Date(todayIso)) {
        flag = 'all_expired';
      }
      if (!flag) continue;

      const accountName = c.Account?.Name ?? `Account ${c.AccountId ?? 'unknown'}`;
      const daysSinceStart = c.StartDate
        ? Math.floor((Date.now() - new Date(c.StartDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const primaryRecord: SourceRecord = {
        type: 'Contract',
        id: c.Id,
        name: c.ContractNumber,
        financials: {
          start_date: c.StartDate,
          end_date: c.EndDate,
          subscription_count: subCount,
          latest_subscription_end: maxEnd,
        },
      };
      const supportingRecords: SourceRecord[] = c.AccountId
        ? [{ type: 'Account', id: c.AccountId, name: accountName }]
        : [];

      const ccy = ctx.defaultCurrencyIsoCode;
      const title = flag === 'no_subs'
        ? `Contract ${c.ContractNumber} activated but has zero subscriptions`
        : `Contract ${c.ContractNumber} activated but all subscriptions expired`;
      const description = flag === 'no_subs'
        ? `Contract is in Activated status with EndDate ${c.EndDate ?? '(open-ended)'}, but no SBQQ__Subscription__c records reference it. Either the renewal/amendment skipped subscription creation, or the contract should never have been activated.`
        : `Contract is in Activated status with EndDate ${c.EndDate ?? '(open-ended)'}, but all ${subCount} subscription(s) on this contract ended by ${maxEnd}. Customer has nothing live under this contract — either it needs to be renewed/amended or its status corrected.`;

      findings.push({
        detectorId: 'CON-FOR-001',
        severity: 'warning',
        entitledUsd: 0,
        realizedUsd: 0,
        gapUsd: 0,
        currencyIsoCode: ccy,
        recoverabilityScore: 0.6,
        primaryRecord,
        supportingRecords,
        title,
        description,
        metadata: {
          contract_id: c.Id,
          contract_number: c.ContractNumber,
          account_id: c.AccountId,
          account_name: accountName,
          flag_reason: flag,
          subscription_count: subCount,
          latest_subscription_end: maxEnd,
          contract_end_date: c.EndDate,
          days_since_start: daysSinceStart,
        },
      });
    }

    console.log(`[CON-FOR-001] Emitting ${findings.length} findings`);
    return findings;
  },
};

export default CON_FOR_001;
