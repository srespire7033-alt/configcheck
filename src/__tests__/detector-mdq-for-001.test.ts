/**
 * MDQ-FOR-001 — Multi-year segments priced flat (no YoY uplift).
 */
import { describe, it, expect } from 'vitest';
import MDQ_FOR_001 from '@/lib/forensics/detectors/mdq-for-001-segment-pricing';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('MDQ-FOR-001 detector', () => {
  it('skips when SBQQ__SegmentIndex__c not in org', async () => {
    const conn = buildMockConn({ describeMissingFields: new Set(['SBQQ__SegmentIndex__c']) });
    // Helper currently strips ALL fields when describeMissingFields is set;
    // describe-the-quote-line returns empty field list.
    expect(await MDQ_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('multi-year with correct uplift → not flagged', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__QuoteLine__c: [
          { Id: 'Y1', Name: 'Y1', SBQQ__Quote__c: 'Q1', SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
            SBQQ__NetPrice__c: 100, SBQQ__Quantity__c: 10, SBQQ__SegmentIndex__c: 0 },
          { Id: 'Y2', Name: 'Y2', SBQQ__Quote__c: 'Q1', SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
            SBQQ__NetPrice__c: 105, SBQQ__Quantity__c: 10, SBQQ__SegmentIndex__c: 1 },
          { Id: 'Y3', Name: 'Y3', SBQQ__Quote__c: 'Q1', SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
            SBQQ__NetPrice__c: 110.25, SBQQ__Quantity__c: 10, SBQQ__SegmentIndex__c: 2 },
        ],
      },
    });
    expect(await MDQ_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('flat pricing across segments → flagged with cumulative gap', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__QuoteLine__c: [
          { Id: 'Y1', Name: 'Y1', SBQQ__Quote__c: 'Q1', SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
            SBQQ__NetPrice__c: 100, SBQQ__Quantity__c: 10, SBQQ__SegmentIndex__c: 0 },
          { Id: 'Y2', Name: 'Y2', SBQQ__Quote__c: 'Q1', SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
            SBQQ__NetPrice__c: 100, SBQQ__Quantity__c: 10, SBQQ__SegmentIndex__c: 1 },
          { Id: 'Y3', Name: 'Y3', SBQQ__Quote__c: 'Q1', SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
            SBQQ__NetPrice__c: 100, SBQQ__Quantity__c: 10, SBQQ__SegmentIndex__c: 2 },
        ],
      },
    });
    const f = await MDQ_FOR_001.run(makeCtx(conn));
    expect(f).toHaveLength(1);
    // Y2 expected $105 (5% uplift): gap = 5 × 10 = 50
    // Y3 expected $110.25: gap = 10.25 × 10 = 102.5
    // Total: 152.5
    expect(f[0].gapUsd).toBeCloseTo(152.5, 1);
  });
});
