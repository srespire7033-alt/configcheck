/**
 * AMD-FOR-001 — Amendment Quote without effective date.
 *
 * Pattern: SBQQ__Quote__c with Type='Amendment' but
 * SBQQ__StartDate__c is null. CPQ's amendment math relies on the
 * start date to compute prorations and co-term math. Missing date
 * means pricing math is ambiguous + audit trail is broken.
 *
 * Category: governance. No $ leak claim — just a process gap that
 * needs cleanup.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface AmdRow {
  Id: string;
  Name: string;
  SBQQ__Account__c: string | null;
  SBQQ__Account__r?: { Name?: string } | null;
  SBQQ__Status__c: string | null;
  SBQQ__NetAmount__c: string | number | null;
  SBQQ__StartDate__c: string | null;
  SBQQ__EndDate__c: string | null;
  CreatedDate: string;
}

const AMD_FOR_001: ForensicDetector = {
  id: 'AMD-FOR-001',
  label: 'Amendment Quote missing effective date',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'governance',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    const sinceIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const res = await ctx.conn.query<AmdRow>(`
      SELECT Id, Name, SBQQ__Account__c, SBQQ__Account__r.Name,
             SBQQ__Status__c, SBQQ__NetAmount__c,
             SBQQ__StartDate__c, SBQQ__EndDate__c, CreatedDate
      FROM SBQQ__Quote__c
      WHERE SBQQ__Type__c = 'Amendment'
        AND SBQQ__StartDate__c = null
        AND CreatedDate >= ${sinceIso}
    `);
    console.log(`[AMD-FOR-001] Amendments missing StartDate: ${res.records.length}`);
    if (res.records.length === 0) return [];

    const findings: DetectorResult[] = [];
    for (const a of res.records) {
      const accountName = a.SBQQ__Account__r?.Name ?? `Account ${a.SBQQ__Account__c ?? 'unknown'}`;
      const netAmount = Number(a.SBQQ__NetAmount__c ?? 0);
      const ccy = ctx.defaultCurrencyIsoCode;

      const primaryRecord: SourceRecord = {
        type: 'SBQQ__Quote__c',
        id: a.Id,
        name: a.Name,
        financials: {
          net_amount: netAmount,
          status: a.SBQQ__Status__c,
          start_date: a.SBQQ__StartDate__c,
          end_date: a.SBQQ__EndDate__c,
        },
      };
      const supportingRecords: SourceRecord[] = a.SBQQ__Account__c
        ? [{ type: 'Account', id: a.SBQQ__Account__c, name: accountName }]
        : [];

      findings.push({
        detectorId: 'AMD-FOR-001',
        severity: 'warning',
        entitledUsd: round2(netAmount),
        realizedUsd: round2(netAmount),
        gapUsd: 0,
        currencyIsoCode: ccy,
        recoverabilityScore: 0.7,
        primaryRecord,
        supportingRecords,
        title: `Amendment Quote ${a.Name} has no effective date — proration math undefined`,
        description: `Amendment Quote for ${accountName} (${ccy} ${Math.round(netAmount).toLocaleString()}) is missing SBQQ__StartDate__c. CPQ uses this field for proration / co-term math; without it, downstream Subscription start dates may be incorrect and the amendment's $ allocation across periods is ambiguous.`,
        metadata: {
          quote_id: a.Id,
          account_id: a.SBQQ__Account__c,
          account_name: accountName,
          status: a.SBQQ__Status__c,
          net_amount: netAmount,
          end_date: a.SBQQ__EndDate__c,
        },
      });
    }

    console.log(`[AMD-FOR-001] Emitting ${findings.length} findings`);
    return findings;
  },
};

export default AMD_FOR_001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
