/**
 * REN-001 — Renewal uplift suppressed.
 * Detects renewal QuoteLines where the contracted SBQQ__RenewalUpliftRate__c
 * wasn't applied. Compares Subscription.NetPrice × (1+uplift) vs renewal's actual NetPrice.
 */
import { describe, it, expect } from 'vitest';
import REN_001 from '@/lib/forensics/detectors/ren-001-renewal-uplift';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('REN-001 detector', () => {
  it('emits no findings on an empty org', async () => {
    const conn = buildMockConn({ tables: { SBQQ__QuoteLine__c: [], Contract: [], SBQQ__Subscription__c: [] } });
    const f = await REN_001.run(makeCtx(conn));
    expect(f).toEqual([]);
  });

  it('clean renewals (uplift applied) produce no findings', async () => {
    // Renewal QuoteLine where SBQQ__NetPrice__c reflects the uplift.
    const conn = buildMockConn({
      tables: {
        SBQQ__QuoteLine__c: [
          {
            Id: 'QL1',
            Name: 'QL-1',
            SBQQ__Quote__c: 'Q1',
            SBQQ__Quote__r: { Name: 'Q-1', SBQQ__Type__c: 'Renewal', SBQQ__Account__c: 'A1' },
            SBQQ__Product__c: 'P1',
            SBQQ__Product__r: { Name: 'Widget' },
            SBQQ__Quantity__c: '10',
            SBQQ__ListPrice__c: '100',
            SBQQ__NetPrice__c: '105', // 5% uplift applied
            SBQQ__RenewedSubscription__c: 'S1',
            SBQQ__RenewedSubscription__r: {
              SBQQ__NetPrice__c: '100',
              SBQQ__Quantity__c: '10',
              SBQQ__Contract__c: 'C1',
              SBQQ__Contract__r: { SBQQ__RenewalUpliftRate__c: '5' },
            },
          },
        ],
      },
    });
    const f = await REN_001.run(makeCtx(conn));
    expect(f).toHaveLength(0);
  });

  it('handles non-renewal quote lines gracefully', async () => {
    const conn = buildMockConn({ tables: { SBQQ__QuoteLine__c: [] } });
    const f = await REN_001.run(makeCtx(conn));
    expect(f).toEqual([]);
  });
});
