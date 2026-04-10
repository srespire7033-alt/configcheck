import type { HealthCheck, CPQData, Issue } from '@/types';

export const advancedPricingChecks: HealthCheck[] = [
  // AP-001: MDQ Products Without Subscription Config
  {
    id: 'AP-001',
    name: 'MDQ Products Missing Subscription Setup',
    category: 'advanced_pricing',
    severity: 'critical',
    description: 'Products with block/MDQ pricing but missing subscription configuration',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const mdqProducts = data.products.filter(
        (p) => p.IsActive && p.SBQQ__PricingMethod__c === 'Block'
      );

      for (const product of mdqProducts) {
        const missing: string[] = [];
        if (!product.SBQQ__SubscriptionType__c) missing.push('Subscription Type');
        if (!product.SBQQ__SubscriptionPricing__c) missing.push('Subscription Pricing');
        if (!product.SBQQ__ChargeType__c) missing.push('Charge Type');

        if (missing.length > 0) {
          issues.push({
            check_id: 'AP-001',
            category: 'advanced_pricing',
            severity: 'critical',
            title: `MDQ product "${product.Name}" missing ${missing.join(', ')}`,
            description: `"${product.Name}" uses Block (MDQ) pricing but is missing: ${missing.join(', ')}. Multi-Dimensional Quoting requires proper subscription configuration to create pricing segments.`,
            impact: 'MDQ pricing segments will not generate correctly. Quote lines may show wrong prices or fail to calculate.',
            recommendation: `Set ${missing.join(' and ')} on "${product.Name}". MDQ typically requires Subscription Type = "Renewable", Subscription Pricing = "Fixed Price", Charge Type = "Recurring".`,
            affected_records: [{ id: product.Id, name: product.Name, type: 'Product2' }],
          });
        }
      }

      return issues;
    },
  },

  // AP-002: Percent-of-Total Without Parent
  {
    id: 'AP-002',
    name: 'Percent of Total Products Misconfigured',
    category: 'advanced_pricing',
    severity: 'warning',
    description: 'Products using Percent of Total pricing that are not bundle options',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const percentProducts = data.products.filter(
        (p) => p.IsActive && p.SBQQ__PricingMethod__c === 'Percent Of Total'
      );

      // Get all product IDs that are bundle options
      const optionProductIds = new Set(
        data.productOptions.map((o) => o.SBQQ__OptionalSKU__c)
      );

      for (const product of percentProducts) {
        if (!optionProductIds.has(product.Id)) {
          issues.push({
            check_id: 'AP-002',
            category: 'advanced_pricing',
            severity: 'warning',
            title: `"${product.Name}" uses Percent of Total but isn't a bundle option`,
            description: `"${product.Name}" has Pricing Method = "Percent Of Total" but is not configured as an option in any bundle. Percent of Total only works within a bundle context where there is a parent total to calculate against.`,
            impact: 'Pricing will be $0 or incorrect when this product is added standalone to a quote.',
            recommendation: `Either add "${product.Name}" as an option to a bundle, or change its Pricing Method to "List" or "Block".`,
            affected_records: [{ id: product.Id, name: product.Name, type: 'Product2' }],
          });
        }
      }

      return issues;
    },
  },

  // AP-003: Cost-Plus Pricing Without Cost
  {
    id: 'AP-003',
    name: 'Cost and Margin Products Missing Configuration',
    category: 'advanced_pricing',
    severity: 'warning',
    description: 'Products using Cost pricing method without proper setup',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const costProducts = data.products.filter(
        (p) => p.IsActive && p.SBQQ__PricingMethod__c === 'Cost'
      );

      if (costProducts.length > 0) {
        // Check if these products have pricebook entries (as a proxy for cost setup)
        const productsWithPrices = new Set(
          data.pricebookEntries.map((e) => e.Product2Id)
        );

        for (const product of costProducts) {
          if (!productsWithPrices.has(product.Id)) {
            issues.push({
              check_id: 'AP-003',
              category: 'advanced_pricing',
              severity: 'warning',
              title: `Cost-priced product "${product.Name}" has no price book entry`,
              description: `"${product.Name}" uses Cost pricing method but has no active price book entry. Without a base price, cost-plus margin calculations will result in $0.`,
              impact: 'Product will show $0 on quotes, potentially being given away for free.',
              recommendation: `Add a price book entry with the base cost for "${product.Name}", or change the Pricing Method if cost-plus is not intended.`,
              affected_records: [{ id: product.Id, name: product.Name, type: 'Product2' }],
            });
          }
        }
      }

      return issues;
    },
  },

  // AP-004: Billing Frequency Mismatch
  {
    id: 'AP-004',
    name: 'Subscription Billing Frequency Mismatch',
    category: 'advanced_pricing',
    severity: 'warning',
    description: 'Subscription products with charge type but no billing frequency',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const product of data.products) {
        if (!product.IsActive) continue;
        if (product.SBQQ__ChargeType__c === 'Recurring' && !product.SBQQ__BillingFrequency__c) {
          issues.push({
            check_id: 'AP-004',
            category: 'advanced_pricing',
            severity: 'warning',
            title: `Recurring product "${product.Name}" has no billing frequency`,
            description: `"${product.Name}" has Charge Type "Recurring" but no Billing Frequency set (Monthly, Quarterly, Annual, etc.). CPQ cannot determine how often to bill the customer.`,
            impact: 'Invoice generation may fail or default to an unintended frequency. Revenue recognition may be incorrect.',
            recommendation: `Set the Billing Frequency on "${product.Name}" to match your billing cycle (e.g., "Monthly", "Quarterly", "Annual").`,
            affected_records: [{ id: product.Id, name: product.Name, type: 'Product2' }],
          });
        }
      }

      return issues;
    },
  },
];
