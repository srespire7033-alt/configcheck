/**
 * CT-FOR-001 — Contracted Price expired but still applied.
 */
import { describe, it, expect } from 'vitest';
import CT_FOR_001 from '@/lib/forensics/detectors/ct-for-001-expired-contracted-price';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('CT-FOR-001 detector', () => {
  it('skips when SBQQ__ContractedPrice__c not in org', async () => {
    const conn = buildMockConn({ describeMissingObjects: new Set(['SBQQ__ContractedPrice__c']) });
    expect(await CT_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('non-expired contracted price → not flagged', async () => {
    const future = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const conn = buildMockConn({
      tables: {
        SBQQ__QuoteLine__c: [{
          Id: 'QL1', Name: 'QL-1',
          SBQQ__Quote__c: 'Q1', SBQQ__Quote__r: { Name: 'Q-1', SBQQ__Account__c: 'A1' },
          SBQQ__ContractedPrice__c: 'CP1', SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
          SBQQ__ListPrice__c: 200, SBQQ__NetPrice__c: 100, SBQQ__Quantity__c: 5,
        }],
        SBQQ__ContractedPrice__c: [{ Id: 'CP1', Name: 'CP-1', SBQQ__Price__c: 100, SBQQ__ExpirationDate__c: future }],
        PricebookEntry: [{ Product2Id: 'P1', UnitPrice: 200 }],
      },
    });
    expect(await CT_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('expired contracted price below current list → flagged', async () => {
    const past = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const conn = buildMockConn({
      tables: {
        SBQQ__QuoteLine__c: [{
          Id: 'QL1', Name: 'QL-1',
          SBQQ__Quote__c: 'Q1', SBQQ__Quote__r: { Name: 'Q-1', SBQQ__Account__c: 'A1' },
          SBQQ__ContractedPrice__c: 'CP1', SBQQ__Product__c: 'P1', SBQQ__Product__r: { Name: 'Widget' },
          SBQQ__ListPrice__c: 200, SBQQ__NetPrice__c: 100, SBQQ__Quantity__c: 5,
        }],
        SBQQ__ContractedPrice__c: [{ Id: 'CP1', Name: 'CP-1', SBQQ__Price__c: 100, SBQQ__ExpirationDate__c: past }],
        PricebookEntry: [{ Product2Id: 'P1', UnitPrice: 200 }],
      },
    });
    const f = await CT_FOR_001.run(makeCtx(conn));
    expect(f).toHaveLength(1);
    expect(f[0].gapUsd).toBe(500); // (200-100) × 5
  });
});
