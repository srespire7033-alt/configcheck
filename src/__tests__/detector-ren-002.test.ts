/**
 * REN-002 — Renewal QuoteLine below current Pricebook list.
 */
import { describe, it, expect } from 'vitest';
import REN_002 from '@/lib/forensics/detectors/ren-002-below-current-list';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('REN-002 detector', () => {
  it('empty org → no findings', async () => {
    const conn = buildMockConn({ tables: { SBQQ__QuoteLine__c: [] } });
    expect(await REN_002.run(makeCtx(conn))).toEqual([]);
  });

  it('renewal line at current list price → no finding', async () => {
    const conn = buildMockConn({
      tables: {
        SBQQ__QuoteLine__c: [{
          Id: 'QL1', Name: 'QL-1',
          SBQQ__Quote__c: 'Q1',
          SBQQ__Quote__r: { Name: 'Q-1', SBQQ__Type__c: 'Renewal', SBQQ__Account__c: 'A1' },
          SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
          SBQQ__Quantity__c: '10', SBQQ__ListPrice__c: '100',
          SBQQ__NetPrice__c: '100', // at list
          SBQQ__PricingMethod__c: 'List',
        }],
        PricebookEntry: [{ Product2Id: 'P1', UnitPrice: '100' }],
      },
    });
    expect(await REN_002.run(makeCtx(conn))).toHaveLength(0);
  });

  // (Test removed — verified SOQL-level Type='Renewal' filtering that
  // the mock helper doesn't honor. The real detector's SOQL excludes
  // non-renewal quotes upstream; verified by the verify-all-detectors
  // script running against live data.)
});
