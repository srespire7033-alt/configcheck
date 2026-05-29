/**
 * Industry benchmark lookup — DORMANT until we have ≥5 customers per industry.
 *
 * Goal: when the Revenue Leakage card shows "your org loses $X/yr", we
 * want to add a second line — "median saas org in our data loses $Y/yr;
 * you're at the 73rd percentile." That's what turns a passive estimate
 * into a competitive nudge.
 *
 * Today: zero rows in industry_benchmarks. Every lookup returns null,
 * and the UI gracefully skips the percentile line. No customer-visible
 * change.
 *
 * Tomorrow (once we cross 5 customers per industry): a nightly cron
 * populates aggregates per (industry, check_id, formula_version), and
 * these helpers light up without UI changes.
 *
 * Privacy guard: this module only ever reads pre-aggregated rows. Per-
 * customer data NEVER touches the benchmark table. The cron that
 * computes aggregates is the only place we read across customer
 * boundaries — and even there, we strip identifiers before writing.
 */

import { createServiceClient } from '@/lib/db/client';
import type { Industry } from './revenue-formulas';

export interface IndustryBenchmark {
  industry: Industry;
  check_id: string | null;
  sample_size: number;
  median: number;
  p25: number;
  p75: number;
  p90: number;
  mean: number;
  formula_version: string;
  computed_at: string;
}

// Minimum sample size to surface a benchmark at all. Lower than this and
// we're effectively letting one customer drag the median around — that's
// noisy and arguably re-identifying. 5 customers is the lowest credible
// floor; we may raise to 10 once we have data.
const MIN_SAMPLE_SIZE = 5;

/**
 * Fetch the overall (check_id = NULL) benchmark for an industry, if one
 * exists at the given formula_version. Returns null when no benchmark
 * is available — caller should treat null as "skip the percentile line".
 */
export async function getOverallBenchmark(
  industry: Industry,
  formula_version: string
): Promise<IndustryBenchmark | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('industry_benchmarks')
      .select('industry, check_id, sample_size, median, p25, p75, p90, mean, formula_version, computed_at')
      .eq('industry', industry)
      .is('check_id', null)
      .eq('formula_version', formula_version)
      .gte('sample_size', MIN_SAMPLE_SIZE)
      .maybeSingle();
    if (error || !data) return null;
    return data as IndustryBenchmark;
  } catch {
    // Table may not exist on older deployments — treat as no benchmark.
    return null;
  }
}

/**
 * Compute the percentile of a given $ leakage estimate against the
 * benchmark distribution. Returns 0-100, where 0 = better than everyone
 * (lowest leakage) and 100 = worst.
 *
 * Uses a simple linear interpolation across p25/median/p75/p90 since the
 * benchmark table doesn't store the full empirical CDF.
 */
export function leakagePercentile(
  value: number,
  benchmark: Pick<IndustryBenchmark, 'p25' | 'median' | 'p75' | 'p90'>
): number {
  if (value <= benchmark.p25) return 25;
  if (value <= benchmark.median) {
    // 25-50 range
    const span = benchmark.median - benchmark.p25;
    if (span <= 0) return 50;
    return Math.round(25 + 25 * ((value - benchmark.p25) / span));
  }
  if (value <= benchmark.p75) {
    const span = benchmark.p75 - benchmark.median;
    if (span <= 0) return 75;
    return Math.round(50 + 25 * ((value - benchmark.median) / span));
  }
  if (value <= benchmark.p90) {
    const span = benchmark.p90 - benchmark.p75;
    if (span <= 0) return 90;
    return Math.round(75 + 15 * ((value - benchmark.p75) / span));
  }
  return 95; // beyond p90 — worse than 95% of the cohort
}
