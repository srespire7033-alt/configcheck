import { describe, it, expect } from 'vitest';
import { quoteLineChecks } from '@/lib/analysis/checks/quote-lines';
import { createCleanData } from './fixtures';

// Helper to get a specific check
const getCheck = (id: string) => quoteLineChecks.find((c) => c.id === id)!;

describe('Quote Lines — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // QL-001: Zero NetPrice on Non-Zero Quantity
  // ═══════════════════════════════════════════════
  describe('QL-001: Zero NetPrice on Non-Zero Quantity', () => {
    const check = getCheck('QL-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with no quote lines', async () => {
      const data = createCleanData();
      data.quoteLines = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when NetPrice is positive', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 1000, SBQQ__ListPrice__c: 120, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when Quantity is zero (no revenue expected)', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 0, SBQQ__NetPrice__c: 0, SBQQ__NetTotal__c: 0, SBQQ__ListPrice__c: 120, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when ListPrice is zero (free product by design)', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Free Add-on' }, SBQQ__Quantity__c: 5, SBQQ__NetPrice__c: 0, SBQQ__NetTotal__c: 0, SBQQ__ListPrice__c: 0, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when Quantity is null', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: null, SBQQ__NetPrice__c: 0, SBQQ__NetTotal__c: 0, SBQQ__ListPrice__c: 100, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag line with Qty > 0, NetPrice = 0, ListPrice > 0', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Premium License' }, SBQQ__Quantity__c: 5, SBQQ__NetPrice__c: 0, SBQQ__NetTotal__c: 0, SBQQ__ListPrice__c: 500, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('QL-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records[0].id).toBe('ql1');
    });

    it('should flag line with null NetPrice', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 1, SBQQ__NetPrice__c: null, SBQQ__NetTotal__c: 0, SBQQ__ListPrice__c: 200, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
    });

    it('should group flagged lines by quote', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 2, SBQQ__NetPrice__c: 0, SBQQ__NetTotal__c: 0, SBQQ__ListPrice__c: 100, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
        { Id: 'ql2', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product B' }, SBQQ__Quantity__c: 3, SBQQ__NetPrice__c: 0, SBQQ__NetTotal__c: 0, SBQQ__ListPrice__c: 200, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
        { Id: 'ql3', SBQQ__Quote__c: 'q2', SBQQ__Product__r: { Name: 'Product C' }, SBQQ__Quantity__c: 1, SBQQ__NetPrice__c: 0, SBQQ__NetTotal__c: 0, SBQQ__ListPrice__c: 300, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      // Should be grouped into 2 issues (one per quote)
      expect(issues).toHaveLength(2);
      const q1Issue = issues.find((i) => i.affected_records.some((r) => r.id === 'ql1'));
      expect(q1Issue!.affected_records).toHaveLength(2);
    });

    it('should include product names in description', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Widget Pro' }, SBQQ__Quantity__c: 1, SBQQ__NetPrice__c: 0, SBQQ__NetTotal__c: 0, SBQQ__ListPrice__c: 999, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues[0].description).toContain('Widget Pro');
    });
  });

  // ═══════════════════════════════════════════════
  // QL-002: NetTotal Calculation Mismatch
  // ═══════════════════════════════════════════════
  describe('QL-002: NetTotal Calculation Mismatch', () => {
    const check = getCheck('QL-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when NetTotal matches NetPrice * Quantity exactly', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 1000, SBQQ__ListPrice__c: 120, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with small rounding difference under $1', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 3, SBQQ__NetPrice__c: 33.33, SBQQ__NetTotal__c: 100, SBQQ__ListPrice__c: 40, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      // 33.33 * 3 = 99.99, diff = 0.01 which is < $1
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip lines with null NetPrice', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 5, SBQQ__NetPrice__c: null, SBQQ__NetTotal__c: 500, SBQQ__ListPrice__c: 100, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip lines with null Quantity', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: null, SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 999, SBQQ__ListPrice__c: 100, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip lines with null NetTotal', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 5, SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: null, SBQQ__ListPrice__c: 100, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty quote lines array', async () => {
      const data = createCleanData();
      data.quoteLines = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag significant calculation mismatch (> $1 and > 1%)', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Mismatched Product' }, SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 500, SBQQ__ListPrice__c: 120, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      // Expected: 100 * 10 = 1000, Actual: 500, diff = 500 (50%)
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('QL-002');
      expect(issues[0].severity).toBe('critical');
    });

    it('should flag multiple mismatched lines', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 5, SBQQ__NetPrice__c: 200, SBQQ__NetTotal__c: 500, SBQQ__ListPrice__c: 250, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
        { Id: 'ql2', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product B' }, SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 50, SBQQ__NetTotal__c: 200, SBQQ__ListPrice__c: 60, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      // ql1: 200*5=1000 vs 500 (diff=500), ql2: 50*10=500 vs 200 (diff=300)
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('2');
    });

    it('should include product name in description', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Enterprise Suite' }, SBQQ__Quantity__c: 2, SBQQ__NetPrice__c: 1000, SBQQ__NetTotal__c: 500, SBQQ__ListPrice__c: 1200, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues[0].description).toContain('Enterprise Suite');
    });
  });

  // ═══════════════════════════════════════════════
  // QL-003: Negative Net Totals
  // ═══════════════════════════════════════════════
  describe('QL-003: Negative Net Totals', () => {
    const check = getCheck('QL-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with positive NetTotals', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 1000, SBQQ__ListPrice__c: 120, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with null NetTotal', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 1, SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: null, SBQQ__ListPrice__c: 100, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with zero NetTotal', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 1, SBQQ__NetPrice__c: 0, SBQQ__NetTotal__c: 0, SBQQ__ListPrice__c: 0, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty quote lines', async () => {
      const data = createCleanData();
      data.quoteLines = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag lines with negative NetTotal', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Credit Line' }, SBQQ__Quantity__c: 1, SBQQ__NetPrice__c: -500, SBQQ__NetTotal__c: -500, SBQQ__ListPrice__c: 500, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('QL-003');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records[0].id).toBe('ql1');
    });

    it('should flag multiple negative lines', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Credit A' }, SBQQ__Quantity__c: 1, SBQQ__NetPrice__c: -100, SBQQ__NetTotal__c: -100, SBQQ__ListPrice__c: 100, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
        { Id: 'ql2', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Credit B' }, SBQQ__Quantity__c: 2, SBQQ__NetPrice__c: -50, SBQQ__NetTotal__c: -100, SBQQ__ListPrice__c: 50, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
        { Id: 'ql3', SBQQ__Quote__c: 'q2', SBQQ__Product__r: { Name: 'Normal' }, SBQQ__Quantity__c: 1, SBQQ__NetPrice__c: 200, SBQQ__NetTotal__c: 200, SBQQ__ListPrice__c: 200, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('2');
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should include product names and dollar amounts in description', async () => {
      const data = createCleanData();
      data.quoteLines = [
        { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Refund Item' }, SBQQ__Quantity__c: 1, SBQQ__NetPrice__c: -250, SBQQ__NetTotal__c: -250, SBQQ__ListPrice__c: 250, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      ];
      const issues = await check.run(data);
      expect(issues[0].description).toContain('Refund Item');
      expect(issues[0].description).toContain('-250');
    });
  });
});
