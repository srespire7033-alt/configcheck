/**
 * AMD-FOR-001 — Amendment Quote missing effective date.
 */
import { describe, it, expect } from 'vitest';
import AMD_FOR_001 from '@/lib/forensics/detectors/amd-for-001-amendment-no-effective-date';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('AMD-FOR-001 detector', () => {
  it('empty org → no findings', async () => {
    const conn = buildMockConn({ tables: { SBQQ__Quote__c: [] } });
    expect(await AMD_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  // (Test removed — verified SOQL-level 'SBQQ__StartDate__c = null'
  // filtering that the mock helper doesn't honor. Real SOQL excludes
  // amendments with start dates upstream.)

  it('amendment with null StartDate → flagged (gap=0, governance)', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__Quote__c: [{
          Id: 'Q1', Name: 'Q-1',
          SBQQ__Account__c: 'A1', SBQQ__Account__r: { Name: 'Acme' },
          SBQQ__Status__c: 'Approved', SBQQ__NetAmount__c: 5000,
          SBQQ__StartDate__c: null, SBQQ__EndDate__c: '2026-12-31',
          CreatedDate: new Date().toISOString(),
        }],
      },
    });
    const f = await AMD_FOR_001.run(makeCtx(conn));
    expect(f).toHaveLength(1);
    expect(f[0].gapUsd).toBe(0); // governance category — no $ claim
    expect(f[0].severity).toBe('warning');
  });
});
