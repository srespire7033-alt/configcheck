import type { HealthCheck, CPQData, Issue } from '@/types';

export const twinFieldChecks: HealthCheck[] = [
  // TF-001: Conflicting Twin Fields on Quote Lines
  {
    id: 'TF-001',
    name: 'Conflicting Twin Field Values',
    category: 'quote_lines',
    severity: 'warning',
    description: 'Quote lines where both Discount and Additional Discount or both Uplift and Uplift Amount are set, causing unexpected pricing',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      // Check for Discount + Additional Discount conflict
      const discountConflicts = data.quoteLines.filter(
        (ql) =>
          ql.SBQQ__Discount__c !== null &&
          ql.SBQQ__Discount__c !== 0 &&
          ql.SBQQ__AdditionalDiscount__c !== null &&
          ql.SBQQ__AdditionalDiscount__c !== 0
      );

      if (discountConflicts.length > 0) {
        issues.push({
          check_id: 'TF-001',
          category: 'quote_lines',
          severity: 'warning',
          title: `${discountConflicts.length} quote line(s) have both Discount and Additional Discount set`,
          description: `Found ${discountConflicts.length} quote line(s) where both SBQQ__Discount__c and SBQQ__AdditionalDiscount__c have values. These are "twin fields" in CPQ — Discount is partner/channel discount and Additional Discount is the rep discount. When both are populated, the total discount may be higher than intended because they compound.`,
          impact: 'Over-discounting leads to revenue leakage. The compounding effect of both discounts can result in final prices significantly lower than intended.',
          recommendation: 'Review your discounting strategy. Typically only one discount field should be used per line. If both are intentional, verify the final NetPrice matches expectations. Consider using Discount Schedules for volume-based pricing instead.',
          affected_records: discountConflicts.slice(0, 20).map((ql) => ({
            id: ql.Id,
            name: ql.SBQQ__Product__r?.Name || ql.Id,
            type: 'SBQQ__QuoteLine__c',
          })),
          revenue_impact: discountConflicts.length * 50,
        });
      }

      // Check for Uplift + Uplift Amount conflict
      const upliftConflicts = data.quoteLines.filter(
        (ql) =>
          ql.SBQQ__Uplift__c !== null &&
          ql.SBQQ__Uplift__c !== 0 &&
          ql.SBQQ__UpliftAmount__c !== null &&
          ql.SBQQ__UpliftAmount__c !== 0
      );

      if (upliftConflicts.length > 0) {
        issues.push({
          check_id: 'TF-001',
          category: 'quote_lines',
          severity: 'warning',
          title: `${upliftConflicts.length} quote line(s) have both Uplift % and Uplift Amount set`,
          description: `Found ${upliftConflicts.length} quote line(s) where both SBQQ__Uplift__c (percentage) and SBQQ__UpliftAmount__c (flat amount) are populated. These twin fields can cause double-uplift on renewal pricing.`,
          impact: 'Renewal pricing may be inflated beyond what was intended, leading to customer pushback or lost renewals.',
          recommendation: 'Use either Uplift (%) OR Uplift Amount, not both. Check the renewal quote pricing to verify the correct amount is applied.',
          affected_records: upliftConflicts.slice(0, 20).map((ql) => ({
            id: ql.Id,
            name: ql.SBQQ__Product__r?.Name || ql.Id,
            type: 'SBQQ__QuoteLine__c',
          })),
        });
      }

      return issues;
    },
  },
];
