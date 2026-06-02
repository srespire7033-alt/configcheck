/**
 * QL-FOR-002 — QuoteLine discount above approval threshold, no Approval.
 */
import { describe, it, expect } from 'vitest';
import QL_FOR_002 from '@/lib/forensics/detectors/ql-for-002-approval-skipped';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('QL-FOR-002 detector', () => {
  it('skips when Approval objects missing', async () => {
    const conn = buildMockConn({ describeMissingObjects: new Set(['SBQQ__ApprovalRule__c']) });
    expect(await QL_FOR_002.run(makeCtx(conn))).toEqual([]);
  });

  it('no parseable thresholds → no findings', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__ApprovalRule__c: [], // no rules with thresholds
        SBQQ__QuoteLine__c: [],
      },
    });
    expect(await QL_FOR_002.run(makeCtx(conn))).toEqual([]);
  });

  it('line discounted above threshold with no Approval → flagged', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__ApprovalRule__c: [{ Id: 'R1', Name: 'Rule', SBQQ__Active__c: true, SBQQ__DiscountAmount__c: 15 }],
        SBQQ__QuoteLine__c: [{
          Id: 'QL1', Name: 'QL-1',
          SBQQ__Quote__c: 'Q1', SBQQ__Quote__r: { Name: 'Q-1', SBQQ__Account__r: { Name: 'Acme' } },
          SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
          SBQQ__ListPrice__c: 100, SBQQ__NetPrice__c: 60, SBQQ__Quantity__c: 10,
          SBQQ__Discount__c: 40,
        }],
        SBQQ__Approval__c: [], // no approval recorded for QL1
      },
    });
    const f = await QL_FOR_002.run(makeCtx(conn));
    expect(f).toHaveLength(1);
    expect(f[0].gapUsd).toBe(0); // governance
    expect(f[0].metadata?.discount_pct).toBe(40);
    expect(f[0].metadata?.threshold_pct).toBe(15);
  });

  it('line with matching Approval → not flagged', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__ApprovalRule__c: [{ Id: 'R1', Name: 'Rule', SBQQ__Active__c: true, SBQQ__DiscountAmount__c: 15 }],
        SBQQ__QuoteLine__c: [{
          Id: 'QL1', Name: 'QL-1',
          SBQQ__Quote__c: 'Q1', SBQQ__Quote__r: { Name: 'Q-1', SBQQ__Account__r: { Name: 'Acme' } },
          SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
          SBQQ__ListPrice__c: 100, SBQQ__NetPrice__c: 60, SBQQ__Quantity__c: 10,
          SBQQ__Discount__c: 40,
        }],
        SBQQ__Approval__c: [{ Id: 'AP1', SBQQ__QuoteLine__c: 'QL1' }],
      },
    });
    expect(await QL_FOR_002.run(makeCtx(conn))).toEqual([]);
  });
});
