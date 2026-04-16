import { describe, it, expect } from 'vitest';
import { bundleIntegrityChecks } from '@/lib/analysis/checks/bundle-integrity';
import { createCleanData } from './fixtures';

const getCheck = (id: string) => bundleIntegrityChecks.find((c) => c.id === id)!;

describe('Bundle Integrity — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // BN-001: Empty Bundles
  // ═══════════════════════════════════════════════
  describe('BN-001: Empty Bundles', () => {
    const check = getCheck('BN-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when bundle has product options', async () => {
      const data = createCleanData();
      // p1 is a bundle (ConfigurationType='Allowed') with option po1
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty products array', async () => {
      const data = createCleanData();
      data.products = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when product has no ConfigurationType (not a bundle)', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Standalone', ProductCode: 'S', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: null },
      ];
      data.productOptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive bundle has no options', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Inactive Bundle', ProductCode: 'IB', IsActive: false, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: 'Required' },
      ];
      data.productOptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag active bundle with ConfigurationType but no options', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p_empty', Name: 'Empty Bundle', ProductCode: 'EB', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: 'Required' },
      ];
      data.productOptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('BN-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records[0].name).toBe('Empty Bundle');
    });

    it('DETECT: should flag multiple empty bundles', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'b1', Name: 'Bundle A', ProductCode: 'BA', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: 'Allowed' },
        { Id: 'b2', Name: 'Bundle B', ProductCode: 'BB', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: 'Required' },
        { Id: 'p3', Name: 'Not a bundle', ProductCode: 'NB', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: null },
      ];
      data.productOptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues.every((i) => i.check_id === 'BN-001')).toBe(true);
    });

    it('DETECT: should not flag bundle that has options even if another bundle is empty', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'b1', Name: 'Good Bundle', ProductCode: 'GB', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: 'Allowed' },
        { Id: 'b2', Name: 'Empty Bundle', ProductCode: 'EB', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: 'Required' },
        { Id: 'c1', Name: 'Child', ProductCode: 'CH', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: null },
      ];
      data.productOptions = [
        { Id: 'po1', Name: 'Opt 1', SBQQ__ConfiguredSKU__c: 'b1', SBQQ__OptionalSKU__c: 'c1', SBQQ__ConfiguredSKU__r: { Name: 'Good Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Child', IsActive: true } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records[0].name).toBe('Empty Bundle');
    });
  });

  // ═══════════════════════════════════════════════
  // BN-002: Option Min/Max Quantity Mismatch
  // ═══════════════════════════════════════════════
  describe('BN-002: Option Min/Max Quantity Mismatch', () => {
    const check = getCheck('BN-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when min < max', async () => {
      const data = createCleanData();
      // Fixture has min=1, max=10
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when min equals max', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Exact Qty', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Child', IsActive: true }, SBQQ__Required__c: false, SBQQ__MinQuantity__c: 5, SBQQ__MaxQuantity__c: 5, SBQQ__Number__c: 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when min and max are both null', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'No Limits', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Child', IsActive: true }, SBQQ__Required__c: false, SBQQ__MinQuantity__c: null, SBQQ__MaxQuantity__c: null, SBQQ__Number__c: 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when only min is set (no max)', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Min Only', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Child', IsActive: true }, SBQQ__Required__c: false, SBQQ__MinQuantity__c: 5, SBQQ__MaxQuantity__c: null, SBQQ__Number__c: 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag option where min > max', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Bad Qty', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Child', IsActive: true }, SBQQ__Required__c: false, SBQQ__MinQuantity__c: 10, SBQQ__MaxQuantity__c: 5, SBQQ__Number__c: 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('BN-002');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].description).toContain('10');
      expect(issues[0].description).toContain('5');
    });

    it('DETECT: should flag multiple options with quantity mismatches', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Bad A', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Child A', IsActive: true }, SBQQ__Required__c: false, SBQQ__MinQuantity__c: 20, SBQQ__MaxQuantity__c: 1, SBQQ__Number__c: 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
        { Id: 'po2', Name: 'Good', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p3', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Child B', IsActive: true }, SBQQ__Required__c: false, SBQQ__MinQuantity__c: 1, SBQQ__MaxQuantity__c: 10, SBQQ__Number__c: 2, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
        { Id: 'po3', Name: 'Bad B', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p4', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Child C', IsActive: true }, SBQQ__Required__c: false, SBQQ__MinQuantity__c: 100, SBQQ__MaxQuantity__c: 50, SBQQ__Number__c: 3, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues.every((i) => i.check_id === 'BN-002')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // BN-003: Deeply Nested Bundles
  // ═══════════════════════════════════════════════
  describe('BN-003: Deeply Nested Bundles', () => {
    const check = getCheck('BN-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with single-level bundle', async () => {
      const data = createCleanData();
      // p1 -> p2 (depth 2, under threshold)
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with 3-level nesting (at threshold)', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'L1', SBQQ__ConfiguredSKU__c: 'root', SBQQ__OptionalSKU__c: 'mid', SBQQ__ConfiguredSKU__r: { Name: 'Root', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Mid', IsActive: true } },
        { Id: 'po2', Name: 'L2', SBQQ__ConfiguredSKU__c: 'mid', SBQQ__OptionalSKU__c: 'leaf', SBQQ__ConfiguredSKU__r: { Name: 'Mid', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Leaf', IsActive: true } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0); // depth=3 is at threshold, not exceeding
    });

    it('should pass with empty product options', async () => {
      const data = createCleanData();
      data.productOptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag 4-level deep nesting', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'l1', Name: 'Level 1 Bundle', ProductCode: 'L1', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: 'Allowed' },
        { Id: 'l2', Name: 'Level 2 Bundle', ProductCode: 'L2', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: 'Allowed' },
        { Id: 'l3', Name: 'Level 3 Bundle', ProductCode: 'L3', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: 'Allowed' },
        { Id: 'l4', Name: 'Leaf Product', ProductCode: 'L4', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: null },
      ];
      data.productOptions = [
        { Id: 'po1', Name: 'L1→L2', SBQQ__ConfiguredSKU__c: 'l1', SBQQ__OptionalSKU__c: 'l2', SBQQ__ConfiguredSKU__r: { Name: 'Level 1', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Level 2', IsActive: true } },
        { Id: 'po2', Name: 'L2→L3', SBQQ__ConfiguredSKU__c: 'l2', SBQQ__OptionalSKU__c: 'l3', SBQQ__ConfiguredSKU__r: { Name: 'Level 2', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Level 3', IsActive: true } },
        { Id: 'po3', Name: 'L3→L4', SBQQ__ConfiguredSKU__c: 'l3', SBQQ__OptionalSKU__c: 'l4', SBQQ__ConfiguredSKU__r: { Name: 'Level 3', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Leaf', IsActive: true } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('BN-003');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].description).toContain('4');
      expect(issues[0].affected_records[0].name).toBe('Level 1 Bundle');
    });

    it('DETECT: should flag 5-level deep nesting', async () => {
      const data = createCleanData();
      data.products = Array.from({ length: 5 }, (_, i) => ({
        Id: `n${i}`, Name: `Node ${i}`, ProductCode: `N${i}`, IsActive: true,
        SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null,
        SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null,
        SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: i < 4 ? 'Allowed' : null,
      }));
      data.productOptions = Array.from({ length: 4 }, (_, i) => ({
        Id: `po${i}`, Name: `Opt ${i}`, SBQQ__ConfiguredSKU__c: `n${i}`, SBQQ__OptionalSKU__c: `n${i + 1}`,
        SBQQ__ConfiguredSKU__r: { Name: `Node ${i}`, IsActive: true },
        SBQQ__OptionalSKU__r: { Name: `Node ${i + 1}`, IsActive: true },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('5');
    });

    it('should handle circular references without infinite loop', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'A→B', SBQQ__ConfiguredSKU__c: 'a', SBQQ__OptionalSKU__c: 'b', SBQQ__ConfiguredSKU__r: { Name: 'A', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'B', IsActive: true } },
        { Id: 'po2', Name: 'B→A', SBQQ__ConfiguredSKU__c: 'b', SBQQ__OptionalSKU__c: 'a', SBQQ__ConfiguredSKU__r: { Name: 'B', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'A', IsActive: true } },
      ];
      // Should not hang — circular ref means both are children, so no top-level bundles found
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  // BN-004: Required Options Without Price Book Entry
  // ═══════════════════════════════════════════════
  describe('BN-004: Required Options Without Price Book Entry', () => {
    const check = getCheck('BN-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when required option has price book entry', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Required Opt', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Product B', IsActive: true }, SBQQ__Required__c: true, SBQQ__MinQuantity__c: 1, SBQQ__MaxQuantity__c: 1, SBQQ__Number__c: 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
      ];
      // p2 has PBE in clean data
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when non-required option has no PBE', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Optional', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'no_pbe', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'No PBE Product', IsActive: true }, SBQQ__Required__c: false, SBQQ__MinQuantity__c: null, SBQQ__MaxQuantity__c: null, SBQQ__Number__c: 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when required option points to inactive product', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Req Inactive', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'inactive', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Inactive', IsActive: false }, SBQQ__Required__c: true, SBQQ__MinQuantity__c: 1, SBQQ__MaxQuantity__c: 1, SBQQ__Number__c: 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
      ];
      // Inactive products are skipped (PB-002 covers that)
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty product options', async () => {
      const data = createCleanData();
      data.productOptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag required option whose product has no PBE', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Req No PBE', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'orphan', SBQQ__ConfiguredSKU__r: { Name: 'My Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Orphan Product', IsActive: true }, SBQQ__Required__c: true, SBQQ__MinQuantity__c: 1, SBQQ__MaxQuantity__c: 1, SBQQ__Number__c: 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
      ];
      // 'orphan' has no PBE in clean data
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('BN-004');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].description).toContain('My Bundle');
      expect(issues[0].description).toContain('Orphan Product');
    });

    it('DETECT: should flag multiple required options without PBE', async () => {
      const data = createCleanData();
      data.productOptions = [
        { Id: 'po1', Name: 'Req 1', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'no_pbe1', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Missing PBE A', IsActive: true }, SBQQ__Required__c: true, SBQQ__MinQuantity__c: 1, SBQQ__MaxQuantity__c: 1, SBQQ__Number__c: 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
        { Id: 'po2', Name: 'Req 2', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'no_pbe2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Missing PBE B', IsActive: true }, SBQQ__Required__c: true, SBQQ__MinQuantity__c: 1, SBQQ__MaxQuantity__c: 1, SBQQ__Number__c: 2, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
        { Id: 'po3', Name: 'Req OK', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Bundle', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Product B', IsActive: true }, SBQQ__Required__c: true, SBQQ__MinQuantity__c: 1, SBQQ__MaxQuantity__c: 1, SBQQ__Number__c: 3, SBQQ__Feature__c: null, SBQQ__Feature__r: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues.every((i) => i.check_id === 'BN-004')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // BN-005: Bundle Options Without Feature Grouping
  // ═══════════════════════════════════════════════
  describe('BN-005: Bundle Options Without Feature Grouping', () => {
    const check = getCheck('BN-005');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when bundle has fewer than 5 options', async () => {
      const data = createCleanData();
      // Clean data has p1 with 1 option — well under threshold
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when bundle has 5+ options all grouped into features', async () => {
      const data = createCleanData();
      data.productOptions = Array.from({ length: 6 }, (_, i) => ({
        Id: `po_${i}`, Name: `Opt ${i}`, SBQQ__ConfiguredSKU__c: 'p1',
        SBQQ__OptionalSKU__c: `child_${i}`,
        SBQQ__ConfiguredSKU__r: { Name: 'Product A', IsActive: true },
        SBQQ__OptionalSKU__r: { Name: `Child ${i}`, IsActive: true },
        SBQQ__Required__c: false, SBQQ__MinQuantity__c: 1, SBQQ__MaxQuantity__c: 10,
        SBQQ__Number__c: i + 1, SBQQ__Feature__c: 'feat1', SBQQ__Feature__r: { Name: 'Feature 1' },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when some options are ungrouped but not all', async () => {
      const data = createCleanData();
      data.productOptions = Array.from({ length: 6 }, (_, i) => ({
        Id: `po_${i}`, Name: `Opt ${i}`, SBQQ__ConfiguredSKU__c: 'p1',
        SBQQ__OptionalSKU__c: `child_${i}`,
        SBQQ__ConfiguredSKU__r: { Name: 'Product A', IsActive: true },
        SBQQ__OptionalSKU__r: { Name: `Child ${i}`, IsActive: true },
        SBQQ__Required__c: false, SBQQ__MinQuantity__c: 1, SBQQ__MaxQuantity__c: 10,
        SBQQ__Number__c: i + 1,
        SBQQ__Feature__c: i === 0 ? 'feat1' : null,
        SBQQ__Feature__r: i === 0 ? { Name: 'Feature 1' } : null,
      }));
      const issues = await check.run(data);
      // Not ALL ungrouped, so should not trigger
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag bundle with 5+ options and none grouped', async () => {
      const data = createCleanData();
      data.productOptions = Array.from({ length: 6 }, (_, i) => ({
        Id: `po_${i}`, Name: `Opt ${i}`, SBQQ__ConfiguredSKU__c: 'p1',
        SBQQ__OptionalSKU__c: `child_${i}`,
        SBQQ__ConfiguredSKU__r: { Name: 'Product A', IsActive: true },
        SBQQ__OptionalSKU__r: { Name: `Child ${i}`, IsActive: true },
        SBQQ__Required__c: false, SBQQ__MinQuantity__c: 1, SBQQ__MaxQuantity__c: 10,
        SBQQ__Number__c: i + 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('BN-005');
      expect(issues[0].severity).toBe('info');
      expect(issues[0].description).toContain('6 product options');
    });

    it('DETECT: should flag exactly at threshold (5 ungrouped options)', async () => {
      const data = createCleanData();
      data.productOptions = Array.from({ length: 5 }, (_, i) => ({
        Id: `po_${i}`, Name: `Opt ${i}`, SBQQ__ConfiguredSKU__c: 'p1',
        SBQQ__OptionalSKU__c: `child_${i}`,
        SBQQ__ConfiguredSKU__r: { Name: 'Product A', IsActive: true },
        SBQQ__OptionalSKU__r: { Name: `Child ${i}`, IsActive: true },
        SBQQ__Required__c: false, SBQQ__MinQuantity__c: 1, SBQQ__MaxQuantity__c: 10,
        SBQQ__Number__c: i + 1, SBQQ__Feature__c: null, SBQQ__Feature__r: null,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('BN-005');
    });
  });
});
