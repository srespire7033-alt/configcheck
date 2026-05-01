import type { CPQData, Issue, CategoryScores, ScanResult, HealthCheck } from '@/types';
import { allChecks } from './checks';
import { calculateRevenueRisk } from './revenue-scoring';

// Note: the old CATEGORY_WEIGHTS map (used to weight per-category scores
// into a single overall score) was removed when the overall score
// switched to an issue-based penalty model. Per-category scores below
// still use a bucket-and-clamp model — see calculateCategoryScores.

/**
 * Run all health checks against CPQ data and return scored results.
 * Optionally pass `suppressedCheckIds` to skip checks the user has muted
 * for this org (Tier 1 of the feedback learning loop).
 */
export async function runAnalysis(
  data: CPQData,
  suppressedCheckIds: string[] = []
): Promise<ScanResult> {
  const startTime = Date.now();
  const allIssues: Issue[] = [];
  const suppressedSet = new Set(suppressedCheckIds);

  // Run all checks (skip suppressed ones)
  for (const check of allChecks) {
    if (suppressedSet.has(check.id)) {
      continue;
    }
    try {
      const issues = await check.run(data);
      allIssues.push(...issues);
    } catch (error) {
      console.error(`Check ${check.id} failed:`, error);
    }
  }

  // Calculate scores. Per-category scores still use the bucket model
  // (start at 100, deduct per severity, clamp to 0-100) — they feed the
  // category cards on the org-detail page where users want to see how
  // each area is doing in isolation.
  // The overall score now uses an issue-based penalty model so the
  // headline number actually reflects severity volume — see
  // calculateOverallScoreFromIssues for the rationale.
  const categoryScores = calculateCategoryScores(allIssues);
  const overallScore = calculateOverallScoreFromIssues(allIssues);

  // Revenue risk scoring
  const { enrichedIssues, revenueSummary } = calculateRevenueRisk(allIssues, data);

  // Complexity scoring
  const complexity = calculateComplexity(data);

  return {
    overall_score: overallScore,
    category_scores: categoryScores,
    issues: enrichedIssues,
    summary: '', // Will be filled by Claude AI later
    duration_ms: Date.now() - startTime,
    revenue_summary: revenueSummary,
    complexity,
  };
}

/**
 * Calculate score per category (0-100)
 * Start at 100, deduct per issue severity
 */
function calculateCategoryScores(issues: Issue[]): CategoryScores {
  const scores: Record<string, number> = {
    price_rules: 100,
    discount_schedules: 100,
    products: 100,
    product_rules: 100,
    summary_variables: 100,
    approval_rules: 100,
    quote_calculator_plugin: 100,
    quote_templates: 100,
    configuration_attributes: 100,
    guided_selling: 100,
    advanced_pricing: 100,
    cpq_settings: 100,
    subscriptions: 100,
    quote_lines: 100,
    contracted_prices: 100,
    performance: 100,
    impact_analysis: 100,
    bundles: 100,
    lookup_queries: 100,
  };

  for (const issue of issues) {
    const category = issue.category;
    if (!(category in scores)) continue;

    switch (issue.severity) {
      case 'critical':
        scores[category] -= 15;
        break;
      case 'warning':
        scores[category] -= 5;
        break;
      case 'info':
        scores[category] -= 1;
        break;
    }
  }

  // Clamp all scores to 0-100
  for (const key of Object.keys(scores)) {
    scores[key] = Math.max(0, Math.min(100, scores[key]));
  }

  return scores as unknown as CategoryScores;
}

/**
 * Calculate the overall org health score from the raw issue list.
 *
 * Why this changed: the previous model was a weighted average of
 * per-category scores. That meant a category that hit zero (say, 21
 * criticals all in price_rules) only impacted the overall score by its
 * weight (~10%). An org with 21 critical issues was scoring 80/100,
 * which made the headline number feel like a vanity metric.
 *
 * The new model penalises each finding directly:
 *   critical → -2.0 points each
 *   warning  → -0.5 points each
 *   info     → -0.1 points each
 *
 * Floor at 0 (no negative scores). Calibrated so that:
 *   • 0 critical, ≤5 warnings   → 95+
 *   • a handful of criticals     → 70-90
 *   • 20+ criticals              → 30-50
 *   • a hopelessly broken org    → close to 0
 *
 * Per-category scores still use the old bucket-and-clamp model — those
 * are about how each area is doing in isolation, not the headline.
 *
 * @deprecated The old name is kept for any callers that may still
 * reference it; new code should use calculateOverallScoreFromIssues.
 */
function calculateOverallScoreFromIssues(issues: Issue[]): number {
  const PENALTY: Record<string, number> = {
    critical: 2.0,
    warning: 0.5,
    info: 0.1,
  };
  let penalty = 0;
  for (const issue of issues) {
    penalty += PENALTY[issue.severity] ?? 0;
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

/**
 * Calculate CPQ complexity score from configuration element counts.
 * Benchmarked against "healthy" org thresholds.
 */
function calculateComplexity(data: CPQData) {
  const factors = [
    { label: 'Active Price Rules', count: data.priceRules.filter((r) => r.SBQQ__Active__c).length, weight: 3, threshold: 20 },
    { label: 'Active Product Rules', count: data.productRules.filter((r) => r.SBQQ__Active__c).length, weight: 2.5, threshold: 15 },
    { label: 'Discount Schedules', count: data.discountSchedules.length, weight: 1.5, threshold: 10 },
    { label: 'Active Products', count: data.products.filter((p) => p.IsActive).length, weight: 1, threshold: 200 },
    { label: 'Product Options (Bundles)', count: data.productOptions.length, weight: 1.5, threshold: 100 },
    { label: 'Summary Variables', count: data.summaryVariables.filter((v) => v.SBQQ__Active__c).length, weight: 2, threshold: 15 },
    { label: 'Approval Rules', count: data.approvalRules.filter((r) => r.SBQQ__Active__c).length, weight: 2, threshold: 10 },
    { label: 'Custom Scripts (QCP)', count: data.customScripts.length, weight: 4, threshold: 3 },
    { label: 'Quote Templates', count: data.quoteTemplates.length, weight: 1, threshold: 5 },
    { label: 'Config Attributes', count: data.configurationAttributes.length, weight: 1.5, threshold: 30 },
    { label: 'Guided Selling Processes', count: data.guidedSellingProcesses.length, weight: 1, threshold: 5 },
    { label: 'Contracted Prices', count: data.contractedPrices.length, weight: 0.5, threshold: 50 },
  ];

  const scoredFactors = factors.map((f) => ({
    label: f.label,
    count: f.count,
    weight: f.weight,
    contribution: Math.round(Math.min(f.count / f.threshold, 2) * f.weight * 10),
  }));

  const totalScore = scoredFactors.reduce((sum, f) => sum + f.contribution, 0);

  let rating: 'Low' | 'Moderate' | 'High' | 'Very High';
  if (totalScore <= 30) rating = 'Low';
  else if (totalScore <= 60) rating = 'Moderate';
  else if (totalScore <= 100) rating = 'High';
  else rating = 'Very High';

  return { totalScore, rating, factors: scoredFactors };
}

/**
 * Get list of all registered checks (for settings/info display)
 */
export function getRegisteredChecks(): HealthCheck[] {
  return allChecks;
}
