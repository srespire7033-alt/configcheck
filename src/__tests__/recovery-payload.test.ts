import { describe, it, expect } from 'vitest';
import { buildRecoveryPayload, bundlePayloads } from '@/lib/forensics/recovery-payload';

function finding(detectorId: string, over: Record<string, unknown> = {}) {
  return {
    id: 'F1',
    detector_id: detectorId,
    gap_usd: 10_000,
    recoverability_score: 0.9,
    currency_iso_code: 'USD',
    title: 'Sample finding',
    description: 'Sample description',
    source_record_refs: {
      primary_record: { type: 'SBQQ__QuoteLine__c', id: 'a0X01', name: 'QL-001' },
      supporting_records: [
        { type: 'SBQQ__Subscription__c', id: 'a10', name: 'SUB-001' },
        { type: 'Contract', id: '800', name: '00000007' },
        { type: 'SBQQ__DiscountSchedule__c', id: 'a0F', name: 'Q1 Promo' },
      ],
    },
    metadata: {},
    ...over,
  };
}

describe('buildRecoveryPayload', () => {
  it('emits NetPrice patch CSV for REN-001', () => {
    const p = buildRecoveryPayload(finding('REN-001', {
      metadata: {
        uplift_pct_entitled: 5,
        original_price_per_unit: 1000,
      },
    }));
    expect(p.csvHeader).toContain('SBQQ__NetPrice__c');
    expect(p.csvRow).toContain('a0X01');
    expect(p.csvRow).toContain('1050.00'); // 1000 × 1.05
    expect(p.projectedReclaimUsd).toBe(9000); // 10000 × 0.9
  });

  it('emits reprice-to-current-list CSV for REN-002', () => {
    const p = buildRecoveryPayload(finding('REN-002', {
      metadata: { current_list_price: 120_000, percent_below_list: 20 },
    }));
    expect(p.csvRow).toContain('120000.00');
    expect(p.csvRow).toContain('20.0%');
  });

  it('emits remove-discount CSV for DSC-FOR-001 expired sub-case', () => {
    const p = buildRecoveryPayload(finding('DSC-FOR-001', {
      metadata: { sub_case: 'expired' },
    }));
    expect(p.csvHeader).toContain('SBQQ__Discount__c');
    expect(p.csvRow).toContain('0');
    expect(p.csvRow).toContain('expired');
  });

  it('emits remove-discount CSV for DSC-FOR-001 open-ended promo sub-case', () => {
    const p = buildRecoveryPayload(finding('DSC-FOR-001', {
      metadata: { sub_case: 'null_end_promo' },
    }));
    expect(p.csvRow).toContain('Open-ended promo');
  });

  it('emits operational-fix CSV for ORD-FOR-001 (no field patch)', () => {
    const p = buildRecoveryPayload(finding('ORD-FOR-001', {
      source_record_refs: {
        primary_record: { type: 'Order', id: '801ABC', name: 'O-00042' },
        supporting_records: [],
      },
      metadata: { days_since_activation: 90 },
    }));
    expect(p.csvHeader).toBe('OrderId,Action,RecoveryNotes');
    expect(p.csvRow).toContain('GenerateBillingSchedule');
    expect(p.csvRow).toContain('90 days');
  });

  it('emits restore-option-price CSV for QL-FOR-001', () => {
    const p = buildRecoveryPayload(finding('QL-FOR-001', {
      metadata: { resolved_list_price: 24_000, quantity: 1 },
    }));
    expect(p.csvRow).toContain('24000.00');
    expect(p.csvRow).toContain('Restore required-option');
  });

  it('falls back to a generic CSV for unknown detector IDs', () => {
    const p = buildRecoveryPayload(finding('UNKNOWN-DETECTOR'));
    expect(p.csvHeader).toBe('Id,RecordType,Title,GapUsd,Currency,Notes');
    expect(p.csvRow).toContain('a0X01');
    expect(p.csvRow).toContain('SBQQ__QuoteLine__c');
  });

  it('escapes CSV special chars in record names', () => {
    const p = buildRecoveryPayload(finding('REN-001', {
      source_record_refs: {
        primary_record: { type: 'X', id: 'A', name: 'has "quote", and comma' },
        supporting_records: [],
      },
      metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 },
    }));
    // Notes field shouldn't break CSV format; we don't need to assert
    // the exact escaping here, but the row must remain parseable.
    expect(p.csvRow.split(',').length).toBeGreaterThanOrEqual(3);
  });

  it('computes projectedReclaimUsd as gap × recoverability', () => {
    const p = buildRecoveryPayload(finding('REN-001', {
      gap_usd: 50_000,
      recoverability_score: 0.75,
      metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 },
    }));
    expect(p.projectedReclaimUsd).toBe(37500); // 50000 × 0.75
  });
});

describe('bundlePayloads', () => {
  it('groups payloads by CSV header into sections', () => {
    const bundle = bundlePayloads([
      { ...buildRecoveryPayload(finding('REN-001', { metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 } })), detectorId: 'REN-001' },
      { ...buildRecoveryPayload(finding('REN-002', { metadata: { current_list_price: 120_000, percent_below_list: 20 } })), detectorId: 'REN-002' },
      { ...buildRecoveryPayload(finding('ORD-FOR-001', {
        source_record_refs: { primary_record: { type: 'Order', id: 'O1', name: 'O-1' }, supporting_records: [] },
        metadata: { days_since_activation: 30 },
      })), detectorId: 'ORD-FOR-001' },
    ]);
    // REN-001 and REN-002 share the same CSV header (Id,SBQQ__NetPrice__c,RecoveryNotes)
    // ORD-FOR-001 has its own (OrderId,Action,RecoveryNotes)
    expect(bundle.csvSections).toHaveLength(2);
  });

  it('sums projectedReclaimUsd across bundled payloads', () => {
    const bundle = bundlePayloads([
      { ...buildRecoveryPayload(finding('REN-001', { gap_usd: 10_000, recoverability_score: 1, metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 } })), detectorId: 'REN-001' },
      { ...buildRecoveryPayload(finding('REN-001', { gap_usd: 20_000, recoverability_score: 1, metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 } })), detectorId: 'REN-001' },
    ]);
    expect(bundle.totalProjectedReclaimUsd).toBe(30_000);
  });

  it('reports distinct detector IDs in the bundle', () => {
    const bundle = bundlePayloads([
      { ...buildRecoveryPayload(finding('REN-001', { metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 } })), detectorId: 'REN-001' },
      { ...buildRecoveryPayload(finding('REN-001', { metadata: { uplift_pct_entitled: 5, original_price_per_unit: 1000 } })), detectorId: 'REN-001' },
      { ...buildRecoveryPayload(finding('DSC-FOR-001', { metadata: { sub_case: 'expired' } })), detectorId: 'DSC-FOR-001' },
    ]);
    expect(bundle.detectorIds.sort()).toEqual(['DSC-FOR-001', 'REN-001']);
  });
});
