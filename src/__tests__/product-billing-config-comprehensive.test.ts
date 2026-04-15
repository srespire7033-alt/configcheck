import { describe, it, expect } from 'vitest';
import { productBillingConfigChecks } from '@/lib/analysis/billing-checks/product-billing-config';
import { createCleanBillingData } from './billing-fixtures';

const getCheck = (id: string) => productBillingConfigChecks.find((c) => c.id === id)!;

describe('Product Billing Config — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // PBC-001: Product Missing Billing Rule
  // ═══════════════════════════════════════════════
  describe('PBC-001: Product Missing Billing Rule', () => {
    const check = getCheck('PBC-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all active products have billing rules', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty productBillingConfigs array', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive product has no billing rule', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Inactive Prod', IsActive: false, blng__BillingRule__c: null, blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag active product with no billing rule', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Missing BR', IsActive: true, blng__BillingRule__c: null, blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PBC-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('p1');
    });

    it('DETECT: should flag multiple active products missing billing rules', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Prod A', IsActive: true, blng__BillingRule__c: null, blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'Prod B', IsActive: true, blng__BillingRule__c: null, blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
        { Id: 'p3', Name: 'Prod C', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].description).toContain('2');
    });

    it('DETECT: should calculate revenue_impact based on count', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Prod', IsActive: true, blng__BillingRule__c: null, blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues[0].revenue_impact).toBe(5000);
    });

    it('should only flag active products, not inactive ones in a mixed list', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Active No BR', IsActive: true, blng__BillingRule__c: null, blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'Inactive No BR', IsActive: false, blng__BillingRule__c: null, blng__RevenueRecognitionRule__c: null, blng__TaxRule__c: null, SBQQ__ChargeType__c: null, SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('p1');
    });
  });

  // ═══════════════════════════════════════════════
  // PBC-002: Product Missing Revenue Recognition Rule
  // ═══════════════════════════════════════════════
  describe('PBC-002: Product Missing Revenue Recognition Rule', () => {
    const check = getCheck('PBC-002');

    it('should pass when all active products have rev rec rules', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty productBillingConfigs array', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive product has no rev rec rule', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Inactive', IsActive: false, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: null, blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('DETECT: should flag active product with no rev rec rule', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'No RevRec', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: null, blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PBC-002');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(1);
    });

    it('DETECT: should calculate revenue_impact at 10000 per product', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'A', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: null, blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'B', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: null, blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues[0].revenue_impact).toBe(20000);
    });
  });

  // ═══════════════════════════════════════════════
  // PBC-003: Product Missing Tax Rule
  // ═══════════════════════════════════════════════
  describe('PBC-003: Product Missing Tax Rule', () => {
    const check = getCheck('PBC-003');

    it('should pass when all active products have tax rules', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty productBillingConfigs array', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive product has no tax rule', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Inactive', IsActive: false, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('DETECT: should flag active product with no tax rule', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'No Tax', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PBC-003');
      expect(issues[0].severity).toBe('critical');
    });

    it('DETECT: should flag multiple products and include count in description', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'A', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'B', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: null, SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
        { Id: 'p3', Name: 'C', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].description).toContain('2');
    });
  });

  // ═══════════════════════════════════════════════
  // PBC-004: Product Missing Charge Type
  // ═══════════════════════════════════════════════
  describe('PBC-004: Product Missing Charge Type', () => {
    const check = getCheck('PBC-004');

    it('should pass when all active products have a charge type', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty productBillingConfigs array', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive product has no charge type', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Inactive', IsActive: false, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: null, SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('DETECT: should flag active product with no charge type', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'No Charge Type', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: null, SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PBC-004');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(1);
    });

    it('should not flag products with valid charge types (One-Time, Recurring, Usage)', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'One-Time', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'Recurring', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
        { Id: 'p3', Name: 'Usage', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Usage', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  // PBC-005: Billing Type Mismatch With Frequency
  // ═══════════════════════════════════════════════
  describe('PBC-005: Recurring Products Without Billing Frequency', () => {
    const check = getCheck('PBC-005');

    it('should pass when recurring products have billing frequency', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty productBillingConfigs array', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when one-time product has no billing frequency', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'One-Time', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when usage product has no billing frequency', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Usage', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Usage', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive recurring product has no billing frequency', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Inactive Recurring', IsActive: false, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('DETECT: should flag active recurring product without billing frequency', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Recurring No Freq', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PBC-005');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
    });

    it('DETECT: should only flag recurring products, not one-time alongside them', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Recurring No Freq', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: null },
        { Id: 'p2', Name: 'One-Time OK', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('p1');
    });
  });

  // ═══════════════════════════════════════════════
  // PBC-006: Products Referencing Inactive Rules
  // ═══════════════════════════════════════════════
  describe('PBC-006: Products Referencing Inactive Rules', () => {
    const check = getCheck('PBC-006');

    it('should pass when no relationship data is present (undefined)', async () => {
      const data = createCleanBillingData();
      // Default clean data has no __r fields
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty productBillingConfigs array', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when all referenced rules are active', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        {
          Id: 'p1', Name: 'Prod A', IsActive: true,
          blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1',
          SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null,
          blng__BillingRule__r: { Name: 'BR', blng__Active__c: true },
          blng__RevenueRecognitionRule__r: { Name: 'RR', blng__Active__c: true },
          blng__TaxRule__r: { Name: 'TR', blng__Active__c: true },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive product references inactive rules', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        {
          Id: 'p1', Name: 'Inactive Prod', IsActive: false,
          blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1',
          SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null,
          blng__BillingRule__r: { Name: 'BR', blng__Active__c: false },
          blng__RevenueRecognitionRule__r: { Name: 'RR', blng__Active__c: false },
          blng__TaxRule__r: { Name: 'TR', blng__Active__c: false },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('DETECT: should flag active product with inactive billing rule', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        {
          Id: 'p1', Name: 'Bad BR', IsActive: true,
          blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1',
          SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null,
          blng__BillingRule__r: { Name: 'Inactive BR', blng__Active__c: false },
          blng__RevenueRecognitionRule__r: { Name: 'RR', blng__Active__c: true },
          blng__TaxRule__r: { Name: 'TR', blng__Active__c: true },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PBC-006');
      expect(issues[0].severity).toBe('warning');
    });

    it('DETECT: should flag active product with inactive rev rec rule', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        {
          Id: 'p1', Name: 'Bad RR', IsActive: true,
          blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1',
          SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null,
          blng__BillingRule__r: { Name: 'BR', blng__Active__c: true },
          blng__RevenueRecognitionRule__r: { Name: 'Inactive RR', blng__Active__c: false },
          blng__TaxRule__r: { Name: 'TR', blng__Active__c: true },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PBC-006');
    });

    it('DETECT: should flag active product with inactive tax rule', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        {
          Id: 'p1', Name: 'Bad TR', IsActive: true,
          blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1',
          SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null,
          blng__BillingRule__r: { Name: 'BR', blng__Active__c: true },
          blng__RevenueRecognitionRule__r: { Name: 'RR', blng__Active__c: true },
          blng__TaxRule__r: { Name: 'Inactive TR', blng__Active__c: false },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PBC-006');
    });

    it('DETECT: should flag product with all three rules inactive (single issue)', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        {
          Id: 'p1', Name: 'All Inactive', IsActive: true,
          blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1',
          SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null,
          blng__BillingRule__r: { Name: 'BR', blng__Active__c: false },
          blng__RevenueRecognitionRule__r: { Name: 'RR', blng__Active__c: false },
          blng__TaxRule__r: { Name: 'TR', blng__Active__c: false },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
    });

    it('DETECT: should count multiple affected products correctly', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        {
          Id: 'p1', Name: 'Bad 1', IsActive: true,
          blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1',
          SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null,
          blng__BillingRule__r: { Name: 'BR', blng__Active__c: false },
        },
        {
          Id: 'p2', Name: 'Bad 2', IsActive: true,
          blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1',
          SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly',
          blng__TaxRule__r: { Name: 'TR', blng__Active__c: false },
        },
        {
          Id: 'p3', Name: 'Good', IsActive: true,
          blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1',
          SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null,
          blng__BillingRule__r: { Name: 'BR', blng__Active__c: true },
          blng__RevenueRecognitionRule__r: { Name: 'RR', blng__Active__c: true },
          blng__TaxRule__r: { Name: 'TR', blng__Active__c: true },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].description).toContain('2');
    });
  });
});
