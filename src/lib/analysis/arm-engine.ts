import type { ARMData, Issue, CategoryScores } from '@/types';
import { armChecks } from './arm-checks';

// Category weights for ARM overall score (must sum to 1.0)
// Weights were tuned for the v1+v2 spread: catalog and selling models
// sit at the top because misconfigurations there block quoting outright.
const ARM_CATEGORY_WEIGHTS: Record<string, number> = {
  arm_product_catalog: 0.16,
  arm_selling_models: 0.18,
  arm_price_adjustments: 0.14,
  arm_attribute_pricing: 0.08,
  arm_bundles: 0.16,
  arm_pricing_procedures: 0.08,
  arm_price_books: 0.04,
  arm_decision_tables: 0.08,
  arm_context_service: 0.08,
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
