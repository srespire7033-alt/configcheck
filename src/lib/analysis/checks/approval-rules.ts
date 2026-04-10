import type { HealthCheck, CPQData, Issue } from '@/types';

export const approvalRuleChecks: HealthCheck[] = [
  // AR-001: Approval Rules Without Approver
  {
    id: 'AR-001',
    name: 'Approval Rules Without Approver',
    category: 'approval_rules',
    severity: 'critical',
    description: 'Active approval rules with no approver assigned',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const rule of data.approvalRules) {
        if (!rule.SBQQ__Active__c) continue;
        if (!rule.SBQQ__Approver__c && !rule.SBQQ__ApproverField__c) {
          issues.push({
            check_id: 'AR-001',
            category: 'approval_rules',
            severity: 'critical',
            title: `Approval rule "${rule.Name}" has no approver`,
            description: `"${rule.Name}" is active but has neither an Approver nor an Approver Field set. When this rule triggers, there is nobody to approve the quote.`,
            impact: 'Quotes requiring approval get stuck with no one to approve them. Sales cycle stalls.',
            recommendation: `Set either the Approver (specific user) or Approver Field (dynamic lookup) on "${rule.Name}".`,
            affected_records: [{ id: rule.Id, name: rule.Name, type: 'SBQQ__ApprovalRule__c' }],
          });
        }
      }

      return issues;
    },
  },

  // AR-002: Approval Rules Without Conditions
  {
    id: 'AR-002',
    name: 'Approval Rules Without Conditions',
    category: 'approval_rules',
    severity: 'warning',
    description: 'Active approval rules with no conditions configured',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const rule of data.approvalRules) {
        if (!rule.SBQQ__Active__c) continue;
        const conditions = rule.SBQQ__ApprovalConditions__r?.records || [];

        if (conditions.length === 0) {
          issues.push({
            check_id: 'AR-002',
            category: 'approval_rules',
            severity: 'warning',
            title: `Approval rule "${rule.Name}" has no conditions`,
            description: `"${rule.Name}" is active but has no approval conditions. This means every quote may trigger this approval rule regardless of discount, amount, or any other criteria.`,
            impact: 'All quotes go through unnecessary approval, slowing down the sales cycle.',
            recommendation: `Add conditions to "${rule.Name}" to limit when approval is required (e.g., discount > 20%, net amount > $50,000).`,
            affected_records: [{ id: rule.Id, name: rule.Name, type: 'SBQQ__ApprovalRule__c' }],
          });
        }
      }

      return issues;
    },
  },

  // AR-003: Duplicate Approval Evaluation Order
  {
    id: 'AR-003',
    name: 'Duplicate Approval Rule Evaluation Order',
    category: 'approval_rules',
    severity: 'warning',
    description: 'Multiple active approval rules sharing the same evaluation order',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const active = data.approvalRules.filter((r) => r.SBQQ__Active__c);

      const orderMap: Record<number, typeof active> = {};
      for (const rule of active) {
        if (rule.SBQQ__EvaluationOrder__c === null) continue;
        const order = rule.SBQQ__EvaluationOrder__c;
        if (!orderMap[order]) orderMap[order] = [];
        orderMap[order].push(rule);
      }

      for (const [order, rules] of Object.entries(orderMap)) {
        if (rules.length > 1) {
          issues.push({
            check_id: 'AR-003',
            category: 'approval_rules',
            severity: 'warning',
            title: `${rules.length} approval rules share evaluation order ${order}`,
            description: `Rules ${rules.map((r) => `"${r.Name}"`).join(', ')} all have evaluation order ${order}. When rules share the same order, execution sequence is unpredictable.`,
            impact: 'Approval chain may behave inconsistently, routing quotes to the wrong approver.',
            recommendation: 'Assign unique evaluation orders to each approval rule.',
            affected_records: rules.map((r) => ({
              id: r.Id,
              name: r.Name,
              type: 'SBQQ__ApprovalRule__c',
            })),
          });
        }
      }

      return issues;
    },
  },

  // AR-004: Approval Rules Missing Condition Logic
  {
    id: 'AR-004',
    name: 'Approval Rules Missing Condition Logic',
    category: 'approval_rules',
    severity: 'warning',
    description: 'Active approval rules with conditions but no Conditions Met setting',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const rule of data.approvalRules) {
        if (!rule.SBQQ__Active__c) continue;
        const conditions = rule.SBQQ__ApprovalConditions__r?.records || [];
        if (conditions.length === 0) continue;

        if (!rule.SBQQ__ConditionsMet__c) {
          issues.push({
            check_id: 'AR-004',
            category: 'approval_rules',
            severity: 'warning',
            title: `Approval rule "${rule.Name}" missing Conditions Met logic`,
            description: `"${rule.Name}" has ${conditions.length} condition(s) but the Conditions Met field is not set ("All" or "Any"). The rule may not evaluate correctly.`,
            impact: 'Approval may trigger when it should not, or fail to trigger when it should.',
            recommendation: `Set Conditions Met to "All" (all conditions must match) or "Any" (at least one) on "${rule.Name}".`,
            affected_records: [{ id: rule.Id, name: rule.Name, type: 'SBQQ__ApprovalRule__c' }],
          });
        }
      }

      return issues;
    },
  },
];
