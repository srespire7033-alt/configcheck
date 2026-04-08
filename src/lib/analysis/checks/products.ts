import type { HealthCheck, CPQData, Issue } from '@/types';

export const productChecks: HealthCheck[] = [
  // PB-001: Products Without Price Book Entry
  {
    id: 'PB-001',
    name: 'Products Without Price Book Entry',
    category: 'products',
    severity: 'critical',
    description: 'Active products not in any price book',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const productsWithPBE = new Set(data.pricebookEntries.map((e) => e.Product2Id));
      const orphaned = data.products.filter((p) => p.IsActive && !productsWithPBE.has(p.Id));

      if (orphaned.length > 0) {
        issues.push({
          check_id: 'PB-001',
          category: 'products',
          severity: 'critical',
          title: `${orphaned.length} active product(s) without price book entry`,
          description: `${orphaned.slice(0, 5).map((p) => `"${p.Name}"`).join(', ')}${orphaned.length > 5 ? ` and ${orphaned.length - 5} more` : ''} are active but have no price book entry. They cannot be added to quotes.`,
          impact: 'Sales reps will get errors when trying to add these products to quotes.',
          recommendation: 'Add price book entries for these products or deactivate them if no longer sold.',
          affected_records: orphaned.map((p) => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
        });
      }

      return issues;
    },
  },

  // PB-002: Orphaned Bundle Options
  {
    id: 'PB-002',
    name: 'Orphaned Bundle Options',
    category: 'products',
    severity: 'warning',
    description: 'Product options pointing to inactive parent bundles',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const option of data.productOptions) {
        const parentActive = option.SBQQ__ConfiguredSKU__r?.IsActive;
        const childActive = option.SBQQ__OptionalSKU__r?.IsActive;

        if (parentActive === false) {
          issues.push({
            check_id: 'PB-002',
            category: 'products',
            severity: 'warning',
            title: `Bundle option references inactive parent`,
            description: `Product Option "${option.Name}" references parent bundle "${option.SBQQ__ConfiguredSKU__r?.Name}" which is inactive.`,
            impact: 'Broken bundle structure. This option will never appear in quotes.',
            recommendation: 'Delete this product option or reactivate the parent bundle.',
            affected_records: [
              { id: option.Id, name: option.Name, type: 'SBQQ__ProductOption__c' },
            ],
          });
        }

        if (childActive === false) {
          issues.push({
            check_id: 'PB-002',
            category: 'products',
            severity: 'warning',
            title: `Bundle option references inactive product`,
            description: `Product Option "${option.Name}" includes "${option.SBQQ__OptionalSKU__r?.Name}" which is inactive.`,
            impact: 'This option may cause errors when configuring the bundle.',
            recommendation: 'Remove this option from the bundle or reactivate the product.',
            affected_records: [
              { id: option.Id, name: option.Name, type: 'SBQQ__ProductOption__c' },
            ],
          });
        }
      }

      return issues;
    },
  },

  // PB-003: Missing Subscription Type on Recurring Products
  {
    id: 'PB-003',
    name: 'Missing Subscription Type',
    category: 'products',
    severity: 'critical',
    description: 'Recurring products without subscription type configured',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const misconfigured = data.products.filter(
        (p) =>
          p.IsActive &&
          p.SBQQ__ChargeType__c === 'Recurring' &&
          !p.SBQQ__SubscriptionType__c
      );

      for (const product of misconfigured) {
        issues.push({
          check_id: 'PB-003',
          category: 'products',
          severity: 'critical',
          title: `Recurring product missing Subscription Type`,
          description: `"${product.Name}" has Charge Type = "Recurring" but no Subscription Type set. The CPQ calculator doesn't know how to handle this product.`,
          impact: 'May cause NetPrice = 0, calculation errors, or subscription creation failures.',
          recommendation: `Set Subscription Type on "${product.Name}" to "Renewable" (most common) or "One-time" as appropriate.`,
          affected_records: [{ id: product.Id, name: product.Name, type: 'Product2' }],
        });
      }

      return issues;
    },
  },

  // PB-004: Duplicate Product Codes
  {
    id: 'PB-004',
    name: 'Duplicate Product Codes',
    category: 'products',
    severity: 'warning',
    description: 'Multiple active products sharing the same product code',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const byCode: Record<string, typeof data.products> = {};

      for (const product of data.products) {
        if (!product.ProductCode || !product.IsActive) continue;
        if (!byCode[product.ProductCode]) byCode[product.ProductCode] = [];
        byCode[product.ProductCode].push(product);
      }

      for (const [code, products] of Object.entries(byCode)) {
        if (products.length < 2) continue;
        issues.push({
          check_id: 'PB-004',
          category: 'products',
          severity: 'warning',
          title: `Duplicate Product Code "${code}"`,
          description: `${products.length} active products share Product Code "${code}": ${products.map((p) => `"${p.Name}"`).join(', ')}.`,
          impact: 'Causes confusion in integrations, data imports, and reporting.',
          recommendation: 'Assign unique product codes to each product.',
          affected_records: products.map((p) => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
        });
      }

      return issues;
    },
  },
];
