import type { HealthCheck, CPQData, Issue } from '@/types';

export const discountScheduleChecks: HealthCheck[] = [
  // DS-001: Tier Overlap
  {
    id: 'DS-001',
    name: 'Discount Tier Overlap',
    category: 'discount_schedules',
    severity: 'critical',
    description: 'Discount tiers with overlapping quantity ranges',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const schedule of data.discountSchedules) {
        const tiers = schedule.SBQQ__DiscountTiers__r?.records || [];
        if (tiers.length < 2) continue;

        for (let i = 0; i < tiers.length; i++) {
          for (let j = i + 1; j < tiers.length; j++) {
            const a = tiers[i];
            const b = tiers[j];
            if (a.SBQQ__LowerBound__c < b.SBQQ__UpperBound__c &&
                b.SBQQ__LowerBound__c < a.SBQQ__UpperBound__c) {
              issues.push({
                check_id: 'DS-001',
                category: 'discount_schedules',
                severity: 'critical',
                title: `Overlapping discount tiers in "${schedule.Name}"`,
                description: `Tier "${a.Name}" (${a.SBQQ__LowerBound__c}-${a.SBQQ__UpperBound__c}) overlaps with Tier "${b.Name}" (${b.SBQQ__LowerBound__c}-${b.SBQQ__UpperBound__c}). Quantities in the overlap range may get the wrong discount.`,
                impact: 'Double discounting or unpredictable discount selection for quantities in the overlap range.',
                recommendation: `Adjust tier boundaries so they don't overlap. Set "${a.Name}" upper bound to ${b.SBQQ__LowerBound__c} or adjust "${b.Name}" lower bound to ${a.SBQQ__UpperBound__c}.`,
                affected_records: [
                  { id: a.Id, name: a.Name, type: 'SBQQ__DiscountTier__c' },
                  { id: b.Id, name: b.Name, type: 'SBQQ__DiscountTier__c' },
                ],
              });
            }
          }
        }
      }

      return issues;
    },
  },

  // DS-002: Tier Gaps
  {
    id: 'DS-002',
    name: 'Discount Tier Gaps',
    category: 'discount_schedules',
    severity: 'warning',
    description: 'Missing quantity coverage between discount tiers',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const schedule of data.discountSchedules) {
        const tiers = (schedule.SBQQ__DiscountTiers__r?.records || [])
          .slice()
          .sort((a, b) => a.SBQQ__LowerBound__c - b.SBQQ__LowerBound__c);

        if (tiers.length < 2) continue;

        for (let i = 0; i < tiers.length - 1; i++) {
          const current = tiers[i];
          const next = tiers[i + 1];
          if (current.SBQQ__UpperBound__c < next.SBQQ__LowerBound__c) {
            const gapStart = current.SBQQ__UpperBound__c;
            const gapEnd = next.SBQQ__LowerBound__c;
            issues.push({
              check_id: 'DS-002',
              category: 'discount_schedules',
              severity: 'warning',
              title: `Discount tier gap in "${schedule.Name}"`,
              description: `No tier covers quantities ${gapStart} to ${gapEnd}. Quantities in this range will receive zero discount.`,
              impact: 'Customers ordering quantities in the gap get no discount - likely unintentional.',
              recommendation: `Add a tier covering ${gapStart}-${gapEnd} or extend existing tier boundaries to close the gap.`,
              affected_records: [
                { id: schedule.Id, name: schedule.Name, type: 'SBQQ__DiscountSchedule__c' },
              ],
            });
          }
        }
      }

      return issues;
    },
  },

  // DS-003: Negative Discount Values
  {
    id: 'DS-003',
    name: 'Negative Discount Values',
    category: 'discount_schedules',
    severity: 'warning',
    description: 'Discount tiers with negative values (surcharges)',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const schedule of data.discountSchedules) {
        const tiers = schedule.SBQQ__DiscountTiers__r?.records || [];
        const negativeTiers = tiers.filter((t) => t.SBQQ__Discount__c < 0);

        for (const tier of negativeTiers) {
          issues.push({
            check_id: 'DS-003',
            category: 'discount_schedules',
            severity: 'warning',
            title: `Negative discount in "${schedule.Name}"`,
            description: `Tier "${tier.Name}" applies ${tier.SBQQ__Discount__c}% (a surcharge, not a discount). This increases the price instead of reducing it.`,
            impact: 'Customers may be charged more than expected. Rarely intentional.',
            recommendation: `Verify this surcharge is intentional. If not, change the discount to a positive value.`,
            affected_records: [
              { id: tier.Id, name: tier.Name, type: 'SBQQ__DiscountTier__c' },
            ],
          });
        }
      }

      return issues;
    },
  },

  // DS-004: Orphaned Discount Schedules
  {
    id: 'DS-004',
    name: 'Orphaned Discount Schedules',
    category: 'discount_schedules',
    severity: 'info',
    description: 'Discount schedules not assigned to any product',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      // This check would need product-to-discount-schedule mapping
      // For MVP, check if schedule has zero tiers (likely unused)
      const emptySchedules = data.discountSchedules.filter(
        (s) => !s.SBQQ__DiscountTiers__r?.records || s.SBQQ__DiscountTiers__r.records.length === 0
      );

      if (emptySchedules.length > 0) {
        issues.push({
          check_id: 'DS-004',
          category: 'discount_schedules',
          severity: 'info',
          title: `${emptySchedules.length} discount schedule(s) with no tiers`,
          description: `${emptySchedules.map((s) => `"${s.Name}"`).join(', ')} exist but have no discount tiers configured.`,
          impact: 'Dead configuration that adds maintenance overhead.',
          recommendation: 'Either configure tiers or delete unused discount schedules.',
          affected_records: emptySchedules.map((s) => ({
            id: s.Id,
            name: s.Name,
            type: 'SBQQ__DiscountSchedule__c',
          })),
        });
      }

      return issues;
    },
  },
];
