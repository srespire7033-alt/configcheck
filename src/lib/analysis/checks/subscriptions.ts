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

  // SR-003: Subscriptions Without Contract Reference
  {
    id: 'SR-003',
    name: 'Subscriptions Without Contract',
    category: 'subscriptions',
    severity: 'critical',
    description: 'Subscription records with no contract reference — orphaned subscriptions',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const orphaned = data.subscriptions.filter((s) => !s.SBQQ__Contract__c);

      if (orphaned.length > 0) {
        issues.push({
          check_id: 'SR-003',
          category: 'subscriptions',
          severity: 'critical',
          title: `${orphaned.length} subscription(s) without contract reference`,
          description: `Found ${orphaned.length} subscription record(s) where SBQQ__Contract__c is null. These orphaned subscriptions are not linked to any contract and won't appear in renewals.`,
          impact: 'Renewal quotes will miss these subscriptions entirely. Revenue will be lost at renewal time.',
          recommendation: 'Investigate how these subscriptions were created. Link them to the correct contract or delete if they are test data.',
          affected_records: orphaned.slice(0, 20).map((s) => ({
            id: s.Id,
            name: s.Name,
            type: 'SBQQ__Subscription__c',
          })),
        });
      }

      return issues;
    },
  },

  // SR-004: High Subscription Quantity Variance
  {
    id: 'SR-004',
    name: 'Subscription Quantity Review',
    category: 'subscriptions',
    severity: 'info',
    description: 'Subscriptions with unusually high quantities that may indicate data entry errors',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const highQty = data.subscriptions.filter(
        (s) => s.SBQQ__Quantity__c !== null && s.SBQQ__Quantity__c > 1000
      );

      if (highQty.length > 0) {
        issues.push({
          check_id: 'SR-004',
          category: 'subscriptions',
          severity: 'info',
          title: `${highQty.length} subscription(s) with quantity > 1,000`,
          description: `Found ${highQty.length} subscription(s) with unusually high quantities. Examples: ${highQty.slice(0, 3).map((s) => `"${s.Name}" (qty: ${s.SBQQ__Quantity__c})`).join(', ')}.`,
          impact: 'High quantities may be intentional (seat-based licensing) or may indicate data entry errors that affect renewal pricing.',
          recommendation: 'Review high-quantity subscriptions to confirm they are correct. Check if quantities were entered manually or flowed from quotes.',
          affected_records: highQty.slice(0, 10).map((s) => ({
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
