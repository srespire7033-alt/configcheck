/**
 * Staleness classifier for portfolio comparison.
 *
 * Default threshold is 7 days. Rationale (for the go-live calculus):
 *   - 24h is too tight for paid consultants demoing the same orgs daily
 *     — they'd burn quota every demo.
 *   - 30 days is too loose to look credible — a scan from last month
 *     can miss a critical config change made yesterday.
 *   - 7 days lines up with the typical engagement cadence (weekly check-in
 *     with the client) and keeps free-tier quota reasonable.
 *
 * The user can override per-org in the pre-flight modal anyway, so this
 * is just the default that pre-fills the modal.
 */

export type StalenessBucket = 'fresh' | 'stale' | 'never';

export const DEFAULT_STALENESS_DAYS = 7;

export interface OrgScanRef {
  org_id: string;
  last_scan_at: string | null;
}

export interface StalenessVerdict {
  org_id: string;
  bucket: StalenessBucket;
  last_scan_at: string | null;
  age_days: number | null;
}

/**
 * Classify each org's most-recent scan as fresh/stale/never. Pure — given
 * a stable `now` and threshold, output is deterministic. Useful for the
 * pre-flight modal AND for unit tests.
 */
export function classifyStaleness(
  orgs: OrgScanRef[],
  thresholdDays: number = DEFAULT_STALENESS_DAYS,
  now: Date = new Date()
): StalenessVerdict[] {
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return orgs.map((o) => {
    if (!o.last_scan_at) {
      return { org_id: o.org_id, bucket: 'never' as const, last_scan_at: null, age_days: null };
    }
    const ageMs = now.getTime() - new Date(o.last_scan_at).getTime();
    // Negative age (future timestamp from a clock skew) we treat as fresh
    // rather than blow up. Defensive at the trust boundary.
    if (ageMs < 0) {
      return { org_id: o.org_id, bucket: 'fresh' as const, last_scan_at: o.last_scan_at, age_days: 0 };
    }
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    return {
      org_id: o.org_id,
      bucket: ageMs <= thresholdMs ? ('fresh' as const) : ('stale' as const),
      last_scan_at: o.last_scan_at,
      age_days: ageDays,
    };
  });
}

/**
 * Convenience: orgs that need a fresh scan to be safe in the comparison.
 * "never" and "stale" both qualify; "fresh" gets cached scan reuse.
 */
export function orgsNeedingScan(verdicts: StalenessVerdict[]): string[] {
  return verdicts.filter((v) => v.bucket !== 'fresh').map((v) => v.org_id);
}
