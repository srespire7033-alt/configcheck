/**
 * AST-FOR-001 — Asset terminated, sub still billing, no credit memo.
 */
import { describe, it, expect } from 'vitest';
import AST_FOR_001 from '@/lib/forensics/detectors/ast-for-001-terminated-no-credit';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('AST-FOR-001 detector', () => {
  it('skips when Asset unavailable', async () => {
    const conn = buildMockConn({ describeMissingObjects: new Set(['Asset']) });
    expect(await AST_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('terminated Asset with no active sub → not flagged', async () => {
    const conn = buildMockConn({
      tables: {
        Asset: [{ Id: 'AS1', Name: 'A-1', AccountId: 'A1', Product2Id: 'P1', Product2: { Name: 'Widget' }, Status: 'Terminated', UsageEndDate: '2026-04-01', Quantity: 10, Price: 100 }],
        SBQQ__Subscription__c: [],
      },
    });
    expect(await AST_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('terminated Asset + active sub → flagged', async () => {
    const conn = buildMockConn({
      describeMissingObjects: new Set(['blng__CreditMemo__c']),
      tables: {
        Asset: [{ Id: 'AS1', Name: 'A-1', AccountId: 'A1', Product2Id: 'P1', Product2: { Name: 'Widget' }, Status: 'Terminated', UsageEndDate: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10), Quantity: 10, Price: 100 }],
        SBQQ__Subscription__c: [{
          Id: 'S1', SBQQ__Account__c: 'A1', SBQQ__Product__c: 'P1',
          SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 100, SBQQ__SubscriptionEndDate__c: '2027-01-01',
        }],
      },
    });
    const f = await AST_FOR_001.run(makeCtx(conn));
    expect(f).toHaveLength(1);
    expect(f[0].gapUsd).toBe(1000); // 10 × $100
  });
});
