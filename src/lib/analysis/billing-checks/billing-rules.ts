import type { BillingData, BillingHealthCheck, Issue } from '@/types';

export const billingRuleChecks: BillingHealthCheck[] = [
  {
    id: 'BR-001',
    name: 'Inactive Billing Rules Referenced by Products',
    category: 'billing_rules',
    severity: 'critical',
    description: 'Finds inactive billing rules still assigned to active products',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const inactiveRules = data.billingRules.filter(r => !r.blng__Active__c);
      const inactiveRuleIds = new Set(inactiveRules.map(r => r.Id));

      const affectedProducts = data.productBillingConfigs.filter(
        p => p.IsActive && p.blng__BillingRule__c && inactiveRuleIds.has(p.blng__BillingRule__c)
      );

      if (affectedProducts.length > 0) {
        issues.push({
          check_id: 'BR-001',
          category: 'billing_rules',
          severity: 'critical',
          title: 'Inactive billing rules assigned to active products',
          description: `${affectedProducts.length} active product(s) reference inactive billing rules. This will block invoice generation for these products.`,
          impact: 'Orders with these products will fail to generate billing schedules and invoices, causing revenue leakage.',
          recommendation: 'Either reactivate the billing rules or reassign active billing rules to these products.',
          affected_records: affectedProducts.slice(0, 50).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
          revenue_impact: affectedProducts.length * 5000,
          effort_hours: Math.ceil(affectedProducts.length / 10) + 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'BR-002',
    name: 'Billing Rules Without GL Treatment',
    category: 'billing_rules',
    severity: 'critical',
    description: 'Finds billing rules that have no GL treatment configured',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const rulesWithTreatments = new Set(data.glTreatments.map(t => t.blng__GLRule__c).filter(Boolean));

      const rulesWithoutGL = data.billingRules.filter(
        r => r.blng__Active__c && !rulesWithTreatments.has(r.Id)
      );

      if (rulesWithoutGL.length > 0) {
        issues.push({
          check_id: 'BR-002',
          category: 'billing_rules',
          severity: 'critical',
          title: 'Active billing rules missing GL treatment',
          description: `${rulesWithoutGL.length} active billing rule(s) have no associated GL treatment. Revenue from these rules will not be posted to the general ledger.`,
          impact: 'Financial transactions will not be properly recorded, causing GL discrepancies and compliance issues.',
          recommendation: 'Create GL treatments for each billing rule and map them to the appropriate GL accounts.',
          affected_records: rulesWithoutGL.slice(0, 50).map(r => ({
            id: r.Id,
            name: r.Name,
            type: 'blng__BillingRule__c',
          })),
          effort_hours: rulesWithoutGL.length * 0.5,
        });
      }

      return issues;
    },
  },
  {
    id: 'BR-003',
    name: 'Orphaned Billing Rules',
    category: 'billing_rules',
    severity: 'info',
    description: 'Finds billing rules not referenced by any product',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const usedRuleIds = new Set(
        data.productBillingConfigs.map(p => p.blng__BillingRule__c).filter(Boolean)
      );

      const orphanedRules = data.billingRules.filter(r => !usedRuleIds.has(r.Id));

      if (orphanedRules.length > 0) {
        issues.push({
          check_id: 'BR-003',
          category: 'billing_rules',
          severity: 'info',
          title: 'Unused billing rules found',
          description: `${orphanedRules.length} billing rule(s) are not referenced by any product. These may be legacy or test rules.`,
          impact: 'No functional impact, but unused rules add clutter and confusion during configuration.',
          recommendation: 'Review and deactivate or delete billing rules that are no longer needed.',
          affected_records: orphanedRules.slice(0, 50).map(r => ({
            id: r.Id,
            name: r.Name,
            type: 'blng__BillingRule__c',
          })),
          effort_hours: orphanedRules.length * 0.1,
        });
      }

      return issues;
    },
  },
  {
    id: 'BR-004',
    name: 'Duplicate Billing Rule Names',
    category: 'billing_rules',
    severity: 'warning',
    description: 'Finds billing rules with identical names',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const nameCount = new Map<string, typeof data.billingRules>();

      for (const rule of data.billingRules) {
        const existing = nameCount.get(rule.Name) || [];
        existing.push(rule);
        nameCount.set(rule.Name, existing);
      }

      const duplicates = Array.from(nameCount.entries()).filter(([, rules]) => rules.length > 1);

      if (duplicates.length > 0) {
        const allDupes = duplicates.flatMap(([, rules]) => rules);
        issues.push({
          check_id: 'BR-004',
          category: 'billing_rules',
          severity: 'warning',
          title: 'Duplicate billing rule names detected',
          description: `${duplicates.length} billing rule name(s) have duplicates. This causes confusion when assigning rules to products.`,
          impact: 'Users may assign the wrong billing rule to products, leading to incorrect billing behavior.',
          recommendation: 'Rename duplicate billing rules to be unique and descriptive.',
          affected_records: allDupes.slice(0, 50).map(r => ({
            id: r.Id,
            name: r.Name,
            type: 'blng__BillingRule__c',
          })),
          effort_hours: duplicates.length * 0.25,
        });
      }

      return issues;
    },
  },
];
