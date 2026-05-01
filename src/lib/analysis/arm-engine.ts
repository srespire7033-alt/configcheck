import type { ARMData, Issue, CategoryScores } from '@/types';
import { armChecks } from './arm-checks';

// The old ARM_CATEGORY_WEIGHTS map was removed when the overall score
// switched to an issue-based penalty model — see calculateARMOverallScore.
// Per-category scores still use the bucket-and-clamp model.

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
  const overallScore = calculateARMOverallScore(allIssues);

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
    // v5 additions
    arm_tax: 100,
    arm_billing_policies: 100,
    arm_general_ledger: 100,
    arm_clauses: 100,
    arm_product_qualification: 100,
    arm_ramp_deals: 100,
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
 * Calculate the overall ARM score from raw issues.
 * Same penalty schedule as the CPQ and Billing engines — see
 * analysis/engine.ts for the full rationale.
 *   critical → -2.0 each
 *   warning  → -0.5 each
 *   info     → -0.1 each
 * Floor at 0.
 */
function calculateARMOverallScore(issues: Issue[]): number {
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

export function getARMCheckCount(): number {
  return armChecks.length;
}
