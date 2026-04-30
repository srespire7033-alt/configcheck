import type { ARMData, Issue, CategoryScores } from '@/types';
import { armChecks } from './arm-checks';

// Category weights for ARM overall score (must sum to 1.0).
// Tuned for the v1-v4 spread. Catalog, selling models, and bundles
// dominate because misconfigurations there block quoting outright.
// Assets, contracts, and usage carry meaningful weight because they
// govern post-quote revenue accuracy.
const ARM_CATEGORY_WEIGHTS: Record<string, number> = {
  arm_product_catalog: 0.10,
  arm_selling_models: 0.11,
  arm_price_adjustments: 0.08,
  arm_attribute_pricing: 0.05,
  arm_bundles: 0.10,
  arm_pricing_procedures: 0.05,
  arm_price_books: 0.03,
  arm_decision_tables: 0.05,
  arm_context_service: 0.05,
  arm_rate_cards: 0.05,
  arm_attributes: 0.05,
  // v4
  arm_assets: 0.09,
  arm_contracts: 0.08,
  arm_usage_management: 0.06,
  arm_orchestration: 0.03,
  arm_cost_books: 0.02,
};

export interface ARMScanResult {
  overall_score: number;
  category_scores: CategoryScores;
  issues: Issue[];
  duration_ms: number;
}

/**
 * Run all ARM (Revenue Cloud) health checks against fetched RLM data
 * and return scored results. Mirrors runAnalysis (CPQ) and runBillingAnalysis.
 *
 * `suppressedCheckIds` lets the feedback-learning Tier 1 layer skip checks
 * the user has previously marked as false_positive / not_relevant.
 */
export async function runARMAnalysis(
  data: ARMData,
  suppressedCheckIds: string[] = []
): Promise<ARMScanResult> {
  const startTime = Date.now();
  const allIssues: Issue[] = [];
  const suppressedSet = new Set(suppressedCheckIds);

  for (const check of armChecks) {
    if (suppressedSet.has(check.id)) continue;
    try {
      const issues = await check.run(data);
      allIssues.push(...issues);
    } catch (error) {
      console.error(`[ARM] Check ${check.id} failed:`, error);
    }
  }

  const categoryScores = calculateCategoryScores(allIssues);
  const overallScore = calculateARMOverallScore(categoryScores);

  return {
    overall_score: overallScore,
    category_scores: categoryScores,
    issues: allIssues,
    duration_ms: Date.now() - startTime,
  };
}

function calculateCategoryScores(issues: Issue[]): CategoryScores {
  const scores: Record<string, number> = {
    arm_product_catalog: 100,
    arm_selling_models: 100,
    arm_price_adjustments: 100,
    arm_attribute_pricing: 100,
    arm_bundles: 100,
    arm_pricing_procedures: 100,
    arm_price_books: 100,
    arm_decision_tables: 100,
    arm_context_service: 100,
    arm_rate_cards: 100,
    arm_attributes: 100,
    arm_assets: 100,
    arm_contracts: 100,
    arm_usage_management: 100,
    arm_orchestration: 100,
    arm_cost_books: 100,
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

function calculateARMOverallScore(categoryScores: CategoryScores): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [category, weight] of Object.entries(ARM_CATEGORY_WEIGHTS)) {
    const score = (categoryScores as unknown as Record<string, number>)[category];
    if (score !== undefined) {
      weightedSum += score * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

export function getARMCheckCount(): number {
  return armChecks.length;
}
