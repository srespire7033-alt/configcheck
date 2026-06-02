/**
 * PROV-FOR-001 — Asset provisioned, no active subscription.
 */
import { describe, it, expect } from 'vitest';
import PROV_FOR_001 from '@/lib/forensics/detectors/prov-for-001-provisioned-not-billed';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('PROV-FOR-001 detector', () => {
  it('skips when Asset unavailable', async () => {
    const conn = buildMockConn({ describeMissingObjects: new Set(['Asset']) });
    expect(await PROV_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('Asset with matching active sub → not flagged', async () => {
    const conn = buildMockConn({
      tables: {
        Asset: [{ Id: 'AS1', Name: 'A-1', AccountId: 'A1', Product2Id: 'P1', Product2: { Name: 'Widget' }, Quantity: 10, Price: 100, Status: 'Installed', InstallDate: '2026-04-01' }],
        SBQQ__Subscription__c: [{ SBQQ__Account__c: 'A1', SBQQ__Product__c: 'P1' }],
      },
    });
    expect(await PROV_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('Asset without subscription → flagged', async () => {
    const conn = buildMockConn({
      tables: {
        Asset: [{ Id: 'AS1', Name: 'A-1', AccountId: 'A1', Product2Id: 'P1', Product2: { Name: 'Widget' }, Quantity: 10, Price: 100, Status: 'Installed', InstallDate: '2026-04-01' }],
        SBQQ__Subscription__c: [],
      },
    });
    const f = await PROV_FOR_001.run(makeCtx(conn));
    expect(f).toHaveLength(1);
    expect(f[0].gapUsd).toBe(1000); // 10 × $100
  });
});
