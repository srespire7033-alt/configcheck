import { describe, it, expect } from 'vitest';
import { productChecks } from '@/lib/analysis/checks/products';
import { createCleanData } from './fixtures';

const getCheck = (id: string) => productChecks.find((c) => c.id === id)!;

describe('Products — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // PB-001: Products Without Price Book Entry
  // ═══════════════════════════════════════════════
  describe('PB-001: Products Without Price Book Entry', () => {
    const check = getCheck('PB-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all active products have price book entries', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty products array', async () => {
      const data = createCleanData();
      data.products = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when products without PBE are inactive', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Inactive Prod', ProductCode: 'X', IsActive: false, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      data.pricebookEntries = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when product has entry in a non-standard pricebook', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Product A', ProductCode: 'A', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      data.pricebookEntries = [
        { Id: 'pbe1', Product2Id: 'p1', Product2: { Name: 'Product A' }, Pricebook2Id: 'custom-pb', UnitPrice: 100, IsActive: true },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag active product without any price book entry', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Orphan Product', ProductCode: 'ORPH', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      data.pricebookEntries = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PB-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].name).toBe('Orphan Product');
    });

    it('DETECT: should flag multiple orphans grouped into a single issue', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Orphan A', ProductCode: 'A', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p2', Name: 'Orphan B', ProductCode: 'B', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p3', Name: 'Has Entry', ProductCode: 'C', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      data.pricebookEntries = [
        { Id: 'pbe1', Product2Id: 'p3', Product2: { Name: 'Has Entry' }, Pricebook2Id: 'std', UnitPrice: 100, IsActive: true },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PB-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('DETECT: should only flag active products in a mixed active/inactive set', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Active No PBE', ProductCode: 'A', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p2', Name: 'Inactive No PBE', ProductCode: 'B', IsActive: false, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      data.pricebookEntries = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].name).toBe('Active No PBE');
    });
  });

  // ═══════════════════════════════════════════════
  // PB-002: Orphaned Bundle Options
  // ═══════════════════════════════════════════════
  describe('PB-002: Orphaned Bundle Options', () => {
    const check = getCheck('PB-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when both parent and child are active', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty product options array', async () => {
      const data = createCleanData();
      data.productOptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when relationship objects are null (not explicitly false)', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Opt 1', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: null as any, SBQQ__OptionalSKU__r: null as any },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when multiple options all have active parents and children', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Opt 1', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Child A', IsActive: true } },
        { Id: 'po2', Name: 'Opt 2', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p3', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Child B', IsActive: true } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag option with inactive parent bundle', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Orphan Opt', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Dead Bundle', IsActive: false }, SBQQ__OptionalSKU__r: { Name: 'Child', IsActive: true } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PB-002');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
    });

    it('DETECT: should flag option with inactive child product', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Bad Child Opt', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Dead Child', IsActive: false } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PB-002');
      expect(issues[0].severity).toBe('warning');
    });

    it('DETECT: should flag both parent and child inactive as two separate issues', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Double Dead', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Dead Bundle', IsActive: false }, SBQQ__OptionalSKU__r: { Name: 'Dead Child', IsActive: false } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues[0].check_id).toBe('PB-002');
      expect(issues[1].check_id).toBe('PB-002');
    });
  });

  // ═══════════════════════════════════════════════
  // PB-003: Missing Subscription Type
  // ═══════════════════════════════════════════════
  describe('PB-003: Missing Subscription Type', () => {
    const check = getCheck('PB-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when recurring product has subscription type set', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty products array', async () => {
      const data = createCleanData();
      data.products = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when non-recurring products lack subscription type', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'One-Time', ProductCode: 'OT', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p2', Name: 'Usage', ProductCode: 'US', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'Usage', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive recurring product lacks subscription type', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Inactive Recurring', ProductCode: 'IR', IsActive: false, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: 'Monthly', SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag active recurring product without subscription type', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Bad Recurring', ProductCode: 'BR', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: 'Monthly', SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PB-003');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].name).toBe('Bad Recurring');
    });

    it('DETECT: should flag multiple recurring products each as separate issue', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Missing Sub 1', ProductCode: 'MS1', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: 'Monthly', SBQQ__PricingMethod__c: 'List' },
        { Id: 'p2', Name: 'Missing Sub 2', ProductCode: 'MS2', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: 'Annual', SBQQ__PricingMethod__c: 'List' },
        { Id: 'p3', Name: 'Good Recurring', ProductCode: 'GR', IsActive: true, SBQQ__SubscriptionType__c: 'Renewable', SBQQ__SubscriptionPricing__c: 'Fixed Price', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: 'Monthly', SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues.every((i) => i.check_id === 'PB-003')).toBe(true);
      expect(issues.every((i) => i.severity === 'critical')).toBe(true);
    });

    it('DETECT: should flag when subscription type is empty string', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Empty Sub Type', ProductCode: 'EST', IsActive: true, SBQQ__SubscriptionType__c: '' as any, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: 'Monthly', SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PB-003');
    });
  });

  // ═══════════════════════════════════════════════
  // PB-004: Duplicate Product Codes
  // ═══════════════════════════════════════════════
  describe('PB-004: Duplicate Product Codes', () => {
    const check = getCheck('PB-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all active products have unique codes', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty products array', async () => {
      const data = createCleanData();
      data.products = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when duplicate codes are only on inactive products', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Active Unique', ProductCode: 'DUP', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p2', Name: 'Inactive Dup', ProductCode: 'DUP', IsActive: false, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when products have null product codes', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'No Code 1', ProductCode: null as any, IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p2', Name: 'No Code 2', ProductCode: null as any, IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag two active products with the same product code', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Product X', ProductCode: 'SAME-CODE', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p2', Name: 'Product Y', ProductCode: 'SAME-CODE', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PB-004');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('DETECT: should flag multiple groups of duplicate codes separately', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Dup A1', ProductCode: 'CODE-A', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p2', Name: 'Dup A2', ProductCode: 'CODE-A', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p3', Name: 'Dup B1', ProductCode: 'CODE-B', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p4', Name: 'Dup B2', ProductCode: 'CODE-B', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p5', Name: 'Unique', ProductCode: 'CODE-C', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues.every((i) => i.check_id === 'PB-004')).toBe(true);
      expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    });

    it('DETECT: should flag three products sharing same code with 3 affected records', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Triple 1', ProductCode: 'TRIP', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p2', Name: 'Triple 2', ProductCode: 'TRIP', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p3', Name: 'Triple 3', ProductCode: 'TRIP', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PB-004');
      expect(issues[0].affected_records).toHaveLength(3);
    });
  });
});
