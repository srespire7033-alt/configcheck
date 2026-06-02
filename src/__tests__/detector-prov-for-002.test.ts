/**
 * PROV-FOR-002 — Active subscription with no Asset.
 */
import { describe, it, expect } from 'vitest';
import PROV_FOR_002 from '@/lib/forensics/detectors/prov-for-002-sub-no-asset';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('PROV-FOR-002 detector', () => {
  it('skips when Asset unavailable', async () => {
    const conn = buildMockConn({ describeMissingObjects: new Set(['Asset']) });
    expect(await PROV_FOR_002.run(makeCtx(conn))).toEqual([]);
  });

  it('sub with matching Asset → not flagged', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__Subscription__c: [{
          Id: 'S1', Name: 'Sub-1', SBQQ__Account__c: 'A1', SBQQ__Account__r: { Name: 'Acme' },
          SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
          SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 100,
        }],
        Asset: [{ AccountId: 'A1', Product2Id: 'P1', Status: 'Installed' }],
      },
    });
    expect(await PROV_FOR_002.run(makeCtx(conn))).toEqual([]);
  });

  it('sub without Asset → flagged', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__Subscription__c: [{
          Id: 'S1', Name: 'Sub-1', SBQQ__Account__c: 'A1', SBQQ__Account__r: { Name: 'Acme' },
          SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
          SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 100,
        }],
        Asset: [],
      },
    });
    const f = await PROV_FOR_002.run(makeCtx(conn));
    expect(f).toHaveLength(1);
    expect(f[0].gapUsd).toBe(1000);
  });
});
