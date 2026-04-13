import { describe, it, expect } from 'vitest';
import { discountScheduleChecks } from '@/lib/analysis/checks/discount-schedules';
import { createCleanData } from './fixtures';

// Helper to get a specific check
const getCheck = (id: string) => discountScheduleChecks.find((c) => c.id === id)!;

describe('Discount Schedules — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // DS-001: Discount Tier Overlap
  // ═══════════════════════════════════════════════
  describe('DS-001: Discount Tier Overlap', () => {
    const check = getCheck('DS-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when tiers do not overlap', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Volume Discount', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 10, SBQQ__Discount__c: 5 },
          { Id: 'dt2', Name: 'Tier 2', SBQQ__LowerBound__c: 10, SBQQ__UpperBound__c: 50, SBQQ__Discount__c: 10 },
          { Id: 'dt3', Name: 'Tier 3', SBQQ__LowerBound__c: 50, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 15 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with a single tier', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Single Tier', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 10 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty tiers', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Empty', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty discount schedules array', async () => {
      const data = createCleanData();
      data.discountSchedules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when tiers are exactly adjacent (upper = next lower)', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Adjacent', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 0, SBQQ__UpperBound__c: 50, SBQQ__Discount__c: 5 },
          { Id: 'dt2', Name: 'Tier 2', SBQQ__LowerBound__c: 50, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 10 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag overlapping tiers (1-100 and 50-200)', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Overlap Schedule', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 5 },
          { Id: 'dt2', Name: 'Tier 2', SBQQ__LowerBound__c: 50, SBQQ__UpperBound__c: 200, SBQQ__Discount__c: 10 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('DS-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should flag multiple overlapping pairs in the same schedule', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Multi Overlap', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 60, SBQQ__Discount__c: 5 },
          { Id: 'dt2', Name: 'Tier 2', SBQQ__LowerBound__c: 50, SBQQ__UpperBound__c: 110, SBQQ__Discount__c: 10 },
          { Id: 'dt3', Name: 'Tier 3', SBQQ__LowerBound__c: 100, SBQQ__UpperBound__c: 200, SBQQ__Discount__c: 15 },
        ] } },
      ];
      const issues = await check.run(data);
      // Tier1 overlaps Tier2, Tier2 overlaps Tier3
      expect(issues.length).toBeGreaterThanOrEqual(2);
    });

    it('should flag overlapping tiers across separate schedules', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Schedule A', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'A-T1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 5 },
          { Id: 'dt2', Name: 'A-T2', SBQQ__LowerBound__c: 80, SBQQ__UpperBound__c: 200, SBQQ__Discount__c: 10 },
        ] } },
        { Id: 'ds2', Name: 'Schedule B', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt3', Name: 'B-T1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 50, SBQQ__Discount__c: 3 },
          { Id: 'dt4', Name: 'B-T2', SBQQ__LowerBound__c: 25, SBQQ__UpperBound__c: 75, SBQQ__Discount__c: 7 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2); // One per schedule
    });
  });

  // ═══════════════════════════════════════════════
  // DS-002: Discount Tier Gaps
  // ═══════════════════════════════════════════════
  describe('DS-002: Discount Tier Gaps', () => {
    const check = getCheck('DS-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when tiers have continuous coverage', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Continuous', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 50, SBQQ__Discount__c: 5 },
          { Id: 'dt2', Name: 'Tier 2', SBQQ__LowerBound__c: 50, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 10 },
          { Id: 'dt3', Name: 'Tier 3', SBQQ__LowerBound__c: 100, SBQQ__UpperBound__c: 500, SBQQ__Discount__c: 15 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with a single tier', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'One Tier', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 1000, SBQQ__Discount__c: 10 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty discount schedules', async () => {
      const data = createCleanData();
      data.discountSchedules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag gap between tiers (1-50, 75-100)', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Gap Schedule', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 50, SBQQ__Discount__c: 5 },
          { Id: 'dt2', Name: 'Tier 2', SBQQ__LowerBound__c: 75, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 10 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('DS-002');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].description).toContain('50');
      expect(issues[0].description).toContain('75');
    });

    it('should flag multiple gaps in the same schedule', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Multi Gap', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 10, SBQQ__Discount__c: 5 },
          { Id: 'dt2', Name: 'Tier 2', SBQQ__LowerBound__c: 20, SBQQ__UpperBound__c: 30, SBQQ__Discount__c: 10 },
          { Id: 'dt3', Name: 'Tier 3', SBQQ__LowerBound__c: 50, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 15 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2); // Gap 10-20 and gap 30-50
    });

    it('should sort tiers by lower bound before checking gaps', async () => {
      const data = createCleanData();
      // Tiers inserted out of order but contiguous when sorted
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Unordered', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt2', Name: 'Tier 2', SBQQ__LowerBound__c: 50, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 10 },
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 50, SBQQ__Discount__c: 5 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  // DS-003: Negative Discount Values
  // ═══════════════════════════════════════════════
  describe('DS-003: Negative Discount Values', () => {
    const check = getCheck('DS-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all discounts are positive', async () => {
      const data = createCleanData();
      // Default fixture has positive discounts
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when discount is zero', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Zero Discount', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 0 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty tiers', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Empty', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag tier with negative discount', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Surcharge Schedule', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Surcharge Tier', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 10, SBQQ__Discount__c: -5 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('DS-003');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].description).toContain('-5');
    });

    it('should flag multiple negative tiers in the same schedule', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Multi Surcharge', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 10, SBQQ__Discount__c: -3 },
          { Id: 'dt2', Name: 'Tier 2', SBQQ__LowerBound__c: 10, SBQQ__UpperBound__c: 50, SBQQ__Discount__c: 10 },
          { Id: 'dt3', Name: 'Tier 3', SBQQ__LowerBound__c: 50, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: -8 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });

    it('should flag negative discounts across separate schedules', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Schedule A', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'A-T1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: -2 },
        ] } },
        { Id: 'ds2', Name: 'Schedule B', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt2', Name: 'B-T1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: -10 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════
  // DS-004: Schedules with Zero Tiers
  // ═══════════════════════════════════════════════
  describe('DS-004: Schedules with Zero Tiers', () => {
    const check = getCheck('DS-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when schedule has tiers', async () => {
      const data = createCleanData();
      // Default fixture has tiers
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty discount schedules array', async () => {
      const data = createCleanData();
      data.discountSchedules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when all schedules have at least one tier', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Schedule A', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 5 },
        ] } },
        { Id: 'ds2', Name: 'Schedule B', SBQQ__Type__c: 'Slab', SBQQ__DiscountUnit__c: 'Amount', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt2', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 500, SBQQ__Discount__c: 20 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag schedule with empty tiers records', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Empty Schedule', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('DS-004');
      expect(issues[0].severity).toBe('info');
      expect(issues[0].description).toContain('Empty Schedule');
    });

    it('should flag schedule with null tiers subrelation', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Null Tiers', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: null as any },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('DS-004');
    });

    it('should flag multiple empty schedules in a single issue', async () => {
      const data = createCleanData();
      data.discountSchedules = [
        { Id: 'ds1', Name: 'Empty A', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [] } },
        { Id: 'ds2', Name: 'Empty B', SBQQ__Type__c: 'Slab', SBQQ__DiscountUnit__c: 'Amount', SBQQ__DiscountTiers__r: { records: [] } },
        { Id: 'ds3', Name: 'Has Tiers', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [
          { Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 10 },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
    });
  });
});
