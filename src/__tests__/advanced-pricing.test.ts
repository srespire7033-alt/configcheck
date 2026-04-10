import { describe, it, expect } from 'vitest';
import { advancedPricingChecks } from '@/lib/analysis/checks/advanced-pricing';
import { createCleanData, createProblematicData } from './fixtures';

describe('Advanced Pricing Checks', () => {
  describe('AP-001: MDQ Products Missing Subscription Setup', () => {
    const check = advancedPricingChecks.find(c => c.id === 'AP-001')!;

    it('should NOT trigger when no MDQ products exist', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when Block pricing product missing subscription fields', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('AP-001');
      expect(issues[0].category).toBe('advanced_pricing');
      expect(issues[0].severity).toBe('critical');
    });
  });

  describe('AP-002: Percent of Total Without Parent', () => {
    const check = advancedPricingChecks.find(c => c.id === 'AP-002')!;

    it('should NOT trigger when no PoT products exist', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when PoT product is not in any bundle', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('AP-002');
    });
  });

  describe('AP-003: Cost Pricing Without Base Price', () => {
    const check = advancedPricingChecks.find(c => c.id === 'AP-003')!;

    it('should NOT trigger when all products have pricebook entries', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when Cost product has no pricebook entry', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('AP-003');
    });
  });

  describe('AP-004: Billing Frequency Mismatch', () => {
    const check = advancedPricingChecks.find(c => c.id === 'AP-004')!;

    it('should NOT trigger when recurring products have billing frequency', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when recurring product missing billing frequency', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('AP-004');
    });
  });
});
