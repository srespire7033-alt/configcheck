/**
 * Revenue leakage engine — pure function aggregator.
 *
 * Takes the raw scan findings, the org-data-driven baseline numbers, and
 * the lightweight assumption layer (industry preset + sample threshold)
 * and returns a structured breakdown:
 *
 *   - issue-level $ impact stamped onto each finding for downstream UIs
 *   - aggregate $ leakage (forward-looking annualized number for the
 *     headline)
 *   - top contributing checks (the "where's the money?" view)
 *   - "top affected accounts" placeholder (populated once we add Account
 *     traversal in the formula evaluator — out of scope this commit;
 *     leaving the shape ready so the UI doesn't need to change later)
 *   - audit trail (every input + every formula version so a CFO
 *     challenge weeks later can be reproduced)
 *
 * Confidence is propagated from the baseline up to the aggregate — if
 * the baseline is "low confidence" because the org had only 23 closed-
 * won deals, the headline number gets the same badge so consultants
 * don't oversell.
 *
 * Stays pure: no DB calls, no Salesforce calls, no I/O. Easy unit-
 * testable, easy to port to Apex when we go native (Salesforce-side
 * version will read from a custom object with the same field names).
 */

import type { Issue } from '@/types';
import type { RevenueBaseline } from '@/lib/salesforce/queries-revenue-baseline';
import { formulaFor, INDUSTRY_DEFAULTS, type Industry } from './revenue-formulas';

export interface RevenueAssumptions {
  industry: Industry;
  // Override mean vs median. Defaults to median (robust).
  use_median?: boolean;
  // Below this sample size, hide the headline number (still show
  // individual estimates as "LOW confidence").
  confidence_min_sample?: number;
}

export const DEFAULT_ASSUMPTIONS: Required<RevenueAssumptions> = {
  industry: 'saas',
  use_median: true,
  confidence_min_sample: 50,
};

// System defaults — used when the org has no transactional data at all.
// These should be conservative; users in this branch see a "LOW
// confidence — using system defaults" badge.
const SYSTEM_DEFAULTS = {
  median_deal_size: 10_000,
  mean_deal_size: 10_000,
  annual_revenue: 1_000_000,
  avg_discount_pct: 15,
};

export interface IssueWithImpact extends Issue {
  revenue_impact?: number;
  revenue_methodology?: string;
}

export interface RevenueLeakageBreakdown {
  // Forward-looking annualized headline number, in customer's currency
  estimated_annual_leakage: number;
  // % of org's annual revenue (only when baseline.annual_revenue is real)
  percent_of_revenue: number | null;
  // Confidence drives badging in the UI
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  // Top contributing checks (sorted by impact desc, capped at 10)
  top_contributors: Array<{
    check_id: string;
    title: string;
    severity: string;
    impact: number;
    methodology: string;
  }>;
  // Placeholder for "concentration" — top affected accounts. We surface
  // an empty array now so the UI is stable; populates when we add
  // account traversal during scan.
  top_affected_accounts: Array<{ account_id: string; account_name: string; impact: number }>;
  // Per-check $ stamped onto the original issues array — caller persists
  // these as issue.revenue_impact (already a numeric column)
  issues_with_impact: IssueWithImpact[];
  // The aggregate "we have X formulas that could fire, Y actually fired"
  // metric for the methodology page
  coverage: {
    issues_evaluated: number;
    issues_with_formula: number;
    issues_with_impact: number;
  };
  // Raw audit trail — propagated up from the baseline + per-issue
  // formula application so reproducibility is intact weeks later
  audit: {
    baseline_source: RevenueBaseline['source'];
    baseline_sample_size: number;
    baseline_confidence: RevenueBaseline['confidence'];
    industry_used: Industry;
    use_median: boolean;
    formula_version: string; // bump this string when we change formulas
    computed_at: string;
    notes: string[];
  };
}

const FORMULA_VERSION = '2026.05.29.r1';

export function calculateRevenueLeakage(
  issues: Issue[],
  baseline: RevenueBaseline,
  assumptions: RevenueAssumptions = DEFAULT_ASSUMPTIONS
): RevenueLeakageBreakdown {
  const a: Required<RevenueAssumptions> = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
  const notes: string[] = [];

  // Use the baseline numbers when present; fall back to system defaults.
  const median_deal_size = baseline.median_deal_size ?? SYSTEM_DEFAULTS.median_deal_size;
  const mean_deal_size = baseline.mean_deal_size ?? SYSTEM_DEFAULTS.mean_deal_size;
  const annual_revenue = baseline.annual_revenue ?? SYSTEM_DEFAULTS.annual_revenue;
  const avg_discount_pct = baseline.avg_discount_pct ?? SYSTEM_DEFAULTS.avg_discount_pct;
  const deal_size_for_formula = a.use_median ? median_deal_size : mean_deal_size;

  if (baseline.source === 'default') {
    notes.push('No org-data baseline available — using system defaults. Numbers are estimates only.');
  }
  if (baseline.sample_size < a.confidence_min_sample) {
    notes.push(
      `Sample size (${baseline.sample_size}) below confidence threshold (${a.confidence_min_sample}). Numbers shown but confidence is LOW.`
    );
  }

  // Apply formulas
  let withFormula = 0;
  let withImpact = 0;
  const enriched: IssueWithImpact[] = issues.map((issue) => {
    const fn = formulaFor(issue.check_id);
    if (!fn) return issue as IssueWithImpact;
    withFormula += 1;
    const out = fn(issue, {
      median_deal_size: deal_size_for_formula,
      annual_revenue,
      avg_discount_pct,
      industry: a.industry,
      use_median: a.use_median,
    });
    if (out.estimated_impact > 0) withImpact += 1;
    return {
      ...issue,
      revenue_impact: out.estimated_impact,
      revenue_methodology: out.explanation,
    };
  });

  // Aggregate. Cap each individual finding at 25% of org annual revenue
  // and the total at 100% — the heuristic formulas multiply counts ×
  // median deal × LTV × recoverability, which can blow past sanity in
  // small orgs (e.g. a fixture org with $3M revenue showing a single
  // check worth $6M because 25 affected products × $50K median × 4 LTV
  // = $5M). The verified $ from forensic findings has no such cap — it
  // comes from real records and is correct by construction.
  const PER_CHECK_CAP_PCT = 0.25;   // any single check ≤ 25% of revenue
  const TOTAL_CAP_PCT = 1.0;        // total estimated leakage ≤ 100% of revenue
  const perCheckCap = baseline.annual_revenue && baseline.annual_revenue > 0
    ? baseline.annual_revenue * PER_CHECK_CAP_PCT
    : null;
  if (perCheckCap !== null) {
    let cappedCount = 0;
    for (const i of enriched) {
      if ((i.revenue_impact ?? 0) > perCheckCap) {
        i.revenue_impact = perCheckCap;
        cappedCount += 1;
      }
    }
    if (cappedCount > 0) {
      notes.push(
        `${cappedCount} check${cappedCount === 1 ? '' : 's'} capped at 25% of annual revenue to keep estimates within plausible bounds.`
      );
    }
  }
  let totalAnnual = enriched.reduce((sum, i) => sum + (i.revenue_impact ?? 0), 0);
  if (baseline.annual_revenue && baseline.annual_revenue > 0) {
    const totalCap = baseline.annual_revenue * TOTAL_CAP_PCT;
    if (totalAnnual > totalCap) {
      totalAnnual = totalCap;
      notes.push(
        `Total estimated leakage capped at 100% of annual revenue. Verified findings (from real records) are not subject to this cap.`
      );
    }
  }
  const pctOfRevenue =
    baseline.annual_revenue && baseline.annual_revenue > 0
      ? Math.round((totalAnnual / baseline.annual_revenue) * 10000) / 100
      : null;

  // Top contributors
  const top_contributors = enriched
    .filter((i) => (i.revenue_impact ?? 0) > 0)
    .sort((a, b) => (b.revenue_impact ?? 0) - (a.revenue_impact ?? 0))
    .slice(0, 10)
    .map((i) => ({
      check_id: i.check_id,
      title: i.title,
      severity: i.severity,
      impact: i.revenue_impact ?? 0,
      methodology: i.revenue_methodology ?? '',
    }));

  return {
    estimated_annual_leakage: Math.round(totalAnnual),
    percent_of_revenue: pctOfRevenue,
    confidence: baseline.confidence,
    top_contributors,
    top_affected_accounts: [], // populated in a future iteration
    issues_with_impact: enriched,
    coverage: {
      issues_evaluated: issues.length,
      issues_with_formula: withFormula,
      issues_with_impact: withImpact,
    },
    audit: {
      baseline_source: baseline.source,
      baseline_sample_size: baseline.sample_size,
      baseline_confidence: baseline.confidence,
      industry_used: a.industry,
      use_median: a.use_median,
      formula_version: FORMULA_VERSION,
      computed_at: new Date().toISOString(),
      notes: [...notes, ...baseline.audit.notes],
    },
  };
}

/**
 * Read the assumption stack with the per-org override taking precedence
 * over the per-user default, falling back to system defaults. Caller
 * passes both objects from the DB.
 */
export function resolveAssumptions(
  orgAssumptions: Partial<RevenueAssumptions> | null,
  userAssumptions: Partial<RevenueAssumptions> | null
): Required<RevenueAssumptions> {
  return {
    industry:
      orgAssumptions?.industry ??
      userAssumptions?.industry ??
      DEFAULT_ASSUMPTIONS.industry,
    use_median:
      orgAssumptions?.use_median ??
      userAssumptions?.use_median ??
      DEFAULT_ASSUMPTIONS.use_median,
    confidence_min_sample:
      orgAssumptions?.confidence_min_sample ??
      userAssumptions?.confidence_min_sample ??
      DEFAULT_ASSUMPTIONS.confidence_min_sample,
  };
}

export { INDUSTRY_DEFAULTS };
