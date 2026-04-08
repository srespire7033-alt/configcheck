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

        const conditions = rule.SBQQ__Conditions__r?.records || [];
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
];
