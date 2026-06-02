/**
 * SUB-FOR-001 — Subscription quantity drift vs Asset.
 */
import { describe, it, expect } from 'vitest';
import SUB_FOR_001 from '@/lib/forensics/detectors/sub-for-001-quantity-drift';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('SUB-FOR-001 detector', () => {
  it('skips when Asset object unavailable', async () => {
    const conn = buildMockConn({ describeMissingObjects: new Set(['Asset']) });
    expect(await SUB_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('matching Sub.Qty == Asset.Qty → no findings', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__Subscription__c: [{
          Id: 'S1', Name: 'Sub-1', SBQQ__Account__c: 'A1', SBQQ__Product__c: 'P1',
          SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 100,
          SBQQ__SubscriptionStartDate__c: '2026-01-01', SBQQ__SubscriptionEndDate__c: '2026-12-31',
        }],
        Asset: [{ Id: 'AS1', Name: 'Asset-1', AccountId: 'A1', Product2Id: 'P1', Product2: { Name: 'Widget' }, Quantity: 10, Status: 'Installed' }],
      },
    });
    expect(await SUB_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('Sub.Qty < Asset.Qty → under-billed finding', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__Subscription__c: [{
          Id: 'S1', Name: 'Sub-1', SBQQ__Account__c: 'A1', SBQQ__Product__c: 'P1',
          SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 100,
          SBQQ__SubscriptionStartDate__c: '2026-01-01', SBQQ__SubscriptionEndDate__c: '2026-12-31',
        }],
        Asset: [{ Id: 'AS1', Name: 'Asset-1', AccountId: 'A1', Product2Id: 'P1', Product2: { Name: 'Widget' }, Quantity: 15, Status: 'Installed' }],
      },
    });
    const f = await SUB_FOR_001.run(makeCtx(conn));
    expect(f).toHaveLength(1);
    expect(f[0].metadata?.direction).toBe('under_billed');
    expect(f[0].gapUsd).toBe(500); // 5 units × $100
  });

  it('Sub.Qty > Asset.Qty → over-billed finding', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__Subscription__c: [{
          Id: 'S1', Name: 'Sub-1', SBQQ__Account__c: 'A1', SBQQ__Product__c: 'P1',
          SBQQ__Quantity__c: 20, SBQQ__NetPrice__c: 100,
          SBQQ__SubscriptionStartDate__c: '2026-01-01', SBQQ__SubscriptionEndDate__c: '2026-12-31',
        }],
        Asset: [{ Id: 'AS1', Name: 'Asset-1', AccountId: 'A1', Product2Id: 'P1', Product2: { Name: 'Widget' }, Quantity: 12, Status: 'Installed' }],
      },
    });
    const f = await SUB_FOR_001.run(makeCtx(conn));
    expect(f[0].metadata?.direction).toBe('over_billed');
    expect(f[0].gapUsd).toBe(800);
  });
});
