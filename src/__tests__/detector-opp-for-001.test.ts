/**
 * OPP-FOR-001 — Closed-Won Opportunity without Primary Quote.
 */
import { describe, it, expect } from 'vitest';
import OPP_FOR_001 from '@/lib/forensics/detectors/opp-for-001-closed-won-no-quote';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('OPP-FOR-001 detector', () => {
  it('empty org → no findings', async () => {
    const conn = buildMockConn({ tables: { Opportunity: [] } });
    expect(await OPP_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('Closed-Won WITHOUT Primary Quote → flagged', async () => {
    const conn = buildMockConn({
      tables: {
        Opportunity: [{
          Id: 'O1', Name: 'Deal-1', AccountId: 'A1', Amount: 100_000,
          CloseDate: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
          StageName: 'Closed Won', SBQQ__PrimaryQuote__c: null,
          Account: { Name: 'Acme' }, CreatedDate: new Date().toISOString(),
        }],
      },
    });
    const f = await OPP_FOR_001.run(makeCtx(conn));
    expect(f).toHaveLength(1);
    expect(f[0].gapUsd).toBe(0); // governance — no $ claim
    expect(f[0].entitledUsd).toBe(100_000); // booked amount
  });

  it('critical severity when large + recent', async () => {
    const conn = buildMockConn({
      tables: {
        Opportunity: [{
          Id: 'O1', Name: 'Deal-1', AccountId: 'A1', Amount: 500_000,
          CloseDate: new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10),
          StageName: 'Closed Won', SBQQ__PrimaryQuote__c: null,
          Account: { Name: 'Acme' }, CreatedDate: new Date().toISOString(),
        }],
      },
    });
    const f = await OPP_FOR_001.run(makeCtx(conn));
    expect(f[0].severity).toBe('critical');
  });
});
