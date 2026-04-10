import type { HealthCheck, CPQData, Issue } from '@/types';

export const priceRuleChecks: HealthCheck[] = [
  // PR-001: Conflicting Price Rules
  {
    id: 'PR-001',
    name: 'Conflicting Price Rules',
    category: 'price_rules',
    severity: 'critical',
    description: 'Two active price rules targeting the same field with same evaluation order',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const activeRules = data.priceRules.filter((r) => r.SBQQ__Active__c);

      // Group by evaluation order
      const byOrder: Record<number, typeof activeRules> = {};
      for (const rule of activeRules) {
        const order = rule.SBQQ__EvaluationOrder__c ?? 0;
        if (!byOrder[order]) byOrder[order] = [];
        byOrder[order].push(rule);
      }

      for (const [order, rules] of Object.entries(byOrder)) {
        if (rules.length < 2) continue;

        // Check if any rules in same order target the same field
        const byTargetField: Record<string, typeof rules> = {};
        for (const rule of rules) {
          const actions = rule.SBQQ__PriceActions__r?.records || [];
          for (const action of actions) {
            const field = action.SBQQ__Field__c || 'unknown';
            if (!byTargetField[field]) byTargetField[field] = [];
            byTargetField[field].push(rule);
          }
        }

        for (const [field, conflicting] of Object.entries(byTargetField)) {
          if (conflicting.length < 2) continue;
          issues.push({
            check_id: 'PR-001',
            category: 'price_rules',
            severity: 'critical',
            title: 'Conflicting Price Rules detected',
            description: `${conflicting.length} active price rules target "${field}" with the same evaluation order (${order}). CPQ processes them in unpredictable sequence, so one silently overwrites the other.`,
            impact: 'Revenue miscalculation - the wrong price may be applied to quotes without any visible error.',
            recommendation: `Change evaluation orders to be unique. Set "${conflicting[1].Name}" to order ${Number(order) + 1} so it runs after "${conflicting[0].Name}".`,
            affected_records: conflicting.map((r) => ({
              id: r.Id,
              name: r.Name,
              type: 'SBQQ__PriceRule__c',
            })),
          });
        }
      }

      return issues;
    },
  },

  // PR-002: Dead Price Rules
  {
    id: 'PR-002',
    name: 'Dead Price Rules',
    category: 'price_rules',
    severity: 'warning',
    description: 'Active price rules with no conditions or no actions',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const activeRules = data.priceRules.filter((r) => r.SBQQ__Active__c);

      for (const rule of activeRules) {
        const conditions = rule.SBQQ__PriceConditions__r?.records || [];
        const actions = rule.SBQQ__PriceActions__r?.records || [];

        if (conditions.length === 0 || actions.length === 0) {
          const missing = conditions.length === 0 ? 'conditions' : 'actions';
          issues.push({
            check_id: 'PR-002',
            category: 'price_rules',
            severity: 'warning',
            title: `Price Rule with no ${missing}`,
            description: `"${rule.Name}" is active but has no ${missing}. ${
              missing === 'conditions'
                ? 'Without conditions, this rule may apply to all quote lines unexpectedly or do nothing.'
                : 'Without actions, this rule evaluates conditions but takes no action.'
            }`,
            impact: 'Clutters configuration, confuses other admins, may indicate incomplete setup.',
            recommendation: `Either complete the ${missing} for "${rule.Name}" or deactivate it.`,
            affected_records: [{ id: rule.Id, name: rule.Name, type: 'SBQQ__PriceRule__c' }],
          });
        }
      }

      return issues;
    },
  },

  // PR-003: Evaluation Order Gaps
  {
    id: 'PR-003',
    name: 'Evaluation Order Gaps',
    category: 'price_rules',
    severity: 'info',
    description: 'Gaps in price rule evaluation order sequence',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const activeRules = data.priceRules.filter((r) => r.SBQQ__Active__c);
      const orders = activeRules
        .map((r) => r.SBQQ__EvaluationOrder__c)
        .filter((o): o is number => o !== null)
        .sort((a, b) => a - b);

      if (orders.length < 2) return issues;

      const gaps: number[] = [];
      for (let i = 1; i < orders.length; i++) {
        if (orders[i] - orders[i - 1] > 1) {
          for (let g = orders[i - 1] + 1; g < orders[i]; g++) {
            gaps.push(g);
          }
        }
      }

      if (gaps.length > 0) {
        issues.push({
          check_id: 'PR-003',
          category: 'price_rules',
          severity: 'info',
          title: 'Price Rule evaluation order has gaps',
          description: `Evaluation orders are ${orders.join(', ')} with gaps at positions ${gaps.join(', ')}. New rules could accidentally slot into these gaps.`,
          impact: 'Not a bug, but makes maintenance confusing and error-prone.',
          recommendation: 'Consider resequencing price rules to use consecutive evaluation orders (1, 2, 3, ...).',
          affected_records: activeRules.map((r) => ({
            id: r.Id,
            name: r.Name,
            type: 'SBQQ__PriceRule__c',
          })),
        });
      }

      return issues;
    },
  },

  // PR-004: Multiple Rules Targeting Same Field
  {
    id: 'PR-004',
    name: 'Multiple Rules Targeting Same Field',
    category: 'price_rules',
    severity: 'warning',
    description: 'Multiple active rules writing to the same target field',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const activeRules = data.priceRules.filter((r) => r.SBQQ__Active__c);

      const fieldToRules: Record<string, typeof activeRules> = {};
      for (const rule of activeRules) {
        const actions = rule.SBQQ__PriceActions__r?.records || [];
        for (const action of actions) {
          const field = action.SBQQ__Field__c;
          if (!field) continue;
          if (!fieldToRules[field]) fieldToRules[field] = [];
          fieldToRules[field].push(rule);
        }
      }

      for (const [field, rules] of Object.entries(fieldToRules)) {
        if (rules.length < 3) continue; // Only flag when 3+ rules target same field
        issues.push({
          check_id: 'PR-004',
          category: 'price_rules',
          severity: 'warning',
          title: `${rules.length} rules target the same field`,
          description: `${rules.length} active price rules all write to "${field}". The last rule in evaluation order wins, potentially overwriting values set by earlier rules.`,
          impact: 'Complex cascade of overwriting values. Difficult to predict the final outcome.',
          recommendation: `Review and verify the intended execution order: ${rules.map((r) => `"${r.Name}" (order ${r.SBQQ__EvaluationOrder__c})`).join(' → ')}.`,
          affected_records: rules.map((r) => ({
            id: r.Id,
            name: r.Name,
            type: 'SBQQ__PriceRule__c',
          })),
        });
      }

      return issues;
    },
  },

  // PR-005: Price Rules with Null Evaluation Order
  {
    id: 'PR-005',
    name: 'Price Rules Missing Evaluation Order',
    category: 'price_rules',
    severity: 'warning',
    description: 'Active price rules with no evaluation order set',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const noOrder = data.priceRules.filter(
        (r) => r.SBQQ__Active__c && r.SBQQ__EvaluationOrder__c === null
      );

      if (noOrder.length > 0) {
        issues.push({
          check_id: 'PR-005',
          category: 'price_rules',
          severity: 'warning',
          title: `${noOrder.length} price rule(s) missing evaluation order`,
          description: `${noOrder.map((r) => `"${r.Name}"`).join(', ')} have no evaluation order set. CPQ will run them in an undefined sequence.`,
          impact: 'Unpredictable execution order can cause pricing inconsistencies.',
          recommendation: 'Set explicit evaluation order on all active price rules.',
          affected_records: noOrder.map((r) => ({
            id: r.Id,
            name: r.Name,
            type: 'SBQQ__PriceRule__c',
          })),
        });
      }

      return issues;
    },
  },
];
