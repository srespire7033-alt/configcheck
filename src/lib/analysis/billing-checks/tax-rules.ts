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
    name: 'Tax Rules With Zero Percent Tax',
    category: 'tax_rules',
    severity: 'warning',
    description: 'Finds active tax rules with 0% tax rate (may be misconfigured)',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const zeroTaxRules = data.taxRules.filter(
        r => r.blng__Active__c &&
          !r.blng__TaxIntegration__c &&
          (r.blng__TaxPercentage__c === 0 || r.blng__TaxPercentage__c === null)
      );

      if (zeroTaxRules.length > 0) {
        issues.push({
          check_id: 'TR-003',
          category: 'tax_rules',
          severity: 'warning',
          title: 'Tax rules with zero percent tax and no integration',
          description: `${zeroTaxRules.length} active tax rule(s) have 0% tax rate and no tax integration configured. This may indicate misconfiguration unless these are intentionally tax-exempt.`,
          impact: 'If these rules are assigned to taxable products, tax will not be collected.',
          recommendation: 'Verify whether 0% tax is intentional. If not, configure the correct tax percentage or enable a tax integration (Avalara, Vertex, etc.).',
          affected_records: zeroTaxRules.slice(0, 50).map(r => ({
            id: r.Id,
            name: r.Name,
            type: 'blng__TaxRule__c',
          })),
          effort_hours: zeroTaxRules.length * 0.25,
        });
      }

      return issues;
    },
  },
];
