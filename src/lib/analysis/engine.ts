import type { CPQData, Issue, CategoryScores, ScanResult, HealthCheck } from '@/types';
import { allChecks } from './checks';

// Category weights for overall score
const CATEGORY_WEIGHTS: Record<string, number> = {
  price_rules: 0.20,
  discount_schedules: 0.12,
  products: 0.15,
  product_rules: 0.13,
  cpq_settings: 0.10,
  subscriptions: 0.10,
  quote_lines: 0.10,
  contracted_prices: 0.10,
};

/**
 * Run all health checks against CPQ data and return scored results
 */
export async function runAnalysis(data: CPQData): Promise<ScanResult> {
  const startTime = Date.now();
  const allIssues: Issue[] = [];

  // Run all checks
  for (const check of allChecks) {
    try {
      const issues = await check.run(data);
      allIssues.push(...issues);
    } catch (error) {
      console.error(`Check ${check.id} failed:`, error);
    }
  }

  // Calculate scores
  const categoryScores = calculateCategoryScores(allIssues);
  const overallScore = calculateOverallScore(categoryScores);

  return {
    overall_score: overallScore,
    category_scores: categoryScores,
    issues: allIssues,
    summary: '', // Will be filled by Claude AI later
    duration_ms: Date.now() - startTime,
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
    cpq_settings: 100,
    subscriptions: 100,
    quote_lines: 100,
    contracted_prices: 100,
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
 * Calculate weighted overall score from category scores
 */
function calculateOverallScore(categoryScores: CategoryScores): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    const score = (categoryScores as unknown as Record<string, number>)[category];
    if (score !== undefined) {
      weightedSum += score * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

/**
 * Get list of all registered checks (for settings/info display)
 */
export function getRegisteredChecks(): HealthCheck[] {
  return allChecks;
}
