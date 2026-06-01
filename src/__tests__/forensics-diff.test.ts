/**
 * Forensic diff — pure-logic tests. No DB, no I/O. The API endpoint
 * is a thin shell over these functions; correctness of the diff
 * computation is verified here.
 */
import { describe, it, expect } from 'vitest';
import { computeDiff, type DiffFinding } from '@/lib/forensics/diff';

function f(over: Partial<DiffFinding> & Pick<DiffFinding, 'id' | 'detector_id' | 'primary_record_id' | 'gap_usd'>): DiffFinding {
  return {
    title: `Finding ${over.id}`,
    recoverability_score: 0.8,
    ...over,
  };
}

describe('computeDiff', () => {
  it('returns empty buckets when both scans are empty', () => {
    const d = computeDiff([], []);
    expect(d.new).toHaveLength(0);
    expect(d.escalated).toHaveLength(0);
    expect(d.resolved).toHaveLength(0);
    expect(d.improved).toHaveLength(0);
    expect(d.net_delta_usd).toBe(0);
  });

  it('classifies a fingerprint missing from `from` as NEW', () => {
    const to = [f({ id: '1', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 5000 })];
    const d = computeDiff([], to);
    expect(d.new).toHaveLength(1);
    expect(d.summary.new_count).toBe(1);
    expect(d.summary.new_total_usd).toBe(5000);
    expect(d.net_delta_usd).toBe(5000);
  });

  it('classifies a fingerprint missing from `to` as RESOLVED', () => {
    const from = [f({ id: '1', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 5000 })];
    const d = computeDiff(from, []);
    expect(d.resolved).toHaveLength(1);
    expect(d.summary.resolved_total_usd).toBe(5000);
    expect(d.net_delta_usd).toBe(-5000);
  });

  it('classifies a same fingerprint with bigger gap as ESCALATED', () => {
    const from = [f({ id: '1', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 3000 })];
    const to = [f({ id: '2', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 5000 })];
    const d = computeDiff(from, to);
    expect(d.escalated).toHaveLength(1);
    expect(d.escalated[0].delta_usd).toBe(2000);
    expect(d.escalated[0].prev_gap_usd).toBe(3000);
    expect(d.summary.escalated_total_usd).toBe(2000);
    expect(d.net_delta_usd).toBe(2000);
  });

  it('classifies a same fingerprint with smaller gap as IMPROVED', () => {
    const from = [f({ id: '1', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 5000 })];
    const to = [f({ id: '2', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 3000 })];
    const d = computeDiff(from, to);
    expect(d.improved).toHaveLength(1);
    expect(d.improved[0].delta_usd).toBe(-2000);
    expect(d.summary.improved_total_usd).toBe(2000); // absolute
    expect(d.net_delta_usd).toBe(-2000);
  });

  it('hides UNCHANGED findings (within $1 tolerance)', () => {
    const from = [f({ id: '1', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 5000 })];
    const to = [f({ id: '2', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 5000.5 })];
    const d = computeDiff(from, to);
    expect(d.new).toHaveLength(0);
    expect(d.escalated).toHaveLength(0);
    expect(d.improved).toHaveLength(0);
    expect(d.resolved).toHaveLength(0);
  });

  it('keeps detector boundaries — same record under two detectors is two fingerprints', () => {
    const from = [f({ id: '1', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 2000 })];
    const to = [
      f({ id: '2', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 2000 }), // unchanged
      f({ id: '3', detector_id: 'REN-002', primary_record_id: 'r1', gap_usd: 1000 }), // NEW
    ];
    const d = computeDiff(from, to);
    expect(d.new).toHaveLength(1);
    expect(d.new[0].detector_id).toBe('REN-002');
  });

  it('handles findings missing primary_record_id by collapsing to a placeholder bucket', () => {
    // Two with same detector but null record id collide into one fingerprint;
    // gap_usd comparison still works.
    const from = [f({ id: '1', detector_id: 'X', primary_record_id: null, gap_usd: 100 })];
    const to = [f({ id: '2', detector_id: 'X', primary_record_id: null, gap_usd: 250 })];
    const d = computeDiff(from, to);
    expect(d.escalated).toHaveLength(1);
    expect(d.escalated[0].delta_usd).toBe(150);
  });

  it('sorts each bucket by impact descending', () => {
    const to = [
      f({ id: 'a', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 100 }),
      f({ id: 'b', detector_id: 'REN-001', primary_record_id: 'r2', gap_usd: 5000 }),
      f({ id: 'c', detector_id: 'REN-001', primary_record_id: 'r3', gap_usd: 1500 }),
    ];
    const d = computeDiff([], to);
    expect(d.new.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('computes net delta % correctly when from_total > 0', () => {
    const from = [f({ id: '1', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 10000 })];
    const to = [f({ id: '2', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 13000 })];
    const d = computeDiff(from, to);
    expect(d.net_delta_pct).toBe(30); // +30% leak
  });

  it('returns 0% net delta when from_total is 0 (avoids divide-by-zero)', () => {
    const to = [f({ id: '2', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 100 })];
    const d = computeDiff([], to);
    expect(d.net_delta_pct).toBe(0); // 0% rather than Infinity
  });

  it('mixed scenario — all four buckets populated in one call', () => {
    const from = [
      f({ id: '1', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 5000 }),    // → escalated to 7000
      f({ id: '2', detector_id: 'REN-001', primary_record_id: 'r2', gap_usd: 3000 }),    // → improved to 1000
      f({ id: '3', detector_id: 'REN-001', primary_record_id: 'r3', gap_usd: 2000 }),    // → resolved (absent in to)
      f({ id: '4', detector_id: 'REN-001', primary_record_id: 'r4', gap_usd: 9000 }),    // → unchanged
    ];
    const to = [
      f({ id: '5', detector_id: 'REN-001', primary_record_id: 'r1', gap_usd: 7000 }),    // escalated
      f({ id: '6', detector_id: 'REN-001', primary_record_id: 'r2', gap_usd: 1000 }),    // improved
      f({ id: '7', detector_id: 'REN-001', primary_record_id: 'r4', gap_usd: 9000 }),    // unchanged
      f({ id: '8', detector_id: 'ORD-FOR-001', primary_record_id: 'o1', gap_usd: 800 }), // NEW
    ];
    const d = computeDiff(from, to);
    expect(d.new).toHaveLength(1);
    expect(d.escalated).toHaveLength(1);
    expect(d.resolved).toHaveLength(1);
    expect(d.improved).toHaveLength(1);
    expect(d.summary.new_total_usd).toBe(800);
    expect(d.summary.escalated_total_usd).toBe(2000);
    expect(d.summary.resolved_total_usd).toBe(2000);
    expect(d.summary.improved_total_usd).toBe(2000);
    // Net = (7000+1000+9000+800) − (5000+3000+2000+9000) = 17800 − 19000 = −1200
    expect(d.net_delta_usd).toBe(-1200);
  });
});
