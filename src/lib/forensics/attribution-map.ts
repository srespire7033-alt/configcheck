/**
 * Attribution Map aggregator — turns a list of (finding, trace) pairs
 * into the consultant-deliverable ranked-root-cause view.
 *
 * Why this is the engine's hero output:
 * The per-finding drill-down answers "why did this one leak happen?"
 * Useful for an analyst. The attribution map answers "what 5 root
 * config objects, if fixed, recover the most $?" That second
 * question is what an engagement is scoped around.
 *
 * Aggregation rule:
 *   Group by (root_cause_class, root_config_type, root_config_id).
 *   Within a group:
 *     - sum gap_usd from related findings
 *     - count distinct findings
 *     - collect distinct detector_ids
 *     - keep highest-confidence reason code as the "primary"
 *     - keep up to N sample finding IDs for the UI to drill into
 *
 * Same root_config_id appearing across different classes (rare but
 * possible — e.g., a Price Rule that's both Class C and Class B in
 * different findings) is kept as separate rows. The class IS part of
 * the grouping key on purpose.
 *
 * Sort by total_gap_usd desc — biggest $ at the top, no other tiebreak.
 * Class color/priority is a UI concern, not aggregation concern.
 */

import type { RootCauseClass } from './types';

/**
 * Shape we need from the DB rows. Caller does the join.
 * (forensic_findings ff JOIN attribution_traces t ON t.finding_id = ff.id)
 */
export interface FindingWithTrace {
  finding_id: string;
  detector_id: string;
  gap_usd: number;
  currency_iso_code: string;
  root_cause_class: RootCauseClass;
  root_config_type: string;
  root_config_id: string | null;
  root_config_name: string;
  reason_code: string;
  confidence: number;
  ai_explanation: string | null;
  ai_suggested_fix: string | null;
}

export interface AttributionMapRow {
  root_cause_class: RootCauseClass;
  root_config_type: string;
  root_config_id: string | null;
  root_config_name: string;
  /** Best-explanation reason code (highest confidence wins ties broken arbitrarily). */
  primary_reason_code: string;
  /** Highest confidence across this root's findings. */
  max_confidence: number;
  /** Plain-English from the highest-confidence trace, useful for the row tooltip. */
  primary_explanation: string | null;
  primary_suggested_fix: string | null;
  /** Distinct detectors that contributed findings to this root. */
  detectors: string[];
  /** Number of findings rolled up under this root. */
  finding_count: number;
  /** Sum of gap_usd across those findings. */
  total_gap_usd: number;
  /** Currency for display. v1 assumes single-currency per org; mixed orgs need to revisit. */
  currency_iso_code: string;
  /** Sample finding IDs (capped at 20) so the UI can drill in without re-aggregating. */
  sample_finding_ids: string[];
}

const SAMPLE_FINDING_CAP = 20;

export function aggregateAttribution(rows: FindingWithTrace[]): AttributionMapRow[] {
  // Group key: class + type + id. Different classes pointing at the
  // same config object stay as separate rows.
  type GroupKey = string;
  function keyOf(r: FindingWithTrace): GroupKey {
    return `${r.root_cause_class}|${r.root_config_type}|${r.root_config_id ?? 'NULL'}`;
  }

  const groups = new Map<GroupKey, AttributionMapRow>();
  for (const row of rows) {
    const key = keyOf(row);
    let group = groups.get(key);
    if (!group) {
      group = {
        root_cause_class: row.root_cause_class,
        root_config_type: row.root_config_type,
        root_config_id: row.root_config_id,
        root_config_name: row.root_config_name,
        primary_reason_code: row.reason_code,
        max_confidence: row.confidence,
        primary_explanation: row.ai_explanation,
        primary_suggested_fix: row.ai_suggested_fix,
        detectors: [],
        finding_count: 0,
        total_gap_usd: 0,
        currency_iso_code: row.currency_iso_code,
        sample_finding_ids: [],
      };
      groups.set(key, group);
    }
    group.finding_count += 1;
    group.total_gap_usd += row.gap_usd;
    if (!group.detectors.includes(row.detector_id)) group.detectors.push(row.detector_id);
    // Higher-confidence row wins for the displayed explanation /
    // reason. Ties resolved by keeping the first-seen (stable enough).
    if (row.confidence > group.max_confidence) {
      group.max_confidence = row.confidence;
      group.primary_reason_code = row.reason_code;
      group.primary_explanation = row.ai_explanation;
      group.primary_suggested_fix = row.ai_suggested_fix;
    }
    if (group.sample_finding_ids.length < SAMPLE_FINDING_CAP) {
      group.sample_finding_ids.push(row.finding_id);
    }
  }

  return Array.from(groups.values())
    .map((g) => ({ ...g, total_gap_usd: Math.round(g.total_gap_usd * 100) / 100 }))
    .sort((a, b) => b.total_gap_usd - a.total_gap_usd);
}
