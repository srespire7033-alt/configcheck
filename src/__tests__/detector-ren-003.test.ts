/**
 * REN-003 — Quote expired with no renewal action.
 */
import { describe, it, expect } from 'vitest';
import REN_003 from '@/lib/forensics/detectors/ren-003-expired-quote-no-renewal';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('REN-003 detector', () => {
  it('empty org → no findings', async () => {
    const conn = buildMockConn({ tables: { SBQQ__Quote__c: [] } });
    expect(await REN_003.run(makeCtx(conn))).toEqual([]);
  });

  it('expired quote with renewal opened after → not flagged', async () => {
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recentRenewal = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const conn = buildMockConn({
      tables: {
        SBQQ__Quote__c: [
          {
            Id: 'Q1', Name: 'Q-001',
            SBQQ__Account__c: 'A1', SBQQ__Account__r: { Name: 'Acme' },
            SBQQ__ExpirationDate__c: past, SBQQ__EndDate__c: past,
            SBQQ__NetAmount__c: 50000,
            SBQQ__Type__c: 'Quote', SBQQ__Status__c: 'Approved',
          },
        ],
      },
      queryOverrides: [
        (soql) => {
          if (soql.includes("SBQQ__Type__c = 'Renewal'")) {
            return { records: [{ SBQQ__Account__c: 'A1', CreatedDate: recentRenewal }] };
          }
          return null;
        },
      ],
    });
    const findings = await REN_003.run(makeCtx(conn));
    expect(findings).toHaveLength(0);
  });

  it('expired quote with NO renewal → flagged', async () => {
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const conn = buildMockConn({
      tables: {
        SBQQ__Quote__c: [
          {
            Id: 'Q1', Name: 'Q-001',
            SBQQ__Account__c: 'A1', SBQQ__Account__r: { Name: 'Acme' },
            SBQQ__ExpirationDate__c: past, SBQQ__EndDate__c: past,
            SBQQ__NetAmount__c: 50000,
            SBQQ__Type__c: 'Quote', SBQQ__Status__c: 'Approved',
          },
        ],
      },
    });
    const findings = await REN_003.run(makeCtx(conn));
    expect(findings).toHaveLength(1);
    expect(findings[0].gapUsd).toBe(50000);
    expect(findings[0].metadata?.account_id).toBe('A1');
  });
});
