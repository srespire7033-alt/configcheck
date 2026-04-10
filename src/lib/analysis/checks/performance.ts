import type { HealthCheck, CPQData, Issue } from '@/types';

export const performanceChecks: HealthCheck[] = [
  // PERF-001: Excessive Active Price Rules
  {
    id: 'PERF-001',
    name: 'High Price Rule Count',
    category: 'performance',
    severity: 'warning',
    description: 'Large number of active price rules impacting quote calculation time',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const activeRules = data.priceRules.filter((r) => r.SBQQ__Active__c);

      if (activeRules.length >= 50) {
        issues.push({
          check_id: 'PERF-001',
          category: 'performance',
          severity: activeRules.length >= 100 ? 'critical' : 'warning',
          title: `${activeRules.length} active price rules — performance risk`,
          description: `Your org has ${activeRules.length} active price rules. CPQ evaluates every active price rule on each quote line during calculation. Salesforce recommends keeping active price rules under 50 for optimal performance.`,
          impact: `Estimated additional calculation time: ~${Math.round(activeRules.length * 0.15)}s per quote save. Users experience slow "Calculating..." spinners.`,
          recommendation: 'Audit and deactivate unused price rules. Consolidate rules that target the same field. Consider using QCP for complex pricing logic instead of many simple rules.',
          affected_records: activeRules.slice(0, 10).map((r) => ({
            id: r.Id,
            name: r.Name,
            type: 'SBQQ__PriceRule__c',
          })),
        });
      }

      return issues;
    },
  },

  // PERF-002: Excessive Active Product Rules
  {
    id: 'PERF-002',
    name: 'High Product Rule Count',
    category: 'performance',
    severity: 'warning',
    description: 'Large number of active product rules impacting configurator performance',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const activeRules = data.productRules.filter((r) => r.SBQQ__Active__c);

      if (activeRules.length >= 30) {
        issues.push({
          check_id: 'PERF-002',
          category: 'performance',
          severity: activeRules.length >= 60 ? 'critical' : 'warning',
          title: `${activeRules.length} active product rules — configurator may be slow`,
          description: `Your org has ${activeRules.length} active product rules. Each rule is evaluated during product configuration and quote calculation. High rule counts slow down the configurator and quote line editor.`,
          impact: 'Slow product configuration. Users wait longer when adding products to quotes.',
          recommendation: 'Review product rules for consolidation opportunities. Deactivate rules for retired products. Use "Before" evaluation event instead of "Always" where possible.',
          affected_records: activeRules.slice(0, 10).map((r) => ({
            id: r.Id,
            name: r.Name,
            type: 'SBQQ__ProductRule__c',
          })),
        });
      }

      return issues;
    },
  },

  // PERF-003: Quote Line Volume
  {
    id: 'PERF-003',
    name: 'High Average Quote Line Count',
    category: 'performance',
    severity: 'warning',
    description: 'Quotes with high line counts that slow down calculation',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      if (data.quoteLines.length === 0 || data.quotes.length === 0) return issues;

      // Count lines per quote
      const linesPerQuote: Record<string, number> = {};
      for (const ql of data.quoteLines) {
        linesPerQuote[ql.SBQQ__Quote__c] = (linesPerQuote[ql.SBQQ__Quote__c] || 0) + 1;
      }

      const lineCounts = Object.values(linesPerQuote);
      const avgLines = Math.round(lineCounts.reduce((a, b) => a + b, 0) / lineCounts.length);
      const maxLines = Math.max(...lineCounts);
      const heavyQuotes = lineCounts.filter((c) => c > 100).length;

      if (maxLines > 100 || avgLines > 50) {
        issues.push({
          check_id: 'PERF-003',
          category: 'performance',
          severity: maxLines > 200 ? 'critical' : 'warning',
          title: `Quotes averaging ${avgLines} lines (max: ${maxLines})`,
          description: `Across ${lineCounts.length} recent quotes, the average is ${avgLines} lines per quote with a maximum of ${maxLines} lines. ${heavyQuotes > 0 ? `${heavyQuotes} quote(s) have over 100 lines.` : ''} CPQ calculation time scales with line count × rule count.`,
          impact: `With ${data.priceRules.filter((r) => r.SBQQ__Active__c).length} active price rules, a ${maxLines}-line quote evaluates ~${(maxLines * data.priceRules.filter((r) => r.SBQQ__Active__c).length).toLocaleString()} rule-line combinations per calculation.`,
          recommendation: 'Consider using quote line groups. Break large quotes into multiple quotes. Review if all line items need to be on a single quote.',
          affected_records: [],
        });
      }

      return issues;
    },
  },

  // PERF-004: Summary Variable Overhead
  {
    id: 'PERF-004',
    name: 'Summary Variable Performance Impact',
    category: 'performance',
    severity: 'info',
    description: 'Number of summary variables adding to calculation overhead',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const activeVars = data.summaryVariables.filter((v) => v.SBQQ__Active__c);

      if (activeVars.length >= 20) {
        issues.push({
          check_id: 'PERF-004',
          category: 'performance',
          severity: activeVars.length >= 40 ? 'warning' : 'info',
          title: `${activeVars.length} active summary variables`,
          description: `Your org has ${activeVars.length} active summary variables. Each variable performs an aggregation across quote lines during every calculation cycle. This adds measurable overhead.`,
          impact: 'Each summary variable adds ~50-100ms to quote calculation time. Combined overhead may be noticeable.',
          recommendation: 'Review summary variables for duplicates (SV-003 check). Remove unused variables (SV-001 check). Consider consolidating similar aggregations.',
          affected_records: activeVars.slice(0, 10).map((v) => ({
            id: v.Id,
            name: v.Name,
            type: 'SBQQ__SummaryVariable__c',
          })),
        });
      }

      return issues;
    },
  },

  // PERF-005: Overall Complexity Score
  {
    id: 'PERF-005',
    name: 'CPQ Configuration Complexity',
    category: 'performance',
    severity: 'info',
    description: 'Overall complexity assessment of CPQ configuration',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const activePriceRules = data.priceRules.filter((r) => r.SBQQ__Active__c).length;
      const activeProductRules = data.productRules.filter((r) => r.SBQQ__Active__c).length;
      const activeSummaryVars = data.summaryVariables.filter((v) => v.SBQQ__Active__c).length;
      const discountSchedules = data.discountSchedules.length;
      const products = data.products.length;
      const productOptions = data.productOptions.length;
      const hasQCP = data.customScripts.length > 0;

      // Complexity score: weighted sum of configuration elements
      const complexity =
        activePriceRules * 3 +
        activeProductRules * 2 +
        activeSummaryVars * 1.5 +
        discountSchedules * 1 +
        productOptions * 0.5 +
        (hasQCP ? 20 : 0);

      let level: string;
      let severity: 'critical' | 'warning' | 'info';
      if (complexity >= 200) {
        level = 'Very High';
        severity = 'critical';
      } else if (complexity >= 100) {
        level = 'High';
        severity = 'warning';
      } else if (complexity >= 50) {
        level = 'Moderate';
        severity = 'info';
      } else {
        return issues; // Low complexity, no issue
      }

      issues.push({
        check_id: 'PERF-005',
        category: 'performance',
        severity,
        title: `CPQ complexity: ${level} (score: ${Math.round(complexity)})`,
        description: `Configuration breakdown: ${activePriceRules} price rules, ${activeProductRules} product rules, ${activeSummaryVars} summary variables, ${discountSchedules} discount schedules, ${products} products, ${productOptions} product options${hasQCP ? ', QCP active' : ''}. Complexity score: ${Math.round(complexity)}/300.`,
        impact: level === 'Very High'
          ? 'Expect significant quote calculation times (10s+). Admin maintenance is complex and error-prone.'
          : 'Quote calculation performance may be impacted. Regular audits recommended.',
        recommendation: 'Run ConfigCheck regularly to identify dead rules and consolidation opportunities. Consider simplifying pricing logic where possible.',
        affected_records: [],
      });

      return issues;
    },
  },
];
