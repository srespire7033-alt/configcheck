import { describe, it, expect } from 'vitest';
import { twinFieldChecks } from '@/lib/analysis/checks/twin-fields';
import { createCleanData } from './fixtures';

// Helper to get a specific check
const getCheck = (id: string) => twinFieldChecks.find((c) => c.id === id)!;

// Helper to create a base quote line with all required fields
function makeQuoteLine(overrides: Partial<{
  Id: string;
  SBQQ__Discount__c: number | null;
  SBQQ__AdditionalDiscount__c: number | null;
  SBQQ__Uplift__c: number | null;
  SBQQ__UpliftAmount__c: number | null;
  productName: string;
}> = {}) {
  return {
    Id: overrides.Id || 'ql-test',
    SBQQ__Quote__c: 'q1',
    SBQQ__Product__r: { Name: overrides.productName || 'Test Product' },
    SBQQ__Quantity__c: 1,
    SBQQ__NetPrice__c: 100,
    SBQQ__NetTotal__c: 100,
    SBQQ__ListPrice__c: 120,
    SBQQ__ProrateMultiplier__c: null,
    SBQQ__SubscriptionPricing__c: null,
    SBQQ__ChargeType__c: null,
    SBQQ__Discount__c: overrides.SBQQ__Discount__c ?? null,
    SBQQ__AdditionalDiscount__c: overrides.SBQQ__AdditionalDiscount__c ?? null,
    SBQQ__UpliftAmount__c: overrides.SBQQ__UpliftAmount__c ?? null,
    SBQQ__Uplift__c: overrides.SBQQ__Uplift__c ?? null,
  };
}

describe('Twin Fields — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // TF-001: Conflicting Twin Field Values
  // ═══════════════════════════════════════════════
  describe('TF-001: Conflicting Twin Field Values', () => {
    const check = getCheck('TF-001');

    // ── Negative tests: Discount twin fields (should NOT trigger) ──
    it('should pass with clean data defaults (no twin field conflicts)', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when only Discount is set (no AdditionalDiscount)', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: 10, SBQQ__AdditionalDiscount__c: null }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when only AdditionalDiscount is set (no Discount)', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: 15 }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when both Discount fields are null', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when both Discount fields are zero', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: 0, SBQQ__AdditionalDiscount__c: 0 }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when Discount is non-zero but AdditionalDiscount is zero', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: 10, SBQQ__AdditionalDiscount__c: 0 }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when Discount is zero and AdditionalDiscount is non-zero', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: 0, SBQQ__AdditionalDiscount__c: 5 }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Negative tests: Uplift twin fields (should NOT trigger) ──
    it('should pass when only Uplift is set (no UpliftAmount)', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Uplift__c: 5, SBQQ__UpliftAmount__c: null }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when only UpliftAmount is set (no Uplift)', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Uplift__c: null, SBQQ__UpliftAmount__c: 100 }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when both Uplift fields are zero', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Uplift__c: 0, SBQQ__UpliftAmount__c: 0 }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty quoteLines array', async () => {
      const data = createCleanData();
      data.quoteLines = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests: Discount twin fields (should trigger) ──
    it('should flag when both Discount and AdditionalDiscount are non-zero', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: 10, SBQQ__AdditionalDiscount__c: 5 }),
      ];
      const issues = await check.run(data);
      const discountIssue = issues.find((i) => i.title.toLowerCase().includes('discount'));
      expect(discountIssue).toBeDefined();
      expect(discountIssue!.check_id).toBe('TF-001');
      expect(discountIssue!.severity).toBe('warning');
      expect(discountIssue!.title).toContain('1');
    });

    it('should flag multiple quote lines with discount twin conflict', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: 10, SBQQ__AdditionalDiscount__c: 5, productName: 'Prod A' }),
        makeQuoteLine({ Id: 'ql2', SBQQ__Discount__c: 20, SBQQ__AdditionalDiscount__c: 3, productName: 'Prod B' }),
        makeQuoteLine({ Id: 'ql3', SBQQ__Discount__c: 15, SBQQ__AdditionalDiscount__c: null, productName: 'Prod C' }),
      ];
      const issues = await check.run(data);
      const discountIssue = issues.find((i) => i.title.toLowerCase().includes('discount'));
      expect(discountIssue).toBeDefined();
      expect(discountIssue!.title).toContain('2');
    });

    it('should include revenue_impact for discount conflicts', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: 10, SBQQ__AdditionalDiscount__c: 5 }),
      ];
      const issues = await check.run(data);
      const discountIssue = issues.find((i) => i.title.toLowerCase().includes('discount'));
      expect(discountIssue).toHaveProperty('revenue_impact');
    });

    // ── Positive tests: Uplift twin fields (should trigger) ──
    it('should flag when both Uplift and UpliftAmount are non-zero', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Uplift__c: 5, SBQQ__UpliftAmount__c: 200 }),
      ];
      const issues = await check.run(data);
      const upliftIssue = issues.find((i) => i.title.toLowerCase().includes('uplift'));
      expect(upliftIssue).toBeDefined();
      expect(upliftIssue!.check_id).toBe('TF-001');
      expect(upliftIssue!.severity).toBe('warning');
      expect(upliftIssue!.title).toContain('1');
    });

    it('should flag multiple quote lines with uplift twin conflict', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Uplift__c: 3, SBQQ__UpliftAmount__c: 100, productName: 'Prod X' }),
        makeQuoteLine({ Id: 'ql2', SBQQ__Uplift__c: 7, SBQQ__UpliftAmount__c: 50, productName: 'Prod Y' }),
      ];
      const issues = await check.run(data);
      const upliftIssue = issues.find((i) => i.title.toLowerCase().includes('uplift'));
      expect(upliftIssue).toBeDefined();
      expect(upliftIssue!.title).toContain('2');
    });

    // ── Combined tests ──
    it('should produce two separate issues when both discount AND uplift conflicts exist', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: 10, SBQQ__AdditionalDiscount__c: 5, SBQQ__Uplift__c: 3, SBQQ__UpliftAmount__c: 100 }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      const titles = issues.map((i) => i.title.toLowerCase());
      expect(titles.some((t) => t.includes('discount'))).toBe(true);
      expect(titles.some((t) => t.includes('uplift'))).toBe(true);
    });

    it('should produce only discount issue when uplift fields are clean', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: 10, SBQQ__AdditionalDiscount__c: 5, SBQQ__Uplift__c: null, SBQQ__UpliftAmount__c: null }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title.toLowerCase()).toContain('discount');
    });

    it('should produce only uplift issue when discount fields are clean', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__Uplift__c: 5, SBQQ__UpliftAmount__c: 200 }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title.toLowerCase()).toContain('uplift');
    });

    it('should include affected records with product names', async () => {
      const data = createCleanData();
      data.quoteLines = [
        makeQuoteLine({ Id: 'ql1', SBQQ__Discount__c: 10, SBQQ__AdditionalDiscount__c: 5, productName: 'Enterprise License' }),
      ];
      const issues = await check.run(data);
      const discountIssue = issues.find((i) => i.title.toLowerCase().includes('discount'));
      expect(discountIssue!.affected_records[0].name).toBe('Enterprise License');
    });
  });
});
