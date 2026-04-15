import { describe, it, expect } from 'vitest';
import { taxRuleChecks } from '@/lib/analysis/billing-checks/tax-rules';
import { createCleanBillingData } from './billing-fixtures';

const getCheck = (id: string) => taxRuleChecks.find((c) => c.id === id)!;

describe('Tax Rules — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // TR-001: Active Products Without Tax Rule
  // ═══════════════════════════════════════════════
  describe('TR-001: Active Products Without Tax Rule', () => {
    const check = getCheck('TR-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all active products have a tax rule', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive products lack tax rules', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'Inactive No Tax', IsActive: false, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty product configs', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active product with null tax rule', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'No Tax Product', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: null, SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('pbc1');
    });

    it('should flag multiple active products missing tax rules', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'No Tax 1', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: null, SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
        { Id: 'pbc2', Name: 'No Tax 2', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
        { Id: 'pbc3', Name: 'Has Tax', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].description).toContain('2');
    });

    it('should only flag active products, not inactive ones', async () => {
      const data = createCleanBillingData();
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'Active No Tax', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: null, SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
        { Id: 'pbc2', Name: 'Inactive No Tax', IsActive: false, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('pbc1');
    });
  });

  // ═══════════════════════════════════════════════
  // TR-002: Inactive Tax Rules Referenced by Products
  // ═══════════════════════════════════════════════
  describe('TR-002: Inactive Tax Rules Referenced by Products', () => {
    const check = getCheck('TR-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all referenced tax rules are active', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive tax rules are not referenced by active products', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr1', Name: 'Active Rule', blng__Active__c: true, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 10, blng__TaxIntegration__c: null },
        { Id: 'tr-dead', Name: 'Inactive Orphan', blng__Active__c: false, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 5, blng__TaxIntegration__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive tax rules are only referenced by inactive products', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr-inactive', Name: 'Inactive Rule', blng__Active__c: false, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 10, blng__TaxIntegration__c: null },
      ];
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'Inactive Product', IsActive: false, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr-inactive', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty tax rules and products', async () => {
      const data = createCleanBillingData();
      data.taxRules = [];
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when active product has null tax rule reference', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr-inactive', Name: 'Inactive Rule', blng__Active__c: false, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 10, blng__TaxIntegration__c: null },
      ];
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'No Tax Ref', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active product referencing an inactive tax rule', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr-dead', Name: 'Deactivated Tax', blng__Active__c: false, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 10, blng__TaxIntegration__c: null },
      ];
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'Active Product', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr-dead', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('pbc1');
    });

    it('should flag multiple active products referencing inactive tax rules', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr-dead1', Name: 'Dead Tax 1', blng__Active__c: false, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 5, blng__TaxIntegration__c: null },
        { Id: 'tr-dead2', Name: 'Dead Tax 2', blng__Active__c: false, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 8, blng__TaxIntegration__c: null },
      ];
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'Product X', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr-dead1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
        { Id: 'pbc2', Name: 'Product Y', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr-dead2', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
        { Id: 'pbc3', Name: 'Product Z', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr-dead1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(3);
      expect(issues[0].description).toContain('3');
    });
  });

  // ═══════════════════════════════════════════════
  // TR-003: Tax Rules With Zero Percent Tax
  // ═══════════════════════════════════════════════
  describe('TR-003: Tax Rules With Zero Percent Tax and No Integration', () => {
    const check = getCheck('TR-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when active rules have non-zero tax percentage', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive rule has zero tax and no integration', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr1', Name: 'Inactive Zero Tax', blng__Active__c: false, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 0, blng__TaxIntegration__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when active rule has zero tax BUT has tax integration', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr1', Name: 'Avalara Integrated', blng__Active__c: true, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 0, blng__TaxIntegration__c: 'Avalara' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when active rule has null tax percentage BUT has integration', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr1', Name: 'Vertex Integrated', blng__Active__c: true, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: null, blng__TaxIntegration__c: 'Vertex' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty tax rules', async () => {
      const data = createCleanBillingData();
      data.taxRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when active rule has positive tax percentage and no integration', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr1', Name: 'Has Tax', blng__Active__c: true, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 8.5, blng__TaxIntegration__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active rule with 0 tax percentage and no integration', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr1', Name: 'Zero Tax', blng__Active__c: true, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 0, blng__TaxIntegration__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('tr1');
    });

    it('should flag active rule with null tax percentage and no integration', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr1', Name: 'Null Tax', blng__Active__c: true, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: null, blng__TaxIntegration__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
    });

    it('should flag multiple active rules with zero/null tax and no integration', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr1', Name: 'Zero Tax', blng__Active__c: true, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 0, blng__TaxIntegration__c: null },
        { Id: 'tr2', Name: 'Null Tax', blng__Active__c: true, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: null, blng__TaxIntegration__c: null },
        { Id: 'tr3', Name: 'Good Tax', blng__Active__c: true, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 15, blng__TaxIntegration__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      const ids = issues[0].affected_records!.map(r => r.id);
      expect(ids).toContain('tr1');
      expect(ids).toContain('tr2');
    });

    it('should not flag rule with zero tax when integration is set', async () => {
      const data = createCleanBillingData();
      data.taxRules = [
        { Id: 'tr1', Name: 'Integrated Zero', blng__Active__c: true, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 0, blng__TaxIntegration__c: 'Avalara' },
        { Id: 'tr2', Name: 'No Integration Zero', blng__Active__c: true, blng__TaxableYN__c: 'Yes', blng__TaxPercentage__c: 0, blng__TaxIntegration__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('tr2');
    });
  });
});
