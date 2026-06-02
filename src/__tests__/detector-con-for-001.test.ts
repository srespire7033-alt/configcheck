/**
 * CON-FOR-001 — Contract activated but subscriptions expired / zero.
 */
import { describe, it, expect } from 'vitest';
import CON_FOR_001 from '@/lib/forensics/detectors/con-for-001-contract-no-active-subs';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('CON-FOR-001 detector', () => {
  it('empty org → no findings', async () => {
    const conn = buildMockConn({ tables: { Contract: [] } });
    expect(await CON_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('activated contract with no subs → flagged (no_subs)', async () => {
    const future = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
    const conn = buildMockConn({
      tables: {
        Contract: [{
          Id: 'C1', ContractNumber: '00001', AccountId: 'A1',
          StartDate: '2025-01-01', EndDate: future, Status: 'Activated',
          Account: { Name: 'Acme' },
        }],
        SBQQ__Subscription__c: [], // no related rows
      },
    });
    const f = await CON_FOR_001.run(makeCtx(conn));
    expect(f).toHaveLength(1);
    expect(f[0].metadata?.flag_reason).toBe('no_subs');
  });

  it('contract with active sub → not flagged', async () => {
    const future = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
    const futureSubEnd = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const conn = buildMockConn({
      tables: {
        Contract: [{
          Id: 'C1', ContractNumber: '00001', AccountId: 'A1',
          StartDate: '2025-01-01', EndDate: future, Status: 'Activated',
          Account: { Name: 'Acme' },
        }],
      },
      queryOverrides: [
        (soql) => {
          if (soql.includes('FROM SBQQ__Subscription__c') && soql.includes('GROUP BY')) {
            return { records: [{ SBQQ__Contract__c: 'C1', max_end: futureSubEnd, sub_count: 1 }] };
          }
          return null;
        },
      ],
    });
    expect(await CON_FOR_001.run(makeCtx(conn))).toEqual([]);
  });
});
