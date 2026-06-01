import { describe, it, expect, vi } from 'vitest';
import { verifyCommit } from '@/lib/forensics/commit-verifier';
import type { Connection } from 'jsforce';

// We don't want to spin up a real jsforce Connection in tests. The
// verifier only calls conn.query(soql). A minimal mock that returns a
// canned result per test is all we need.
function mockConn(queryResult: { records: Array<Record<string, unknown>> } | Error): Connection {
  return {
    query: vi.fn().mockImplementation(() => {
      if (queryResult instanceof Error) throw queryResult;
      return Promise.resolve(queryResult);
    }),
  } as unknown as Connection;
}

const baseFinding = (detectorId: string, over: Record<string, unknown> = {}) => ({
  id: 'F1',
  detector_id: detectorId,
  source_record_refs: {
    primary_record: { type: 'SBQQ__QuoteLine__c', id: 'a0X01', name: 'QL-1' },
  },
  metadata: {},
  ...over,
});

describe('verifyCommit', () => {
  describe('REN-001', () => {
    it('marks verified when NetPrice matches the corrected uplift price', async () => {
      const finding = baseFinding('REN-001', {
        metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 },
      });
      const conn = mockConn({ records: [{ SBQQ__NetPrice__c: 1050 }] });
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(true);
      expect(v?.expected_value).toBe(1050);
      expect(v?.actual_value).toBe(1050);
    });

    it('marks NOT verified when NetPrice still shows the un-uplifted value', async () => {
      const finding = baseFinding('REN-001', {
        metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 },
      });
      const conn = mockConn({ records: [{ SBQQ__NetPrice__c: 1000 }] });
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(false);
      expect(v?.message).toContain('1,000');
    });

    it('tolerates ±$1 float drift', async () => {
      const finding = baseFinding('REN-001', {
        metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 },
      });
      const conn = mockConn({ records: [{ SBQQ__NetPrice__c: 1050.5 }] });
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(true);
    });

    it('handles missing QuoteLine gracefully', async () => {
      const finding = baseFinding('REN-001', {
        metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 },
      });
      const conn = mockConn({ records: [] });
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(false);
      expect(v?.message).toContain('no longer exists');
    });
  });

  describe('REN-002', () => {
    it('verifies when NetPrice is within 10% of current list', async () => {
      const finding = baseFinding('REN-002', { metadata: { current_list_price: 1000 } });
      const conn = mockConn({ records: [{ SBQQ__NetPrice__c: 950 }] }); // 95% of list
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(true);
    });

    it('fails verification when NetPrice still below 90% of list', async () => {
      const finding = baseFinding('REN-002', { metadata: { current_list_price: 1000 } });
      const conn = mockConn({ records: [{ SBQQ__NetPrice__c: 700 }] });
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(false);
    });
  });

  describe('DSC-FOR-001', () => {
    it('verified when Discount is 0', async () => {
      const finding = baseFinding('DSC-FOR-001');
      const conn = mockConn({ records: [{ SBQQ__Discount__c: 0 }] });
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(true);
    });

    it('verified when Discount is null', async () => {
      const finding = baseFinding('DSC-FOR-001');
      const conn = mockConn({ records: [{ SBQQ__Discount__c: null }] });
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(true);
    });

    it('NOT verified when discount still present', async () => {
      const finding = baseFinding('DSC-FOR-001');
      const conn = mockConn({ records: [{ SBQQ__Discount__c: 25 }] });
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(false);
      expect(v?.message).toContain('25%');
    });
  });

  describe('ORD-FOR-001', () => {
    it('verified when Order now has at least one billing schedule', async () => {
      const finding = baseFinding('ORD-FOR-001', {
        source_record_refs: { primary_record: { type: 'Order', id: '801', name: 'O-1' } },
      });
      // Two queries: OrderItems, then BillingSchedules
      const conn = {
        query: vi.fn()
          .mockResolvedValueOnce({ records: [{ Id: '802' }] }) // items
          .mockResolvedValueOnce({ records: [{ Id: 'bs1' }, { Id: 'bs2' }] }), // schedules
      } as unknown as Connection;
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(true);
      expect(v?.actual_value).toBe(2);
    });

    it('NOT verified when Order still has zero schedules', async () => {
      const finding = baseFinding('ORD-FOR-001', {
        source_record_refs: { primary_record: { type: 'Order', id: '801', name: 'O-1' } },
      });
      const conn = {
        query: vi.fn()
          .mockResolvedValueOnce({ records: [{ Id: '802' }] })
          .mockResolvedValueOnce({ records: [] }),
      } as unknown as Connection;
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(false);
      expect(v?.actual_value).toBe(0);
    });

    it('reports manageable failure when Order has no OrderItems', async () => {
      const finding = baseFinding('ORD-FOR-001', {
        source_record_refs: { primary_record: { type: 'Order', id: '801', name: 'O-1' } },
      });
      const conn = {
        query: vi.fn().mockResolvedValueOnce({ records: [] }),
      } as unknown as Connection;
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(false);
      expect(v?.message).toContain('no OrderItems');
    });
  });

  describe('Unrecognized detectors', () => {
    it('returns null when there is no verifier for the detector', async () => {
      const finding = baseFinding('SOME_UNKNOWN_DETECTOR');
      const conn = mockConn({ records: [] });
      const v = await verifyCommit(finding, conn);
      expect(v).toBeNull();
    });
  });

  describe('Query failures', () => {
    it('surfaces a clean failure message when the SOQL throws', async () => {
      const finding = baseFinding('REN-001', {
        metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 },
      });
      const conn = mockConn(new Error('Salesforce returned 401'));
      const v = await verifyCommit(finding, conn);
      expect(v?.verified).toBe(false);
      expect(v?.message).toContain('401');
    });
  });
});
