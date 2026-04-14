import type { BillingData, BillingHealthCheck, Issue } from '@/types';

export const productBillingConfigChecks: BillingHealthCheck[] = [
  {
    id: 'PBC-001',
    name: 'Product Missing Billing Rule',
    category: 'product_billing_config',
    severity: 'critical',
    description: 'Finds active products with no billing rule assigned',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const missing = data.productBillingConfigs.filter(
        p => p.IsActive && !p.blng__BillingRule__c
      );

      if (missing.length > 0) {
        issues.push({
          check_id: 'PBC-001',
          category: 'product_billing_config',
          severity: 'critical',
          title: 'Active products missing billing rule',
          description: `${missing.length} active product(s) have no billing rule assigned. Invoices will not be generated for orders with these products.`,
          impact: 'Revenue will not be invoiced, causing direct revenue leakage.',
          recommendation: 'Assign an appropriate billing rule to each active product.',
          affected_records: missing.slice(0, 50).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
          revenue_impact: missing.length * 5000,
          effort_hours: Math.ceil(missing.length / 20) + 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'PBC-002',
    name: 'Product Missing Revenue Recognition Rule',
    category: 'product_billing_config',
    severity: 'critical',
    description: 'Finds active products with no revenue recognition rule assigned',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const missing = data.productBillingConfigs.filter(
        p => p.IsActive && !p.blng__RevenueRecognitionRule__c
      );

      if (missing.length > 0) {
        issues.push({
          check_id: 'PBC-002',
          category: 'product_billing_config',
          severity: 'critical',
          title: 'Active products missing revenue recognition rule',
          description: `${missing.length} active product(s) have no revenue recognition rule. Revenue will not be recognized for these products.`,
          impact: 'Revenue recognition schedules will not be created, causing compliance issues with ASC 606 / IFRS 15.',
          recommendation: 'Assign a revenue recognition rule to each active product.',
          affected_records: missing.slice(0, 50).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
          revenue_impact: missing.length * 10000,
          effort_hours: Math.ceil(missing.length / 20) + 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'PBC-003',
    name: 'Product Missing Tax Rule',
    category: 'product_billing_config',
    severity: 'critical',
    description: 'Finds active products with no tax rule assigned',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const missing = data.productBillingConfigs.filter(
        p => p.IsActive && !p.blng__TaxRule__c
      );

      if (missing.length > 0) {
        issues.push({
          check_id: 'PBC-003',
          category: 'product_billing_config',
          severity: 'critical',
          title: 'Active products missing tax rule',
          description: `${missing.length} active product(s) have no tax rule assigned.`,
          impact: 'Tax will not be calculated for orders containing these products, causing compliance violations.',
          recommendation: 'Assign a tax rule to each active product.',
          affected_records: missing.slice(0, 50).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
          effort_hours: Math.ceil(missing.length / 20) + 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'PBC-004',
    name: 'Product Missing Charge Type',
    category: 'product_billing_config',
    severity: 'critical',
    description: 'Finds active products with no charge type set',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const missing = data.productBillingConfigs.filter(
        p => p.IsActive && !p.SBQQ__ChargeType__c
      );

      if (missing.length > 0) {
        issues.push({
          check_id: 'PBC-004',
          category: 'product_billing_config',
          severity: 'critical',
          title: 'Active products missing charge type',
          description: `${missing.length} active product(s) have no charge type (One-Time, Recurring, Usage) set. Billing will not know how to process these products.`,
          impact: 'Billing schedules cannot be correctly created without a charge type.',
          recommendation: 'Set the charge type on each product: One-Time, Recurring, or Usage.',
          affected_records: missing.slice(0, 50).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
          effort_hours: Math.ceil(missing.length / 20) + 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'PBC-005',
    name: 'Billing Type Mismatch With Frequency',
    category: 'product_billing_config',
    severity: 'warning',
    description: 'Finds products where billing type and frequency may conflict',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const mismatched = data.productBillingConfigs.filter(p => {
        if (!p.IsActive || p.SBQQ__ChargeType__c !== 'Recurring') return false;
        // Recurring products should have a billing frequency
        return !p.SBQQ__BillingFrequency__c;
      });

      if (mismatched.length > 0) {
        issues.push({
          check_id: 'PBC-005',
          category: 'product_billing_config',
          severity: 'warning',
          title: 'Recurring products without billing frequency',
          description: `${mismatched.length} recurring product(s) have no billing frequency set. The system won't know how often to bill.`,
          impact: 'Billing schedules may default to unexpected frequencies or fail to generate.',
          recommendation: 'Set the billing frequency (Monthly, Quarterly, Annual, etc.) on recurring products.',
          affected_records: mismatched.slice(0, 50).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
          effort_hours: mismatched.length * 0.1,
        });
      }

      return issues;
    },
  },
  {
    id: 'PBC-006',
    name: 'Products Referencing Inactive Rules',
    category: 'product_billing_config',
    severity: 'warning',
    description: 'Summary check for products referencing any inactive billing/rev-rec/tax rule',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const affected = data.productBillingConfigs.filter(p => {
        if (!p.IsActive) return false;
        const billingInactive = p.blng__BillingRule__r?.blng__Active__c === false;
        const revRecInactive = p.blng__RevenueRecognitionRule__r?.blng__Active__c === false;
        const taxInactive = p.blng__TaxRule__r?.blng__Active__c === false;
        return billingInactive || revRecInactive || taxInactive;
      });

      if (affected.length > 0) {
        issues.push({
          check_id: 'PBC-006',
          category: 'product_billing_config',
          severity: 'warning',
          title: 'Products referencing inactive rules',
          description: `${affected.length} active product(s) have at least one inactive billing, revenue recognition, or tax rule assigned.`,
          impact: 'Some billing processes may fail silently for orders containing these products.',
          recommendation: 'Review each product and update rule assignments to active rules.',
          affected_records: affected.slice(0, 50).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
          effort_hours: affected.length * 0.15,
        });
      }

      return issues;
    },
  },
];
