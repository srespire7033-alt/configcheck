import { describe, it, expect } from 'vitest';
import { advancedPricingChecks } from '@/lib/analysis/checks/advanced-pricing';
import { createCleanData } from './fixtures';

const getCheck = (id: string) => advancedPricingChecks.find((c) => c.id === id)!;

describe('Advanced Pricing — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // AP-001: MDQ Products Missing Subscription Setup
  // ═══════════════════════════════════════════════
  describe('AP-001: MDQ Products Missing Subscription Setup', () => {
    const check = getCheck('AP-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when no products use Block pricing', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when Block product has all subscription fields set', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'MDQ Complete', ProductCode: 'MDQ-1', IsActive: true, SBQQ__PricingMethod__c: 'Block', SBQQ__SubscriptionType__c: 'Renewable', SBQQ__SubscriptionPricing__c: 'Fixed Price', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when Block product is inactive', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Inactive MDQ', ProductCode: 'MDQ-I', IsActive: false, SBQQ__PricingMethod__c: 'Block', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty products array', async () => {
      const data = createCleanData();
      data.products = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag Block product missing all three subscription fields', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'MDQ Broken', ProductCode: 'MDQ-B', IsActive: true, SBQQ__PricingMethod__c: 'Block', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('AP-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].title).toContain('MDQ Broken');
      expect(issues[0].title).toContain('Subscription Type');
      expect(issues[0].title).toContain('Subscription Pricing');
      expect(issues[0].title).toContain('Charge Type');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('p1');
    });

    it('should flag Block product missing only SubscriptionType', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'MDQ Partial', ProductCode: 'MDQ-P', IsActive: true, SBQQ__PricingMethod__c: 'Block', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: 'Fixed Price', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('Subscription Type');
      expect(issues[0].title).not.toContain('Subscription Pricing');
      expect(issues[0].title).not.toContain('Charge Type');
    });

    it('should create one issue per Block product with missing fields', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'MDQ A', ProductCode: 'MDQ-A', IsActive: true, SBQQ__PricingMethod__c: 'Block', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'MDQ B', ProductCode: 'MDQ-B', IsActive: true, SBQQ__PricingMethod__c: 'Block', SBQQ__SubscriptionType__c: 'Renewable', SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__BillingFrequency__c: null },
        { Id: 'p3', Name: 'MDQ OK', ProductCode: 'MDQ-OK', IsActive: true, SBQQ__PricingMethod__c: 'Block', SBQQ__SubscriptionType__c: 'Renewable', SBQQ__SubscriptionPricing__c: 'Fixed Price', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues[0].affected_records[0].id).toBe('p1');
      expect(issues[1].affected_records[0].id).toBe('p2');
    });
  });

  // ═══════════════════════════════════════════════
  // AP-002: Percent of Total Not In Bundle
  // ═══════════════════════════════════════════════
  describe('AP-002: Percent of Total Not In Bundle', () => {
    const check = getCheck('AP-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when no products use Percent Of Total', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when PoT product is a bundle option', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Bundle Parent', ProductCode: 'BUN-1', IsActive: true, SBQQ__PricingMethod__c: 'List', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'PoT Option', ProductCode: 'POT-1', IsActive: true, SBQQ__PricingMethod__c: 'Percent Of Total', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
      ];
      data.productOptions = [
        { Id: 'po1', Name: 'Opt 1', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle Parent', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'PoT Option', IsActive: true } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when PoT product is inactive', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Inactive PoT', ProductCode: 'POT-I', IsActive: false, SBQQ__PricingMethod__c: 'Percent Of Total', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
      ];
      data.productOptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag PoT product not in any bundle', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Standalone PoT', ProductCode: 'POT-S', IsActive: true, SBQQ__PricingMethod__c: 'Percent Of Total', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
      ];
      data.productOptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('AP-002');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('Standalone PoT');
      expect(issues[0].title).toContain('Percent of Total');
      expect(issues[0].affected_records[0].id).toBe('p1');
    });

    it('should flag multiple PoT products not in bundles', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'PoT A', ProductCode: 'POT-A', IsActive: true, SBQQ__PricingMethod__c: 'Percent Of Total', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'PoT B', ProductCode: 'POT-B', IsActive: true, SBQQ__PricingMethod__c: 'Percent Of Total', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
      ];
      data.productOptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues[0].affected_records[0].id).toBe('p1');
      expect(issues[1].affected_records[0].id).toBe('p2');
    });

    it('should only flag PoT product not in bundle when others are', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Bundle', ProductCode: 'BUN-1', IsActive: true, SBQQ__PricingMethod__c: 'List', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'PoT In Bundle', ProductCode: 'POT-IN', IsActive: true, SBQQ__PricingMethod__c: 'Percent Of Total', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
        { Id: 'p3', Name: 'PoT Standalone', ProductCode: 'POT-OUT', IsActive: true, SBQQ__PricingMethod__c: 'Percent Of Total', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
      ];
      data.productOptions = [
        { Id: 'po1', Name: 'Opt 1', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'PoT In Bundle', IsActive: true } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('p3');
      expect(issues[0].title).toContain('PoT Standalone');
    });
  });

  // ═══════════════════════════════════════════════
  // AP-003: Cost Pricing Without Price Book
  // ═══════════════════════════════════════════════
  describe('AP-003: Cost Pricing Without Price Book', () => {
    const check = getCheck('AP-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when no products use Cost pricing', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when Cost product has a pricebook entry', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Cost Product', ProductCode: 'COST-1', IsActive: true, SBQQ__PricingMethod__c: 'Cost', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
      ];
      data.pricebookEntries = [
        { Id: 'pbe1', Product2Id: 'p1', Product2: { Name: 'Cost Product' }, Pricebook2Id: 'std', UnitPrice: 50, IsActive: true },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when Cost product is inactive', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Inactive Cost', ProductCode: 'COST-I', IsActive: false, SBQQ__PricingMethod__c: 'Cost', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
      ];
      data.pricebookEntries = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag Cost product with no pricebook entry', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Costless Product', ProductCode: 'COST-X', IsActive: true, SBQQ__PricingMethod__c: 'Cost', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
      ];
      data.pricebookEntries = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('AP-003');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('Costless Product');
      expect(issues[0].affected_records[0].id).toBe('p1');
    });

    it('should flag only Cost products without entries, not those with entries', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Cost With PBE', ProductCode: 'COST-1', IsActive: true, SBQQ__PricingMethod__c: 'Cost', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'Cost No PBE', ProductCode: 'COST-2', IsActive: true, SBQQ__PricingMethod__c: 'Cost', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
      ];
      data.pricebookEntries = [
        { Id: 'pbe1', Product2Id: 'p1', Product2: { Name: 'Cost With PBE' }, Pricebook2Id: 'std', UnitPrice: 100, IsActive: true },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('p2');
      expect(issues[0].title).toContain('Cost No PBE');
    });
  });

  // ═══════════════════════════════════════════════
  // AP-004: Recurring Without Billing Frequency
  // ═══════════════════════════════════════════════
  describe('AP-004: Recurring Without Billing Frequency', () => {
    const check = getCheck('AP-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when clean data has recurring product with billing frequency', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when One-Time products have no billing frequency', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'One-Timer', ProductCode: 'OT-1', IsActive: true, SBQQ__PricingMethod__c: 'List', SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive recurring product has no billing frequency', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Inactive Recurring', ProductCode: 'IR-1', IsActive: false, SBQQ__PricingMethod__c: 'List', SBQQ__SubscriptionType__c: 'Renewable', SBQQ__SubscriptionPricing__c: 'Fixed Price', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active recurring product with no billing frequency', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Bad Recurring', ProductCode: 'BR-1', IsActive: true, SBQQ__PricingMethod__c: 'List', SBQQ__SubscriptionType__c: 'Renewable', SBQQ__SubscriptionPricing__c: 'Fixed Price', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('AP-004');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('Bad Recurring');
      expect(issues[0].title).toContain('no billing frequency');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('p1');
    });

    it('should flag multiple recurring products without billing frequency', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Recurring No Freq A', ProductCode: 'RNF-A', IsActive: true, SBQQ__PricingMethod__c: 'List', SBQQ__SubscriptionType__c: 'Renewable', SBQQ__SubscriptionPricing__c: 'Fixed Price', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'Recurring No Freq B', ProductCode: 'RNF-B', IsActive: true, SBQQ__PricingMethod__c: 'List', SBQQ__SubscriptionType__c: 'Renewable', SBQQ__SubscriptionPricing__c: 'Fixed Price', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: null },
        { Id: 'p3', Name: 'Recurring OK', ProductCode: 'ROK', IsActive: true, SBQQ__PricingMethod__c: 'List', SBQQ__SubscriptionType__c: 'Renewable', SBQQ__SubscriptionPricing__c: 'Fixed Price', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: 'Annual' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues[0].affected_records[0].id).toBe('p1');
      expect(issues[1].affected_records[0].id).toBe('p2');
    });
  });
});
