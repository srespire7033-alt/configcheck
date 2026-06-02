/**
 * DSC-FOR-002 — Stacked discounts > 50% cap.
 */
import { describe, it, expect } from 'vitest';
import DSC_FOR_002 from '@/lib/forensics/detectors/dsc-for-002-stacked-discounts';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('DSC-FOR-002 detector', () => {
  it('empty org → no findings', async () => {
    const conn = buildMockConn({ tables: { SBQQ__QuoteLine__c: [] } });
    expect(await DSC_FOR_002.run(makeCtx(conn))).toEqual([]);
  });

  it('line with effective discount <= 50% → not flagged', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__QuoteLine__c: [{
          Id: 'QL1', Name: 'QL-1',
          SBQQ__Quote__c: 'Q1',
          SBQQ__Quote__r: { Name: 'Q-1', SBQQ__Account__c: 'A1', SBQQ__Account__r: { Name: 'Acme' } },
          SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
          SBQQ__ListPrice__c: 100, SBQQ__NetPrice__c: 60, // 40% effective discount
          SBQQ__Quantity__c: 10, SBQQ__Discount__c: 40,
        }],
      },
    });
    expect(await DSC_FOR_002.run(makeCtx(conn))).toHaveLength(0);
  });

  it('line with effective discount > 50% → flagged', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__QuoteLine__c: [{
          Id: 'QL1', Name: 'QL-1',
          SBQQ__Quote__c: 'Q1',
          SBQQ__Quote__r: { Name: 'Q-1', SBQQ__Account__c: 'A1', SBQQ__Account__r: { Name: 'Acme' } },
          SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
          SBQQ__ListPrice__c: 100, SBQQ__NetPrice__c: 30, // 70% effective discount
          SBQQ__Quantity__c: 10, SBQQ__Discount__c: 70,
        }],
      },
    });
    const f = await DSC_FOR_002.run(makeCtx(conn));
    expect(f).toHaveLength(1);
    // Gap = (cappedNet 50 - actualNet 30) × qty 10 = 200
    expect(f[0].gapUsd).toBe(200);
    expect(f[0].metadata?.effective_discount_pct).toBe(70);
  });

  it('critical severity when discount >= 75%', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__QuoteLine__c: [{
          Id: 'QL1', Name: 'QL-1',
          SBQQ__Quote__c: 'Q1',
          SBQQ__Quote__r: { Name: 'Q-1', SBQQ__Account__c: 'A1', SBQQ__Account__r: { Name: 'Acme' } },
          SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
          SBQQ__ListPrice__c: 100, SBQQ__NetPrice__c: 20, // 80%
          SBQQ__Quantity__c: 5, SBQQ__Discount__c: 80,
        }],
      },
    });
    const f = await DSC_FOR_002.run(makeCtx(conn));
    expect(f[0].severity).toBe('critical');
  });
});
