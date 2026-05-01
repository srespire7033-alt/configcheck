import type { BillingData, Issue, CategoryScores } from '@/types';
import { allBillingChecks } from './billing-checks';

// The old BILLING_CATEGORY_WEIGHTS map was removed when the overall
// score switched to an issue-based penalty model — see
// calculateBillingOverallScore. Per-category scores still use the
// bucket-and-clamp model.

export interface BillingScanResult {
  overall_score: number;
  category_scores: CategoryScores;
  issues: Issue[];
  duration_ms: number;
}

/**
 * Run all billing health checks against billing data and return scored results
 */
export async function runBillingAnalysis(data: BillingData): Promise<BillingScanResult> {
  const startTime = Date.now();
  const allIssues: Issue[] = [];

  for (const check of allBillingChecks) {
    try {
      const issues = await check.run(data);
      allIssues.push(...issues);
    } catch (error) {
      console.error(`[BILLING] Check ${check.id} failed:`, error);
    }
  }

  const categoryScores = calculateCategoryScores(allIssues);
  const overallScore = calculateBillingOverallScore(allIssues);

  return {
    overall_score: overallScore,
    category_scores: categoryScores,
    issues: allIssues,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Calculate score per billing category (0-100)
 */
function calculateCategoryScores(issues: Issue[]): CategoryScores {
  const scores: Record<string, number> = {
    billing_rules: 100,
    rev_rec_rules: 100,
    tax_rules: 100,
    finance_books: 100,
    gl_rules: 100,
    legal_entity: 100,
    product_billing_config: 100,
    invoicing: 100,
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

  for (const key of Object.keys(scores)) {
    scores[key] = Math.max(0, Math.min(100, scores[key]));
  }

  return scores as unknown as CategoryScores;
}

/**
 * Calculate the overall billing score from raw issues.
 * Same penalty schedule as the CPQ engine — see analysis/engine.ts for
 * the full rationale on why this changed from a category-weighted
 * average to an issue-based penalty.
 *   critical → -2.0 each
 *   warning  → -0.5 each
 *   info     → -0.1 each
 * Floor at 0.
 */
function calculateBillingOverallScore(issues: Issue[]): number {
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
 * Get count of registered billing checks
 */
export function getBillingCheckCount(): number {
  return allBillingChecks.length;
}
