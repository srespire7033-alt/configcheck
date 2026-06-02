/**
 * Detector category mapping — the load-bearing abstraction for
 * Slice 12. Every detector must land in exactly one category, and
 * the API + UI must agree on which.
 */
import { describe, it, expect } from 'vitest';
import { DETECTOR_CATEGORY, getDetectorCategory } from '@/lib/forensics/types';

describe('DETECTOR_CATEGORY', () => {
  it('classifies all 20 known detectors', () => {
    const ids = Object.keys(DETECTOR_CATEGORY);
    const expected = [
      'REN-001', 'REN-002', 'REN-003', 'REN-004',
      'DSC-FOR-001', 'DSC-FOR-002',
      'QL-FOR-001', 'QL-FOR-002',
      'ORD-FOR-001', 'ORD-FOR-002', 'ORD-FOR-003',
      'SUB-FOR-001', 'PROV-FOR-001', 'PROV-FOR-002',
      'OPP-FOR-001', 'CON-FOR-001', 'AMD-FOR-001',
      'AST-FOR-001', 'CT-FOR-001', 'MDQ-FOR-001',
    ];
    for (const e of expected) {
      expect(ids).toContain(e);
    }
  });

  it('puts $-quantifiable retrospective leaks in revenue_leakage', () => {
    const revenueLeakage = [
      'REN-001', 'REN-002', 'DSC-FOR-001', 'DSC-FOR-002', 'QL-FOR-001',
      'ORD-FOR-001', 'ORD-FOR-002', 'ORD-FOR-003',
      'SUB-FOR-001', 'PROV-FOR-001', 'PROV-FOR-002',
      'AST-FOR-001', 'CT-FOR-001', 'MDQ-FOR-001',
    ];
    for (const id of revenueLeakage) {
      expect(DETECTOR_CATEGORY[id]).toBe('revenue_leakage');
    }
  });

  it('puts process/audit detectors in governance', () => {
    expect(DETECTOR_CATEGORY['OPP-FOR-001']).toBe('governance');
    expect(DETECTOR_CATEGORY['CON-FOR-001']).toBe('governance');
    expect(DETECTOR_CATEGORY['AMD-FOR-001']).toBe('governance');
    expect(DETECTOR_CATEGORY['QL-FOR-002']).toBe('governance');
  });

  it('puts prospective ARR-at-risk detectors in pipeline', () => {
    expect(DETECTOR_CATEGORY['REN-003']).toBe('pipeline');
    expect(DETECTOR_CATEGORY['REN-004']).toBe('pipeline');
  });
});

describe('getDetectorCategory', () => {
  it('returns the mapped category when detector is known', () => {
    expect(getDetectorCategory('REN-001')).toBe('revenue_leakage');
    expect(getDetectorCategory('OPP-FOR-001')).toBe('governance');
    expect(getDetectorCategory('REN-003')).toBe('pipeline');
  });

  it('defaults unknown detectors to revenue_leakage (back-compat)', () => {
    // A future detector someone added to DB but forgot to register
    // in DETECTOR_CATEGORY: it should fall back to the safest bucket
    // (where it gets counted toward the headline $ figure, the
    // existing behavior).
    expect(getDetectorCategory('FUTURE-DETECTOR-X')).toBe('revenue_leakage');
    expect(getDetectorCategory('')).toBe('revenue_leakage');
  });

  it('handles every category enum value at least once', () => {
    // Sanity that the three buckets are all populated — if someone
    // accidentally drops the only detector in a category, the UI
    // will hide a whole card and we want this test to scream.
    const counts = { revenue_leakage: 0, governance: 0, pipeline: 0 };
    for (const id of Object.keys(DETECTOR_CATEGORY)) {
      counts[DETECTOR_CATEGORY[id]] += 1;
    }
    expect(counts.revenue_leakage).toBeGreaterThan(0);
    expect(counts.governance).toBeGreaterThan(0);
    expect(counts.pipeline).toBeGreaterThan(0);
  });
});
