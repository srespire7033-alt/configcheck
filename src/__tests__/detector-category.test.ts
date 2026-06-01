/**
 * Detector category mapping — the load-bearing abstraction for
 * Slice 12. Every detector must land in exactly one category, and
 * the API + UI must agree on which.
 */
import { describe, it, expect } from 'vitest';
import { DETECTOR_CATEGORY, getDetectorCategory } from '@/lib/forensics/types';

describe('DETECTOR_CATEGORY', () => {
  it('classifies all 12 known detectors', () => {
    const ids = Object.keys(DETECTOR_CATEGORY);
    expect(ids).toContain('REN-001');
    expect(ids).toContain('REN-002');
    expect(ids).toContain('REN-003');
    expect(ids).toContain('DSC-FOR-001');
    expect(ids).toContain('QL-FOR-001');
    expect(ids).toContain('ORD-FOR-001');
    expect(ids).toContain('ORD-FOR-002');
    expect(ids).toContain('ORD-FOR-003');
    expect(ids).toContain('SUB-FOR-001');
    expect(ids).toContain('PROV-FOR-001');
    expect(ids).toContain('OPP-FOR-001');
    expect(ids).toContain('CON-FOR-001');
  });

  it('puts $-quantifiable retrospective leaks in revenue_leakage', () => {
    const revenueLeakage = [
      'REN-001', 'REN-002', 'DSC-FOR-001', 'QL-FOR-001',
      'ORD-FOR-001', 'ORD-FOR-002', 'ORD-FOR-003',
      'SUB-FOR-001', 'PROV-FOR-001',
    ];
    for (const id of revenueLeakage) {
      expect(DETECTOR_CATEGORY[id]).toBe('revenue_leakage');
    }
  });

  it('puts process/audit detectors in governance', () => {
    expect(DETECTOR_CATEGORY['OPP-FOR-001']).toBe('governance');
    expect(DETECTOR_CATEGORY['CON-FOR-001']).toBe('governance');
  });

  it('puts prospective ARR-at-risk detectors in pipeline', () => {
    expect(DETECTOR_CATEGORY['REN-003']).toBe('pipeline');
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
