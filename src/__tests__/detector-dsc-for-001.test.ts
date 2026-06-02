/**
 * DSC-FOR-001 — Promo discount roll-off failure.
 */
import { describe, it, expect } from 'vitest';
import DSC_FOR_001 from '@/lib/forensics/detectors/dsc-for-001-promo-rolloff';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('DSC-FOR-001 detector', () => {
  it('empty org → no findings', async () => {
    const conn = buildMockConn({ tables: { SBQQ__QuoteLine__c: [] } });
    expect(await DSC_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('lines without a discount schedule are not flagged', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__QuoteLine__c: [{
          Id: 'QL1', SBQQ__Discount__c: '10',
          SBQQ__DiscountSchedule__c: null,
        }],
        SBQQ__DiscountSchedule__c: [],
      },
    });
    expect(await DSC_FOR_001.run(makeCtx(conn))).toEqual([]);
  });
});
