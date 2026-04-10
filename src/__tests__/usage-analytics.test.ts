import { describe, it, expect } from 'vitest';
import { usageAnalyticsChecks } from '@/lib/analysis/checks/usage-analytics';
import { createCleanData, createProblematicData } from './fixtures';

describe('Usage Analytics Checks', () => {
  describe('UA-001: Dead-Weight Products', () => {
    const check = usageAnalyticsChecks.find(c => c.id === 'UA-001')!;

    it('should NOT trigger when all products are quoted', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when >= 5 active products are never quoted and >= 20% dead weight', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      const issue = issues[0];
      expect(issue.check_id).toBe('UA-001');
      expect(issue.category).toBe('products');
      expect(issue.affected_records.length).toBeGreaterThanOrEqual(5);
    });

    it('should NOT trigger when fewer than 5 unquoted products', async () => {
      const data = createCleanData();
      // Add 3 unquoted products (below threshold of 5)
      for (let i = 0; i < 3; i++) {
        data.products.push({
          Id: `unquoted_${i}`, Name: `Unquoted ${i}`, ProductCode: `UQ-${i}`, IsActive: true,
          SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null,
          SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List',
        });
      }
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });
  });

  describe('UA-002: Untriggered Discount Schedules', () => {
    const check = usageAnalyticsChecks.find(c => c.id === 'UA-002')!;

    it('should NOT trigger when discount schedules are utilized', async () => {
      const data = createCleanData();
      // Default data has 1 discount schedule and quote lines with discounts
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when >= 3 discount schedules exist but < 5% lines have discounts', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('UA-002');
      expect(issues[0].category).toBe('discount_schedules');
    });
  });

  describe('UA-003: Stale Inactive Rules', () => {
    const check = usageAnalyticsChecks.find(c => c.id === 'UA-003')!;

    it('should NOT trigger when no inactive rules exist', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when >= 5 inactive rules exist', async () => {
      const data = createProblematicData();
      // Has 10 inactive price rules + 8 inactive product rules = 18
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('UA-003');
      expect(['warning', 'info']).toContain(issues[0].severity);
    });
  });
});
