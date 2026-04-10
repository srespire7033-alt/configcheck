import type { CPQData, Issue } from '@/types';
import type { HealthCheck } from '@/types';

/**
 * Usage Analytics Checks (UA-001 to UA-003)
 * Detect dead-weight config: unused products, untriggered schedules, stale rules
 */
export const usageAnalyticsChecks: HealthCheck[] = [
  // UA-001: Products quoted but never ordered (dead weight in catalog)
  {
    id: 'UA-001',
    name: 'Dead-Weight Products',
    category: 'products',
    severity: 'info',
    description: 'Products that exist in the catalog but were never quoted in the last 90 days',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      // Get product IDs that appear in recent quote lines
      const quotedProductIds = new Set(
        data.quoteLines
          .filter((ql) => ql.SBQQ__Product__r?.Name)
          .map((ql) => ql.SBQQ__Product__r!.Name)
      );

      // Active products not in any recent quote line
      const activeProducts = data.products.filter((p) => p.IsActive);
      const unquotedProducts = activeProducts.filter((p) => !quotedProductIds.has(p.Name));

      // Only flag if there's a meaningful percentage of dead weight
      const deadWeightPct = activeProducts.length > 0
        ? Math.round((unquotedProducts.length / activeProducts.length) * 100)
        : 0;

      if (unquotedProducts.length >= 5 && deadWeightPct >= 20) {
        issues.push({
          check_id: 'UA-001',
          category: 'products',
          severity: 'info',
          title: `${unquotedProducts.length} active products (${deadWeightPct}%) not quoted in 90 days`,
          description: `Out of ${activeProducts.length} active products, ${unquotedProducts.length} have not appeared on any quote line in the last 90 days. These products add complexity to the configurator without generating revenue.`,
          impact: 'Large product catalogs slow down the CPQ configurator, increase cognitive load for sales reps, and make pricing maintenance harder.',
          recommendation: 'Review unquoted products and consider deactivating ones that are truly retired. If products are seasonal or niche, add a "Last Quoted" date field to track usage.',
          affected_records: unquotedProducts.slice(0, 15).map((p) => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
        });
      }

      return issues;
    },
  },

  // UA-002: Discount schedules that never triggered (no quote lines used them)
  {
    id: 'UA-002',
    name: 'Untriggered Discount Schedules',
    category: 'discount_schedules',
    severity: 'info',
    description: 'Discount schedules that exist but have not been applied to any recent quote lines',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      // If no discount schedules or no quote lines, skip
      if (data.discountSchedules.length === 0 || data.quoteLines.length === 0) return issues;

      // Quote lines with any discount applied indicate schedule usage
      // If we have discount schedules but most quote lines show zero discount,
      // the schedules may not be triggering
      const linesWithDiscount = data.quoteLines.filter(
        (ql) => (ql.SBQQ__Discount__c && ql.SBQQ__Discount__c > 0) ||
                (ql.SBQQ__AdditionalDiscount__c && ql.SBQQ__AdditionalDiscount__c > 0)
      );

      const discountUtilizationPct = Math.round((linesWithDiscount.length / data.quoteLines.length) * 100);

      // If we have 3+ discount schedules but less than 5% of lines have discounts
      if (data.discountSchedules.length >= 3 && discountUtilizationPct < 5) {
        issues.push({
          check_id: 'UA-002',
          category: 'discount_schedules',
          severity: 'info',
          title: `${data.discountSchedules.length} discount schedules but only ${discountUtilizationPct}% of quote lines show discounts`,
          description: `You have ${data.discountSchedules.length} discount schedules configured, but only ${linesWithDiscount.length} of ${data.quoteLines.length} recent quote lines (${discountUtilizationPct}%) have any discount applied. These schedules may not be triggering as expected.`,
          impact: 'Unused discount schedules add configuration complexity. If schedules should be triggering but aren\'t, sales reps may be manually overriding prices, bypassing your pricing governance.',
          recommendation: 'Audit discount schedule criteria to confirm they match current quoting patterns. Check if the products assigned to these schedules are still being quoted.',
          affected_records: data.discountSchedules.slice(0, 10).map((ds) => ({
            id: ds.Id,
            name: ds.Name,
            type: 'SBQQ__DiscountSchedule__c',
          })),
        });
      }

      return issues;
    },
  },

  // UA-003: Stale rules — inactive price/product rules that haven't been cleaned up
  {
    id: 'UA-003',
    name: 'Stale Inactive Rules',
    category: 'price_rules',
    severity: 'info',
    description: 'Inactive price rules and product rules that clutter the configuration',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const inactivePR = data.priceRules.filter((r) => !r.SBQQ__Active__c);
      const inactivePRD = data.productRules.filter((r) => !r.SBQQ__Active__c);
      const totalInactive = inactivePR.length + inactivePRD.length;
      const totalRules = data.priceRules.length + data.productRules.length;

      // Flag if 5+ inactive rules or more than 30% of rules are inactive
      const inactivePct = totalRules > 0 ? Math.round((totalInactive / totalRules) * 100) : 0;

      if (totalInactive >= 5 || (totalInactive >= 3 && inactivePct >= 30)) {
        const records = [
          ...inactivePR.slice(0, 8).map((r) => ({ id: r.Id, name: r.Name, type: 'SBQQ__PriceRule__c' })),
          ...inactivePRD.slice(0, 7).map((r) => ({ id: r.Id, name: r.Name, type: 'SBQQ__ProductRule__c' })),
        ];

        issues.push({
          check_id: 'UA-003',
          category: 'price_rules',
          severity: 'info',
          title: `${totalInactive} inactive rules (${inactivePR.length} price, ${inactivePRD.length} product) cluttering config`,
          description: `${inactivePct}% of your rules are inactive (${totalInactive} of ${totalRules}). Inactive rules don't affect pricing but add confusion when admins review the configuration.`,
          impact: 'Configuration clutter slows down CPQ admin work, increases risk of accidentally editing the wrong rule, and makes audit documentation harder to read.',
          recommendation: 'Export inactive rules for documentation, then delete them from Salesforce. Keep a changelog of removed rules for compliance.',
          affected_records: records,
        });
      }

      return issues;
    },
  },
];
