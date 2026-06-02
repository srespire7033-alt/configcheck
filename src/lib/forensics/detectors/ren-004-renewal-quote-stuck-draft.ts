/**
 * REN-004 — Renewal Quote stuck in Draft past contract end.
 *
 * Pattern: an Account has a Renewal Quote (SBQQ__Type__c='Renewal')
 * that's never been approved, and the related Contract's EndDate is
 * already in the past. The renewal IS being worked but is sitting
 * in someone's queue — classic pipeline rot.
 *
 * Different from REN-003 (Quote expired with NO renewal opened) —
 * here the renewal Quote EXISTS but hasn't moved.
 *
 * Detection:
 *   1. Quotes with Type='Renewal' AND Status IN (Draft, In Review,
 *      In Review/Approval) AND SBQQ__MasterContract__c populated.
 *   2. For each, look up the MasterContract's EndDate.
 *   3. If EndDate < TODAY → stuck. ARR at risk = Quote.NetAmount.
 *
 * Category: pipeline (prospective, recoverable with action).
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface QuoteRow {
  Id: string;
  Name: string;
  SBQQ__Account__c: string | null;
  SBQQ__Account__r?: { Name?: string } | null;
  SBQQ__Status__c: string | null;
  SBQQ__NetAmount__c: string | number | null;
  SBQQ__MasterContract__c: string | null;
  SBQQ__MasterContract__r?: { EndDate?: string | null; ContractNumber?: string } | null;
  CreatedDate: string;
  LastModifiedDate: string;
}

const STALE_STATUSES = ['Draft', 'In Review', 'In Review/Approval', 'Pending', 'Pending Approval', 'Saved'];

const REN_004: ForensicDetector = {
  id: 'REN-004',
  label: 'Renewal Quote stuck in Draft past contract end',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'pipeline',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    const todayIso = new Date().toISOString().slice(0, 10);
    const statusList = STALE_STATUSES.map((s) => `'${s}'`).join(',');

    const res = await ctx.conn.query<QuoteRow>(`
      SELECT Id, Name, SBQQ__Account__c, SBQQ__Account__r.Name,
             SBQQ__Status__c, SBQQ__NetAmount__c,
             SBQQ__MasterContract__c, SBQQ__MasterContract__r.EndDate,
             SBQQ__MasterContract__r.ContractNumber,
             CreatedDate, LastModifiedDate
      FROM SBQQ__Quote__c
      WHERE SBQQ__Type__c = 'Renewal'
        AND SBQQ__Status__c IN (${statusList})
        AND SBQQ__MasterContract__c != null
    `);
    console.log(`[REN-004] Renewal quotes in stale status: ${res.records.length}`);
    if (res.records.length === 0) return [];

    const findings: DetectorResult[] = [];
    for (const q of res.records) {
      const contractEnd = q.SBQQ__MasterContract__r?.EndDate ?? null;
      if (!contractEnd) continue;
      if (new Date(contractEnd) >= new Date(todayIso)) continue;

      const daysOverdue = Math.floor(
        (Date.now() - new Date(contractEnd).getTime()) / (1000 * 60 * 60 * 24)
      );
      const arrAtRisk = Number(q.SBQQ__NetAmount__c ?? 0);
      const daysSinceTouched = Math.floor(
        (Date.now() - new Date(q.LastModifiedDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      const accountName = q.SBQQ__Account__r?.Name ?? `Account ${q.SBQQ__Account__c ?? 'unknown'}`;
      const ccy = ctx.defaultCurrencyIsoCode;

      const primaryRecord: SourceRecord = {
        type: 'SBQQ__Quote__c',
        id: q.Id,
        name: q.Name,
        financials: {
          net_amount: arrAtRisk,
          status: q.SBQQ__Status__c,
          contract_end_date: contractEnd,
          days_overdue: daysOverdue,
          days_since_touched: daysSinceTouched,
        },
      };
      const supportingRecords: SourceRecord[] = [];
      if (q.SBQQ__Account__c) {
        supportingRecords.push({ type: 'Account', id: q.SBQQ__Account__c, name: accountName });
      }
      if (q.SBQQ__MasterContract__c) {
        supportingRecords.push({
          type: 'Contract',
          id: q.SBQQ__MasterContract__c,
          name: q.SBQQ__MasterContract__r?.ContractNumber ?? `Contract ${q.SBQQ__MasterContract__c}`,
        });
      }

      const severity = daysOverdue > 90 ? 'critical' : daysOverdue > 30 ? 'warning' : 'info';

      findings.push({
        detectorId: 'REN-004',
        severity,
        entitledUsd: round2(arrAtRisk),
        realizedUsd: 0,
        gapUsd: round2(arrAtRisk),
        currencyIsoCode: ccy,
        // Quote still exists — work is partially done. But recoverability
        // drops with time (customer goes silent).
        recoverabilityScore: Math.max(0.3, 0.9 - daysOverdue * 0.005),
        primaryRecord,
        supportingRecords,
        title: `Renewal Quote ${q.Name} ${daysOverdue}d past contract end — still in ${q.SBQQ__Status__c} (${ccy} ${Math.round(arrAtRisk).toLocaleString()} ARR)`,
        description: `Renewal Quote for ${accountName} sits in '${q.SBQQ__Status__c}' status. Contract ended ${daysOverdue} days ago. Last touched ${daysSinceTouched} days ago. ${ccy} ${Math.round(arrAtRisk).toLocaleString()} of annual revenue at risk.`,
        metadata: {
          quote_id: q.Id,
          quote_name: q.Name,
          account_id: q.SBQQ__Account__c,
          account_name: accountName,
          status: q.SBQQ__Status__c,
          contract_id: q.SBQQ__MasterContract__c,
          contract_end_date: contractEnd,
          days_overdue: daysOverdue,
          days_since_touched: daysSinceTouched,
          arr_at_risk: arrAtRisk,
        },
      });
    }

    console.log(
      `[REN-004] Emitting ${findings.length} findings (sum ARR = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`
    );
    return findings;
  },
};

export default REN_004;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
