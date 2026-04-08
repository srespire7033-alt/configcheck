import type { HealthCheck, CPQData, Issue } from '@/types';

export const subscriptionChecks: HealthCheck[] = [
  // SR-001: Subscriptions with Zero or Null Net Price
  {
    id: 'SR-001',
    name: 'Zero-Value Subscriptions',
    category: 'subscriptions',
    severity: 'warning',
    description: 'Active subscriptions with zero or null net price may indicate pricing errors',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const zeroSubs = data.subscriptions.filter(
        (s) => s.SBQQ__NetPrice__c === 0 || s.SBQQ__NetPrice__c === null
      );

      if (zeroSubs.length > 0) {
        issues.push({
          check_id: 'SR-001',
          category: 'subscriptions',
          severity: 'warning',
          title: `${zeroSubs.length} subscription(s) with zero or missing net price`,
          description: `Found ${zeroSubs.length} subscription record(s) where SBQQ__NetPrice__c is zero or null. These may represent free subscriptions, but could also indicate pricing was not applied correctly during quoting.`,
          impact: 'Revenue leakage if subscriptions should have been priced. Renewal quotes will inherit zero pricing, compounding the loss.',
          recommendation: 'Review each zero-price subscription. If intentional (e.g., trial/promo), document it. If not, correct the source quote and amend the contract.',
          affected_records: zeroSubs.slice(0, 20).map((s) => ({
            id: s.Id,
            name: s.Name,
            type: 'SBQQ__Subscription__c',
          })),
          revenue_impact: zeroSubs.length * 100, // Estimated impact per subscription
        });
      }

      return issues;
    },
  },

  // SR-002: Subscriptions with Null Prorate Multiplier
  {
    id: 'SR-002',
    name: 'Missing Prorate Multiplier',
    category: 'subscriptions',
    severity: 'warning',
    description: 'Subscriptions without prorate multiplier will cause renewal pricing issues',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const missingProrate = data.subscriptions.filter(
        (s) =>
          s.SBQQ__ProrateMultiplier__c === null ||
          s.SBQQ__ProrateMultiplier__c === 0
      );

      if (missingProrate.length > 0) {
        issues.push({
          check_id: 'SR-002',
          category: 'subscriptions',
          severity: 'warning',
          title: `${missingProrate.length} subscription(s) missing prorate multiplier`,
          description: `Found ${missingProrate.length} subscription(s) where SBQQ__ProrateMultiplier__c is null or zero. This field controls how subscription pricing scales across co-termed renewals.`,
          impact: 'Renewal quotes will miscalculate pricing. Co-termed subscriptions may show full price instead of prorated amounts.',
          recommendation: 'Check the original quote lines for these subscriptions. The prorate multiplier should flow from the quote line during contract creation.',
          affected_records: missingProrate.slice(0, 20).map((s) => ({
            id: s.Id,
            name: s.Name,
            type: 'SBQQ__Subscription__c',
          })),
        });
      }

      return issues;
    },
  },
];
