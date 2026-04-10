import type { HealthCheck, CPQData, Issue } from '@/types';

export const productRuleChecks: HealthCheck[] = [
  // PRD-001: Conflicting Selection Rules
  {
    id: 'PRD-001',
    name: 'Conflicting Selection Rules',
    category: 'product_rules',
    severity: 'critical',
    description: 'Selection rules that add and remove the same product',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const selectionRules = data.productRules.filter(
        (r) => r.SBQQ__Active__c && r.SBQQ__Type__c === 'Selection'
      );

      // Group actions by target product
      const addRules: Record<string, string[]> = {};
      const removeRules: Record<string, string[]> = {};

      for (const rule of selectionRules) {
        const actions = rule.SBQQ__Actions__r?.records || [];
        for (const action of actions) {
          const productId = action.SBQQ__Product__c;
          if (!productId) continue;

          if (action.SBQQ__Type__c === 'Add') {
            if (!addRules[productId]) addRules[productId] = [];
            addRules[productId].push(rule.Name);
          } else if (action.SBQQ__Type__c === 'Remove' || action.SBQQ__Type__c === 'Hide') {
            if (!removeRules[productId]) removeRules[productId] = [];
            removeRules[productId].push(rule.Name);
          }
        }
      }

      for (const productId of Object.keys(addRules)) {
        if (removeRules[productId]) {
          issues.push({
            check_id: 'PRD-001',
            category: 'product_rules',
            severity: 'critical',
            title: 'Conflicting selection rules detected',
            description: `Product (${productId}) is added by rule(s) ${addRules[productId].map((n) => `"${n}"`).join(', ')} but removed/hidden by ${removeRules[productId].map((n) => `"${n}"`).join(', ')}. The product may appear and disappear unpredictably.`,
            impact: 'Sales reps see products appearing and disappearing on quotes. Creates confusion and incorrect configurations.',
            recommendation: 'Review the conditions on both rules. Either remove the conflict or add mutually exclusive conditions.',
            affected_records: [
              ...addRules[productId].map((name) => ({
                id: productId,
                name,
                type: 'SBQQ__ProductRule__c',
              })),
              ...removeRules[productId].map((name) => ({
                id: productId,
                name,
                type: 'SBQQ__ProductRule__c',
              })),
            ],
          });
        }
      }

      return issues;
    },
  },

  // PRD-002: Duplicate Evaluation Order
  {
    id: 'PRD-002',
    name: 'Duplicate Product Rule Evaluation Order',
    category: 'product_rules',
    severity: 'warning',
    description: 'Multiple active product rules sharing the same evaluation order',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const activeRules = data.productRules.filter((r) => r.SBQQ__Active__c);

      // Group by type + evaluation order
      const orderMap: Record<string, string[]> = {};
      for (const rule of activeRules) {
        if (rule.SBQQ__EvaluationOrder__c === null) continue;
        const key = `${rule.SBQQ__Type__c}|${rule.SBQQ__EvaluationOrder__c}`;
        if (!orderMap[key]) orderMap[key] = [];
        orderMap[key].push(rule.Name);
      }

      for (const [key, names] of Object.entries(orderMap)) {
        if (names.length > 1) {
          const [type, order] = key.split('|');
          issues.push({
            check_id: 'PRD-002',
            category: 'product_rules',
            severity: 'warning',
            title: `${names.length} ${type} rules share evaluation order ${order}`,
            description: `Rules ${names.map((n) => `"${n}"`).join(', ')} are all ${type} rules with evaluation order ${order}. When rules share the same order, execution sequence is unpredictable.`,
            impact: 'Rules may fire in an unintended order, producing inconsistent configuration results across quotes.',
            recommendation: 'Assign unique evaluation orders to each rule. Use increments of 10 (10, 20, 30...) for easy insertion later.',
            affected_records: names.map((name) => ({
              id: activeRules.find((r) => r.Name === name)?.Id || '',
              name,
              type: 'SBQQ__ProductRule__c',
            })),
          });
        }
      }

      return issues;
    },
  },

  // PRD-003: Product Rules Without Error Conditions
  {
    id: 'PRD-003',
    name: 'Product Rules Without Conditions',
    category: 'product_rules',
    severity: 'warning',
    description: 'Active product rules with no error conditions or actions configured',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const rule of data.productRules) {
        if (!rule.SBQQ__Active__c) continue;

        const conditions = rule.SBQQ__ErrorConditions__r?.records || [];
        const actions = rule.SBQQ__Actions__r?.records || [];

        if (conditions.length === 0 && actions.length === 0) {
          issues.push({
            check_id: 'PRD-003',
            category: 'product_rules',
            severity: 'warning',
            title: `Product Rule "${rule.Name}" has no conditions or actions`,
            description: `"${rule.Name}" (Type: ${rule.SBQQ__Type__c}) is active but has neither error conditions nor actions configured. It does nothing.`,
            impact: 'Dead configuration. Clutters the org and confuses admins.',
            recommendation: `Complete the setup for "${rule.Name}" or deactivate it.`,
            affected_records: [{ id: rule.Id, name: rule.Name, type: 'SBQQ__ProductRule__c' }],
          });
        }
      }

      return issues;
    },
  },

  // PRD-004: Validation Rules Without Error Condition Logic
  {
    id: 'PRD-004',
    name: 'Validation Rules Missing Error Condition Logic',
    category: 'product_rules',
    severity: 'warning',
    description: 'Validation/alert product rules with no error condition met setting',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const rule of data.productRules) {
        if (!rule.SBQQ__Active__c) continue;
        if (rule.SBQQ__Type__c !== 'Validation' && rule.SBQQ__Type__c !== 'Alert') continue;

        if (!rule.SBQQ__ConditionsMet__c) {
          issues.push({
            check_id: 'PRD-004',
            category: 'product_rules',
            severity: 'warning',
            title: `${rule.SBQQ__Type__c} rule "${rule.Name}" missing condition logic`,
            description: `"${rule.Name}" is a ${rule.SBQQ__Type__c} rule but Conditions Met is not set ("All" or "Any"). Without this, the rule cannot properly evaluate when to trigger.`,
            impact: 'The rule may never fire or always fire, regardless of the actual configuration state.',
            recommendation: `Set the Error Condition Met field to "All" or "Any" on "${rule.Name}" and ensure conditions are properly configured.`,
            affected_records: [{ id: rule.Id, name: rule.Name, type: 'SBQQ__ProductRule__c' }],
          });
        }
      }

      return issues;
    },
  },
];
