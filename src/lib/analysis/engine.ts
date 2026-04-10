import type { CPQData, Issue, CategoryScores, ScanResult, HealthCheck } from '@/types';
import { allChecks } from './checks';
import { calculateRevenueRisk } from './revenue-scoring';

// Category weights for overall score
const CATEGORY_WEIGHTS: Record<string, number> = {
  price_rules: 0.10,
  discount_schedules: 0.06,
  products: 0.08,
  product_rules: 0.07,
  summary_variables: 0.05,
  approval_rules: 0.06,
  quote_calculator_plugin: 0.06,
  quote_templates: 0.04,
  configuration_attributes: 0.05,
  guided_selling: 0.04,
  advanced_pricing: 0.06,
  cpq_settings: 0.05,
  subscriptions: 0.05,
  quote_lines: 0.06,
  contracted_prices: 0.04,
  performance: 0.09,
  impact_analysis: 0.09,
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
