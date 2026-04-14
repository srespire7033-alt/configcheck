import type { BillingData, Issue, CategoryScores } from '@/types';
import { allBillingChecks } from './billing-checks';

// Category weights for billing overall score
const BILLING_CATEGORY_WEIGHTS: Record<string, number> = {
  billing_rules: 0.15,
  rev_rec_rules: 0.15,
  tax_rules: 0.12,
  finance_books: 0.18,
  gl_rules: 0.12,
  legal_entity: 0.08,
  product_billing_config: 0.12,
  invoicing: 0.08,
};

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
  const overallScore = calculateBillingOverallScore(categoryScores);

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
 * Calculate weighted overall billing score
 */
function calculateBillingOverallScore(categoryScores: CategoryScores): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [category, weight] of Object.entries(BILLING_CATEGORY_WEIGHTS)) {
    const score = (categoryScores as unknown as Record<string, number>)[category];
    if (score !== undefined) {
      weightedSum += score * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

/**
 * Get count of registered billing checks
 */
export function getBillingCheckCount(): number {
  return allBillingChecks.length;
}
