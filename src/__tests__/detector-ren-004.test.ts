/**
 * REN-004 — Renewal Quote stuck in Draft past contract end.
 */
import { describe, it, expect } from 'vitest';
import REN_004 from '@/lib/forensics/detectors/ren-004-renewal-quote-stuck-draft';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('REN-004 detector', () => {
  it('empty org → no findings', async () => {
    const conn = buildMockConn({ tables: { SBQQ__Quote__c: [] } });
    expect(await REN_004.run(makeCtx(conn))).toEqual([]);
  });

  it('renewal in stale status WITH past-end contract → flagged', async () => {
    const past = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const created = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const conn = buildMockConn({
      tables: {
        SBQQ__Quote__c: [{
          Id: 'Q1', Name: 'Q-001',
          SBQQ__Account__c: 'A1', SBQQ__Account__r: { Name: 'Acme' },
          SBQQ__Status__c: 'Draft',
          SBQQ__NetAmount__c: 65000,
          SBQQ__MasterContract__c: 'C1',
          SBQQ__MasterContract__r: { EndDate: past, ContractNumber: '00001' },
          CreatedDate: created, LastModifiedDate: created,
        }],
      },
    });
    const findings = await REN_004.run(makeCtx(conn));
    expect(findings).toHaveLength(1);
    expect(findings[0].gapUsd).toBe(65000);
    expect(findings[0].metadata?.days_overdue).toBeGreaterThan(0);
  });

  it('renewal with contract still active → not flagged', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const conn = buildMockConn({
      tables: {
        SBQQ__Quote__c: [{
          Id: 'Q1', Name: 'Q-001',
          SBQQ__Account__c: 'A1', SBQQ__Account__r: { Name: 'Acme' },
          SBQQ__Status__c: 'Draft',
          SBQQ__NetAmount__c: 65000,
          SBQQ__MasterContract__c: 'C1',
          SBQQ__MasterContract__r: { EndDate: future, ContractNumber: '00001' },
          CreatedDate: new Date().toISOString(), LastModifiedDate: new Date().toISOString(),
        }],
      },
    });
    expect(await REN_004.run(makeCtx(conn))).toHaveLength(0);
  });

  it('severity escalates with days_overdue', async () => {
    const veryStale = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const conn = buildMockConn({
      tables: {
        SBQQ__Quote__c: [{
          Id: 'Q1', Name: 'Q-001',
          SBQQ__Account__c: 'A1', SBQQ__Account__r: { Name: 'Acme' },
          SBQQ__Status__c: 'Draft',
          SBQQ__NetAmount__c: 5000,
          SBQQ__MasterContract__c: 'C1',
          SBQQ__MasterContract__r: { EndDate: veryStale, ContractNumber: '00001' },
          CreatedDate: new Date().toISOString(), LastModifiedDate: new Date().toISOString(),
        }],
      },
    });
    const f = await REN_004.run(makeCtx(conn));
    expect(f[0].severity).toBe('critical');
  });
});
