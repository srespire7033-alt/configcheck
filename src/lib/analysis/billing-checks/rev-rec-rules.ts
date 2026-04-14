import type { BillingData, BillingHealthCheck, Issue } from '@/types';

export const revRecRuleChecks: BillingHealthCheck[] = [
  {
    id: 'RR-001',
    name: 'Inactive Rev Rec Rules Referenced by Products',
    category: 'rev_rec_rules',
    severity: 'critical',
    description: 'Finds inactive revenue recognition rules still assigned to active products',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const inactiveRules = data.revRecRules.filter(r => !r.blng__Active__c);
      const inactiveRuleIds = new Set(inactiveRules.map(r => r.Id));

      const affected = data.productBillingConfigs.filter(
        p => p.IsActive && p.blng__RevenueRecognitionRule__c && inactiveRuleIds.has(p.blng__RevenueRecognitionRule__c)
      );

      if (affected.length > 0) {
        issues.push({
          check_id: 'RR-001',
          category: 'rev_rec_rules',
          severity: 'critical',
          title: 'Inactive revenue recognition rules assigned to active products',
          description: `${affected.length} active product(s) reference inactive revenue recognition rules. Revenue will not be recognized for orders containing these products.`,
          impact: 'Revenue recognition schedules will not be created, causing revenue reporting inaccuracies and potential compliance issues.',
          recommendation: 'Reactivate the revenue recognition rules or reassign active ones to these products.',
          affected_records: affected.slice(0, 50).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
          revenue_impact: affected.length * 10000,
          effort_hours: Math.ceil(affected.length / 10) + 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'RR-002',
    name: 'Rev Rec Rules Without Revenue Schedule Type',
    category: 'rev_rec_rules',
    severity: 'warning',
    description: 'Finds active revenue recognition rules with no schedule type configured',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const rulesWithoutType = data.revRecRules.filter(
        r => r.blng__Active__c && !r.blng__RevenueScheduleType__c
      );

      if (rulesWithoutType.length > 0) {
        issues.push({
          check_id: 'RR-002',
          category: 'rev_rec_rules',
          severity: 'warning',
          title: 'Revenue recognition rules missing schedule type',
          description: `${rulesWithoutType.length} active revenue recognition rule(s) have no revenue schedule type configured.`,
          impact: 'Revenue may not be recognized in the expected pattern (over time vs point in time), leading to inaccurate financial reporting.',
          recommendation: 'Set the Revenue Schedule Type field on each rule to define how revenue should be distributed.',
          affected_records: rulesWithoutType.slice(0, 50).map(r => ({
            id: r.Id,
            name: r.Name,
            type: 'blng__RevenueRecognitionRule__c',
          })),
          effort_hours: rulesWithoutType.length * 0.25,
        });
      }

      return issues;
    },
  },
  {
    id: 'RR-003',
    name: 'Rev Rec Rules Not Creating Schedules',
    category: 'rev_rec_rules',
    severity: 'warning',
    description: 'Finds active rules where revenue schedule creation is disabled',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const rulesNotCreating = data.revRecRules.filter(
        r => r.blng__Active__c && r.blng__CreateRevenueSchedule__c === 'No'
      );

      if (rulesNotCreating.length > 0) {
        issues.push({
          check_id: 'RR-003',
          category: 'rev_rec_rules',
          severity: 'warning',
          title: 'Revenue recognition rules with schedule creation disabled',
          description: `${rulesNotCreating.length} active rule(s) have revenue schedule creation disabled. Revenue will not be automatically recognized for products using these rules.`,
          impact: 'Manual intervention required for revenue recognition, increasing risk of missed or incorrect postings.',
          recommendation: 'Enable revenue schedule creation unless there is a specific business reason to handle recognition manually.',
          affected_records: rulesNotCreating.slice(0, 50).map(r => ({
            id: r.Id,
            name: r.Name,
            type: 'blng__RevenueRecognitionRule__c',
          })),
          effort_hours: rulesNotCreating.length * 0.5,
        });
      }

      return issues;
    },
  },
  {
    id: 'RR-004',
    name: 'Orphaned Revenue Recognition Rules',
    category: 'rev_rec_rules',
    severity: 'info',
    description: 'Finds revenue recognition rules not used by any product',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const usedRuleIds = new Set(
        data.productBillingConfigs.map(p => p.blng__RevenueRecognitionRule__c).filter(Boolean)
      );

      const orphaned = data.revRecRules.filter(r => !usedRuleIds.has(r.Id));

      if (orphaned.length > 0) {
        issues.push({
          check_id: 'RR-004',
          category: 'rev_rec_rules',
          severity: 'info',
          title: 'Unused revenue recognition rules',
          description: `${orphaned.length} revenue recognition rule(s) are not assigned to any product.`,
          impact: 'No functional impact, but unused rules add maintenance overhead.',
          recommendation: 'Review and deactivate or delete unused rules.',
          affected_records: orphaned.slice(0, 50).map(r => ({
            id: r.Id,
            name: r.Name,
            type: 'blng__RevenueRecognitionRule__c',
          })),
          effort_hours: orphaned.length * 0.1,
        });
      }

      return issues;
    },
  },
];
