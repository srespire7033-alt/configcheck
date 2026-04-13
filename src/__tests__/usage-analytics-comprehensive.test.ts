import { describe, it, expect } from 'vitest';
import { usageAnalyticsChecks } from '@/lib/analysis/checks/usage-analytics';
import { createCleanData } from './fixtures';

const getCheck = (id: string) => usageAnalyticsChecks.find((c) => c.id === id)!;

describe('Usage Analytics — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // UA-001: Dead-Weight Products
  // Gets quoted product NAMES from quoteLines. Finds active products
  // whose Name is NOT in quoted set. Flags if unquotedProducts >= 5
  // AND deadWeightPct >= 20.
  // Clean fixture: 3 products all quoted (Product A, B, C appear in quoteLines).
  // ═══════════════════════════════════════════════
  describe('UA-001: Dead-Weight Products', () => {
    const check = getCheck('UA-001');

    // ── Negative tests ──
    it('should pass with clean fixture data (all 3 products are quoted)', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when fewer than 5 products are unquoted', async () => {
      const data = createCleanData();
      // 7 active products, 3 quoted => 4 unquoted (below 5 threshold)
      data.products = [
        ...data.products,
        { Id: 'p4', Name: 'Unquoted D', ProductCode: 'UQ-D', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p5', Name: 'Unquoted E', ProductCode: 'UQ-E', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p6', Name: 'Unquoted F', ProductCode: 'UQ-F', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p7', Name: 'Unquoted G', ProductCode: 'UQ-G', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when 5+ unquoted but deadWeightPct is below 20%', async () => {
      const data = createCleanData();
      // 30 products, 25 quoted, 5 unquoted = 5/30 = 17% < 20%
      const quotedNames = Array.from({ length: 25 }, (_, i) => `QuotedProd_${i}`);
      const unquotedNames = Array.from({ length: 5 }, (_, i) => `UnquotedProd_${i}`);
      data.products = [
        ...quotedNames.map((name, i) => ({
          Id: `pq_${i}`, Name: name, ProductCode: `QP-${i}`, IsActive: true,
          SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null,
          SBQQ__ChargeType__c: 'One-Time' as const, SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' as const,
        })),
        ...unquotedNames.map((name, i) => ({
          Id: `pu_${i}`, Name: name, ProductCode: `UP-${i}`, IsActive: true,
          SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null,
          SBQQ__ChargeType__c: 'One-Time' as const, SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' as const,
        })),
      ];
      data.quoteLines = quotedNames.map((name, i) => ({
        Id: `ql_${i}`, SBQQ__Quote__c: 'q1',
        SBQQ__Product__r: { Name: name }, SBQQ__Quantity__c: 1,
        SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 100, SBQQ__ListPrice__c: 100,
        SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null,
        SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null,
        SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null,
      }));
      // 5/30 = 17% < 20% => no issue
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag when 5+ unquoted products and deadWeightPct >= 20%', async () => {
      const data = createCleanData();
      // 10 active products, 3 quoted (from clean fixture) => 7 unquoted = 70%
      data.products = [
        ...data.products,
        { Id: 'p4', Name: 'Unquoted D', ProductCode: 'UQ-D', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p5', Name: 'Unquoted E', ProductCode: 'UQ-E', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p6', Name: 'Unquoted F', ProductCode: 'UQ-F', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p7', Name: 'Unquoted G', ProductCode: 'UQ-G', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p8', Name: 'Unquoted H', ProductCode: 'UQ-H', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p9', Name: 'Unquoted I', ProductCode: 'UQ-I', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p10', Name: 'Unquoted J', ProductCode: 'UQ-J', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('UA-001');
      expect(issues[0].severity).toBe('info');
      expect(issues[0].title).toContain('7');
    });

    it('should flag at boundary: exactly 5 unquoted and exactly 20% dead weight', async () => {
      const data = createCleanData();
      // 25 total active products, 20 quoted, 5 unquoted = 20%
      const quotedNames = Array.from({ length: 20 }, (_, i) => `QuotedProd_${i}`);
      const unquotedNames = Array.from({ length: 5 }, (_, i) => `DeadProd_${i}`);
      data.products = [
        ...quotedNames.map((name, i) => ({
          Id: `pq_${i}`, Name: name, ProductCode: `QP-${i}`, IsActive: true,
          SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null,
          SBQQ__ChargeType__c: 'One-Time' as const, SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' as const,
        })),
        ...unquotedNames.map((name, i) => ({
          Id: `pu_${i}`, Name: name, ProductCode: `UP-${i}`, IsActive: true,
          SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null,
          SBQQ__ChargeType__c: 'One-Time' as const, SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' as const,
        })),
      ];
      data.quoteLines = quotedNames.map((name, i) => ({
        Id: `ql_${i}`, SBQQ__Quote__c: 'q1',
        SBQQ__Product__r: { Name: name }, SBQQ__Quantity__c: 1,
        SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 100, SBQQ__ListPrice__c: 100,
        SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null,
        SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null,
        SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null,
      }));
      // 5/25 = 20% exactly
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
    });

    it('should only count active products (inactive products are excluded)', async () => {
      const data = createCleanData();
      // Add inactive products -- they should not be counted as dead weight
      data.products = [
        ...data.products,
        { Id: 'p4', Name: 'Inactive D', ProductCode: 'IN-D', IsActive: false, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p5', Name: 'Inactive E', ProductCode: 'IN-E', IsActive: false, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      // Still only 3 active products, all quoted => no issue
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  // UA-002: Untriggered Discount Schedules
  // Counts quoteLines with any discount > 0. Flags if
  // discountSchedules.length >= 3 AND discountUtilizationPct < 5.
  // Clean fixture: 1 discount schedule (needs >= 3), so no trigger.
  // ═══════════════════════════════════════════════
  describe('UA-002: Untriggered Discount Schedules', () => {
    const check = getCheck('UA-002');

    // ── Negative tests ──
    it('should pass with clean fixture data (only 1 discount schedule, needs >= 3)', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when no discount schedules exist', async () => {
      const data = createCleanData();
      data.discountSchedules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when 3+ schedules exist but discount utilization is >= 5%', async () => {
      const data = createCleanData();
      data.discountSchedules = Array.from({ length: 3 }, (_, i) => ({
        Id: `ds_${i}`, Name: `Schedule ${i}`, SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent',
        SBQQ__DiscountTiers__r: { records: [] },
      }));
      // 20 quote lines, 1 with discount => 5% exactly (not < 5)
      data.quoteLines = Array.from({ length: 20 }, (_, i) => ({
        Id: `ql_${i}`, SBQQ__Quote__c: 'q1',
        SBQQ__Product__r: { Name: `Prod ${i}` }, SBQQ__Quantity__c: 1,
        SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 100, SBQQ__ListPrice__c: 100,
        SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null,
        SBQQ__ChargeType__c: null,
        SBQQ__Discount__c: i === 0 ? 10 : null,
        SBQQ__AdditionalDiscount__c: null,
        SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null,
      }));
      // 1/20 = 5%, not < 5% => no issue
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag when 3+ schedules and 0% discount utilization', async () => {
      const data = createCleanData();
      data.discountSchedules = Array.from({ length: 3 }, (_, i) => ({
        Id: `ds_${i}`, Name: `Schedule ${i}`, SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent',
        SBQQ__DiscountTiers__r: { records: [] },
      }));
      // All quote lines with zero discounts
      data.quoteLines = Array.from({ length: 10 }, (_, i) => ({
        Id: `ql_${i}`, SBQQ__Quote__c: 'q1',
        SBQQ__Product__r: { Name: `Prod ${i}` }, SBQQ__Quantity__c: 1,
        SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 100, SBQQ__ListPrice__c: 100,
        SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null,
        SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null,
        SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('UA-002');
      expect(issues[0].severity).toBe('info');
      expect(issues[0].title).toContain('0%');
    });

    it('should flag when 3+ schedules and utilization is below 5% but above 0%', async () => {
      const data = createCleanData();
      data.discountSchedules = Array.from({ length: 4 }, (_, i) => ({
        Id: `ds_${i}`, Name: `Schedule ${i}`, SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent',
        SBQQ__DiscountTiers__r: { records: [] },
      }));
      // 50 quote lines, 2 with discount => 4% < 5%
      data.quoteLines = Array.from({ length: 50 }, (_, i) => ({
        Id: `ql_${i}`, SBQQ__Quote__c: 'q1',
        SBQQ__Product__r: { Name: `Prod ${i}` }, SBQQ__Quantity__c: 1,
        SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 100, SBQQ__ListPrice__c: 100,
        SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null,
        SBQQ__ChargeType__c: null,
        SBQQ__Discount__c: i < 2 ? 15 : null,
        SBQQ__AdditionalDiscount__c: null,
        SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null,
      }));
      // 2/50 = 4% < 5%
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].title).toContain('4%');
    });

    it('should detect AdditionalDiscount as usage too (boundary: exactly 5% should not trigger)', async () => {
      const data = createCleanData();
      data.discountSchedules = Array.from({ length: 3 }, (_, i) => ({
        Id: `ds_${i}`, Name: `Schedule ${i}`, SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent',
        SBQQ__DiscountTiers__r: { records: [] },
      }));
      // 20 lines, 1 with AdditionalDiscount only => 5% (not < 5, so no trigger)
      data.quoteLines = Array.from({ length: 20 }, (_, i) => ({
        Id: `ql_${i}`, SBQQ__Quote__c: 'q1',
        SBQQ__Product__r: { Name: `Prod ${i}` }, SBQQ__Quantity__c: 1,
        SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 100, SBQQ__ListPrice__c: 100,
        SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null,
        SBQQ__ChargeType__c: null, SBQQ__Discount__c: null,
        SBQQ__AdditionalDiscount__c: i === 0 ? 5 : null,
        SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null,
      }));
      // 1/20 = 5% => exactly at boundary, NOT < 5 => no issue
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  // UA-003: Stale Inactive Rules
  // Counts inactive price rules + inactive product rules.
  // Flags if totalInactive >= 5 OR (totalInactive >= 3 AND inactivePct >= 30).
  // Clean fixture: 0 inactive rules.
  // ═══════════════════════════════════════════════
  describe('UA-003: Stale Inactive Rules', () => {
    const check = getCheck('UA-003');

    // ── Negative tests ──
    it('should pass with clean fixture data (0 inactive rules)', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with 4 inactive rules and low percentage (< 30%)', async () => {
      const data = createCleanData();
      // 4 inactive + 11 active = 15 total, 4/15 = 27% < 30%, and 4 < 5
      data.priceRules = [
        ...Array.from({ length: 8 }, (_, i) => ({
          Id: `pr_a_${i}`, Name: `Active PR ${i}`, SBQQ__Active__c: true,
          SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          Id: `pr_i_${i}`, Name: `Inactive PR ${i}`, SBQQ__Active__c: false,
          SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
        })),
      ];
      data.productRules = Array.from({ length: 3 }, (_, i) => ({
        Id: `prd_a_${i}`, Name: `Active PRD ${i}`, SBQQ__Active__c: true, SBQQ__Type__c: 'Validation',
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__ConditionsMet__c: 'All',
        SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] },
      }));
      // total = 15, inactive = 4 (< 5), pct = 4/15 = 27% (< 30%) => no trigger
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with 2 inactive rules (below both thresholds)', async () => {
      const data = createCleanData();
      data.priceRules = [
        ...data.priceRules,
        { Id: 'pr_i1', Name: 'Inactive 1', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
        { Id: 'pr_i2', Name: 'Inactive 2', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      // total = 5 (2 active PR + 1 active PRD + 2 inactive), inactive = 2 (< 3 AND < 5)
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag when totalInactive >= 5', async () => {
      const data = createCleanData();
      data.priceRules = [
        ...data.priceRules,
        ...Array.from({ length: 5 }, (_, i) => ({
          Id: `pr_i_${i}`, Name: `Inactive PR ${i}`, SBQQ__Active__c: false,
          SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
        })),
      ];
      // total = 8 (2 active PR + 1 active PRD + 5 inactive), inactive = 5
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('UA-003');
      expect(issues[0].severity).toBe('info');
      expect(issues[0].title).toContain('5');
    });

    it('should flag when totalInactive >= 3 AND inactivePct >= 30%', async () => {
      const data = createCleanData();
      // 3 inactive PR + 2 active PR + 1 active PRD = 6 total, 3/6 = 50%
      data.priceRules = [
        ...data.priceRules,
        ...Array.from({ length: 3 }, (_, i) => ({
          Id: `pr_i_${i}`, Name: `Inactive PR ${i}`, SBQQ__Active__c: false,
          SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
        })),
      ];
      // total = 6, inactive = 3, pct = 50% => triggers
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
    });

    it('should count inactive product rules toward the total', async () => {
      const data = createCleanData();
      // Add 3 inactive product rules + 2 inactive price rules = 5 total inactive
      data.priceRules = [
        ...data.priceRules,
        ...Array.from({ length: 2 }, (_, i) => ({
          Id: `pr_i_${i}`, Name: `Inactive PR ${i}`, SBQQ__Active__c: false,
          SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
        })),
      ];
      data.productRules = [
        ...data.productRules,
        ...Array.from({ length: 3 }, (_, i) => ({
          Id: `prd_i_${i}`, Name: `Inactive PRD ${i}`, SBQQ__Active__c: false, SBQQ__Type__c: 'Validation',
          SBQQ__EvaluationOrder__c: null, SBQQ__ConditionsMet__c: 'All',
          SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] },
        })),
      ];
      // total inactive = 5 => triggers
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('5');
      expect(issues[0].title).toContain('2 price');
      expect(issues[0].title).toContain('3 product');
    });

    it('should include affected records from both price and product rules', async () => {
      const data = createCleanData();
      data.priceRules = [
        ...data.priceRules,
        ...Array.from({ length: 4 }, (_, i) => ({
          Id: `pr_i_${i}`, Name: `Inactive PR ${i}`, SBQQ__Active__c: false,
          SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
        })),
      ];
      data.productRules = [
        ...data.productRules,
        ...Array.from({ length: 3 }, (_, i) => ({
          Id: `prd_i_${i}`, Name: `Inactive PRD ${i}`, SBQQ__Active__c: false, SBQQ__Type__c: 'Validation',
          SBQQ__EvaluationOrder__c: null, SBQQ__ConditionsMet__c: 'All',
          SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] },
        })),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      const types = issues[0].affected_records.map((r) => r.type);
      expect(types).toContain('SBQQ__PriceRule__c');
      expect(types).toContain('SBQQ__ProductRule__c');
    });
  });
});
