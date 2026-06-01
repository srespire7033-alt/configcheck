/**
 * Forensic scan diff — pure logic.
 *
 * Compares two scans' findings by stable fingerprint:
 *   (detector_id, primary_record.id)
 *
 * Categorizes each fingerprint into one of five buckets:
 *
 *   new        — present in 'to' only
 *   escalated  — same fingerprint, gap_usd went UP by > tolerance
 *   improved   — same fingerprint, gap_usd went DOWN by > tolerance
 *   resolved   — present in 'from' only
 *   unchanged  — same fingerprint, gap_usd within ±$1 tolerance
 *
 * Pure functions. No DB, no I/O. Caller pulls findings from the two
 * scans and passes the arrays in; this module fingerprints, buckets,
 * sums.
 */

const TOLERANCE_USD = 1; // ±$1 = "same"

export interface DiffFinding {
  id: string;
  detector_id: string;
  title: string;
  gap_usd: number;
  recoverability_score: number;
  /** Primary record id used in fingerprinting. */
  primary_record_id: string | null;
}

export interface EscalatedFinding extends DiffFinding {
  prev_gap_usd: number;
  delta_usd: number; // signed: escalated > 0, improved < 0
}

export interface ForensicDiff {
  new: DiffFinding[];
  escalated: EscalatedFinding[];
  resolved: DiffFinding[];
  improved: EscalatedFinding[];
  // Aggregated headline
  net_delta_usd: number;
  net_delta_pct: number;
  from_total_usd: number;
  to_total_usd: number;
  summary: {
    new_count: number;
    new_total_usd: number;
    escalated_count: number;
    escalated_total_usd: number; // sum of POSITIVE deltas
    resolved_count: number;
    resolved_total_usd: number;
    improved_count: number;
    improved_total_usd: number; // sum of ABSOLUTE deltas (always positive)
  };
}

function fingerprint(f: DiffFinding): string {
  // primary_record_id may be null for very-rare detector edge cases.
  // Use 'no-record' bucket so they at least don't crash the diff —
  // they'll all collide into one fingerprint but that's harmless;
  // gap_usd-based bucketing still works.
  return `${f.detector_id}::${f.primary_record_id ?? 'no-record'}`;
}

export function computeDiff(from: DiffFinding[], to: DiffFinding[]): ForensicDiff {
  const fromByFp = new Map<string, DiffFinding>();
  for (const f of from) fromByFp.set(fingerprint(f), f);

  const toByFp = new Map<string, DiffFinding>();
  for (const f of to) toByFp.set(fingerprint(f), f);

  const result: ForensicDiff = {
    new: [],
    escalated: [],
    resolved: [],
    improved: [],
    net_delta_usd: 0,
    net_delta_pct: 0,
    from_total_usd: 0,
    to_total_usd: 0,
    summary: {
      new_count: 0,
      new_total_usd: 0,
      escalated_count: 0,
      escalated_total_usd: 0,
      resolved_count: 0,
      resolved_total_usd: 0,
      improved_count: 0,
      improved_total_usd: 0,
    },
  };

  // Pass 1: classify 'to' findings against 'from'.
  for (const tf of to) {
    result.to_total_usd += tf.gap_usd;
    const fp = fingerprint(tf);
    const prev = fromByFp.get(fp);
    if (!prev) {
      result.new.push(tf);
      result.summary.new_count += 1;
      result.summary.new_total_usd += tf.gap_usd;
      continue;
    }
    const delta = tf.gap_usd - prev.gap_usd;
    if (Math.abs(delta) <= TOLERANCE_USD) continue; // unchanged — skipped
    if (delta > 0) {
      result.escalated.push({ ...tf, prev_gap_usd: prev.gap_usd, delta_usd: delta });
      result.summary.escalated_count += 1;
      result.summary.escalated_total_usd += delta;
    } else {
      result.improved.push({ ...tf, prev_gap_usd: prev.gap_usd, delta_usd: delta });
      result.summary.improved_count += 1;
      result.summary.improved_total_usd += Math.abs(delta);
    }
  }

  // Pass 2: anything in 'from' but missing from 'to' is resolved.
  for (const ff of from) {
    result.from_total_usd += ff.gap_usd;
    const fp = fingerprint(ff);
    if (!toByFp.has(fp)) {
      result.resolved.push(ff);
      result.summary.resolved_count += 1;
      result.summary.resolved_total_usd += ff.gap_usd;
    }
  }

  // Net delta — positive = leaking MORE, negative = leaking less.
  result.net_delta_usd = round2(result.to_total_usd - result.from_total_usd);
  result.net_delta_pct = result.from_total_usd > 0
    ? round2(((result.to_total_usd - result.from_total_usd) / result.from_total_usd) * 100)
    : 0;
  result.from_total_usd = round2(result.from_total_usd);
  result.to_total_usd = round2(result.to_total_usd);

  // Sort each bucket by $ impact descending — UI displays top-N first.
  result.new.sort((a, b) => b.gap_usd - a.gap_usd);
  result.resolved.sort((a, b) => b.gap_usd - a.gap_usd);
  result.escalated.sort((a, b) => b.delta_usd - a.delta_usd);
  result.improved.sort((a, b) => Math.abs(b.delta_usd) - Math.abs(a.delta_usd));

  return result;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
