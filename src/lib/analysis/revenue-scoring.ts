import type { CPQData, Issue } from '@/types';

export interface RevenueRiskSummary {
  totalQuoteValue: number;
  totalQuotesAnalyzed: number;
  atRiskValue: number;
  atRiskQuotes: number;
  currency: string;
}

/**
 * Calculate revenue risk for each issue based on quote volume data.
 * Estimates the ₹ impact by looking at which quote lines are affected
 * by the configuration issues found.
 */
export function calculateRevenueRisk(
  issues: Issue[],
  data: CPQData
): { enrichedIssues: Issue[]; revenueSummary: RevenueRiskSummary } {
  // Calculate total quote value from recent quote lines
  const totalQuoteValue = data.quoteLines.reduce(
    (sum, ql) => sum + (ql.SBQQ__NetTotal__c || 0),
    0
  );
  const totalQuotes = new Set(data.quoteLines.map((ql) => ql.SBQQ__Quote__c)).size;

  // Build lookup maps for affected record analysis
  const productNameToLineValue = new Map<string, { value: number; count: number }>();
  for (const ql of data.quoteLines) {
    const name = ql.SBQQ__Product__r?.Name;
    if (!name) continue;
    const existing = productNameToLineValue.get(name) || { value: 0, count: 0 };
    existing.value += ql.SBQQ__NetTotal__c || 0;
    existing.count += 1;
    productNameToLineValue.set(name, existing);
  }

  // Average quote line value (for estimation when we can't match specific records)
  const avgLineValue = data.quoteLines.length > 0
    ? totalQuoteValue / data.quoteLines.length
    : 0;

  let totalAtRiskValue = 0;
  const atRiskQuoteIds = new Set<string>();

  const enrichedIssues = issues.map((issue) => {
    let revenueImpact = issue.revenue_impact || 0;

    if (revenueImpact === 0) {
      revenueImpact = estimateIssueRevenue(issue, data, productNameToLineValue, avgLineValue);
    }

    if (revenueImpact > 0) {
      totalAtRiskValue += revenueImpact;
      // Track affected quotes
      for (const ql of data.quoteLines) {
        const productName = ql.SBQQ__Product__r?.Name;
        if (productName && issue.affected_records.some((r) => r.name === productName)) {
          atRiskQuoteIds.add(ql.SBQQ__Quote__c);
        }
      }
    }

    return { ...issue, revenue_impact: revenueImpact > 0 ? revenueImpact : undefined };
  });

  return {
    enrichedIssues,
    revenueSummary: {
      totalQuoteValue,
      totalQuotesAnalyzed: totalQuotes,
      atRiskValue: totalAtRiskValue,
      atRiskQuotes: atRiskQuoteIds.size,
      currency: '₹',
    },
  };
}

/**
 * Estimate revenue impact for an issue based on its category and affected records
 */
function estimateIssueRevenue(
  issue: Issue,
  data: CPQData,
  productValueMap: Map<string, { value: number; count: number }>,
  avgLineValue: number
): number {
  const { category, severity, affected_records } = issue;

  // Critical pricing issues affect all quotes that use affected products/rules
  if (category === 'price_rules' || category === 'advanced_pricing') {
    // Price rules can affect many quotes — estimate based on affected records
    if (affected_records.length > 0) {
      let value = 0;
      for (const rec of affected_records) {
        const productData = productValueMap.get(rec.name);
        if (productData) {
          value += productData.value;
        }
      }
      // If we found direct product matches, use that
      if (value > 0) return value;
      // Otherwise estimate: each affected rule impacts ~10% of quote volume for critical, 5% for warning
      const pctImpact = severity === 'critical' ? 0.10 : severity === 'warning' ? 0.05 : 0.01;
      return avgLineValue * data.quoteLines.length * pctImpact;
    }
    // No affected records — rough estimate based on severity
    const pctImpact = severity === 'critical' ? 0.08 : severity === 'warning' ? 0.03 : 0;
    return avgLineValue * data.quoteLines.length * pctImpact;
  }

  if (category === 'discount_schedules') {
    // Discount issues can lead to over-discounting or under-discounting
    const discountedLines = data.quoteLines.filter(
      (ql) => (ql.SBQQ__Discount__c && ql.SBQQ__Discount__c > 0)
    );
    const discountValue = discountedLines.reduce(
      (sum, ql) => sum + (ql.SBQQ__NetTotal__c || 0),
      0
    );
    const pctImpact = severity === 'critical' ? 0.15 : severity === 'warning' ? 0.05 : 0.01;
    return discountValue * pctImpact;
  }

  if (category === 'products' || category === 'product_rules') {
    // Product issues affect specific products
    let value = 0;
    for (const rec of affected_records) {
      const productData = productValueMap.get(rec.name);
      if (productData) value += productData.value;
    }
    return value > 0 ? value * 0.05 : 0; // 5% risk on matched product volume
  }

  if (category === 'contracted_prices') {
    // Contracted price issues affect specific accounts/products
    const pctImpact = severity === 'critical' ? 0.10 : 0.03;
    const contractedValue = data.contractedPrices.reduce(
      (sum, cp) => sum + (cp.SBQQ__Price__c || 0),
      0
    );
    return contractedValue * pctImpact;
  }

  if (category === 'impact_analysis') {
    // Cross-cutting issues — estimate 5-15% of total volume
    const pctImpact = severity === 'critical' ? 0.12 : severity === 'warning' ? 0.05 : 0.01;
    return avgLineValue * data.quoteLines.length * pctImpact;
  }

  // For other categories (settings, templates, etc.) — no direct revenue impact
  return 0;
}

/**
 * Format currency in Indian notation (lakhs/crores)
 */
export function formatIndianCurrency(value: number): string {
  if (value >= 10000000) {
    return `₹${(value / 10000000).toFixed(1)}Cr`;
  }
  if (value >= 100000) {
    return `₹${(value / 100000).toFixed(1)}L`;
  }
  if (value >= 1000) {
    return `₹${(value / 1000).toFixed(1)}K`;
  }
  return `₹${Math.round(value)}`;
}

/**
 * Format currency with full number (for tooltips/details)
 */
export function formatCurrencyFull(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}
