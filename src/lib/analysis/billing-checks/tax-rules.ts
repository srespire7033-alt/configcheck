import type { BillingData, BillingHealthCheck, Issue } from '@/types';

export const taxRuleChecks: BillingHealthCheck[] = [
  {
    id: 'TR-001',
    name: 'Active Products Without Tax Rule',
    category: 'tax_rules',
    severity: 'critical',
    description: 'Finds active products with no tax rule assigned',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const productsWithoutTax = data.productBillingConfigs.filter(
        p => p.IsActive && !p.blng__TaxRule__c
      );

      if (productsWithoutTax.length > 0) {
        issues.push({
          check_id: 'TR-001',
          category: 'tax_rules',
          severity: 'critical',
          title: 'Active products missing tax rule',
          description: `${productsWithoutTax.length} active product(s) have no tax rule assigned. Tax will not be calculated for orders containing these products.`,
          impact: 'Missing tax calculations can lead to compliance violations and financial liability.',
          recommendation: 'Assign an appropriate tax rule to each active product.',
          affected_records: productsWithoutTax.slice(0, 50).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
          revenue_impact: productsWithoutTax.length * 2000,
          effort_hours: Math.ceil(productsWithoutTax.length / 20) + 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'TR-002',
    name: 'Inactive Tax Rules Referenced by Products',
    category: 'tax_rules',
    severity: 'critical',
    description: 'Finds inactive tax rules still assigned to active products',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const inactiveRules = data.taxRules.filter(r => !r.blng__Active__c);
      const inactiveRuleIds = new Set(inactiveRules.map(r => r.Id));

      const affected = data.productBillingConfigs.filter(
        p => p.IsActive && p.blng__TaxRule__c && inactiveRuleIds.has(p.blng__TaxRule__c)
      );

      if (affected.length > 0) {
        issues.push({
          check_id: 'TR-002',
          category: 'tax_rules',
          severity: 'critical',
          title: 'Inactive tax rules assigned to active products',
          description: `${affected.length} active product(s) reference inactive tax rules.`,
          impact: 'Tax calculations will fail or be skipped, causing compliance issues.',
          recommendation: 'Reactivate the tax rules or assign active ones to these products.',
          affected_records: affected.slice(0, 50).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
          effort_hours: Math.ceil(affected.length / 10) + 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'TR-003',
    name: 'Tax Rules Not Marked as Taxable',
    category: 'tax_rules',
    severity: 'warning',
    description: 'Finds active tax rules where Taxable is not set to Yes',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const nonTaxableRules = data.taxRules.filter(
        r => r.blng__Active__c && r.blng__TaxableYesNo__c !== 'Yes'
      );

      if (nonTaxableRules.length > 0) {
        issues.push({
          check_id: 'TR-003',
          category: 'tax_rules',
          severity: 'warning',
          title: 'Active tax rules not marked as taxable',
          description: `${nonTaxableRules.length} active tax rule(s) do not have Taxable set to "Yes". Products using these rules will not have tax applied.`,
          impact: 'If assigned to taxable products, tax will not be collected — potential compliance risk.',
          recommendation: 'Set the Taxable field to "Yes" on rules that should calculate tax, or verify these are intentionally tax-exempt.',
          affected_records: nonTaxableRules.slice(0, 50).map(r => ({
            id: r.Id,
            name: r.Name,
            type: 'blng__TaxRule__c',
          })),
          effort_hours: nonTaxableRules.length * 0.25,
        });
      }

      return issues;
    },
  },
  {
    id: 'TR-004',
    name: 'Inactive Tax Rules Cleanup',
    category: 'tax_rules',
    severity: 'info',
    description: 'Inactive tax rules that add maintenance overhead to the org',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const inactive = data.taxRules.filter(r => !r.blng__Active__c);

      if (inactive.length > 0) {
        issues.push({
          check_id: 'TR-004',
          category: 'tax_rules',
          severity: 'info',
          title: `${inactive.length} inactive tax rule(s)`,
          description: `${inactive.length} tax rule(s) are inactive: ${inactive.slice(0, 5).map(r => `"${r.Name}"`).join(', ')}${inactive.length > 5 ? ` and ${inactive.length - 5} more` : ''}.`,
          impact: 'Inactive tax rules clutter the org and can confuse admins reviewing the billing configuration.',
          recommendation: 'Delete inactive tax rules that are no longer needed.',
          affected_records: inactive.slice(0, 10).map(r => ({
            id: r.Id,
            name: r.Name,
            type: 'blng__TaxRule__c',
          })),
          effort_hours: inactive.length * 0.1,
        });
      }

      return issues;
    },
  },
];
