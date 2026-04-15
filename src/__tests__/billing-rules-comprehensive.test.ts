import { describe, it, expect } from 'vitest';
import { billingRuleChecks } from '@/lib/analysis/billing-checks/billing-rules';
import { createCleanBillingData } from './billing-fixtures';

const getCheck = (id: string) => billingRuleChecks.find((c) => c.id === id)!;

describe('Billing Rules — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // BR-001: Inactive Billing Rules Referenced by Products
  // ═══════════════════════════════════════════════
  describe('BR-001: Inactive Billing Rules Referenced by Products', () => {
    const check = getCheck('BR-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all billing rules are active', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Monthly Billing', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Product A', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when product references an active billing rule', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Active Rule', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br2', Name: 'Inactive Rule', blng__Active__c: false, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Product A', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive products referencing inactive rules', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Inactive Rule', blng__Active__c: false, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Inactive Product', IsActive: false, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty arrays', async () => {
      const data = createCleanBillingData();
      data.billingRules = [];
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active product referencing an inactive billing rule', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Deactivated Rule', blng__Active__c: false, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Active Product', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('p1');
    });

    it('should flag multiple products referencing the same inactive rule', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Deactivated Rule', blng__Active__c: false, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Product A', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
        { Id: 'p2', Name: 'Product B', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: 'Arrears', SBQQ__BillingFrequency__c: 'Quarterly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].description).toContain('2');
    });
  });

  // ═══════════════════════════════════════════════
  // BR-002: Billing Rules Without GL Treatment
  // ═══════════════════════════════════════════════
  describe('BR-002: Billing Rules Without GL Treatment', () => {
    const check = getCheck('BR-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when active rule has a GL treatment mapped', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Monthly Billing', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.glTreatments = [
        { Id: 'gt1', Name: 'Revenue Treatment', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: 'acc2', blng__GLRule__c: 'br1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive rules without GL treatment', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Inactive Rule', blng__Active__c: false, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.glTreatments = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty billing rules', async () => {
      const data = createCleanBillingData();
      data.billingRules = [];
      data.glTreatments = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active rule with no GL treatment mapped', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Unmapped Rule', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.glTreatments = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('br1');
    });

    it('should flag multiple active rules without GL treatments', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Rule A', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br2', Name: 'Rule B', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br3', Name: 'Rule C', blng__Active__c: false, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.glTreatments = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].description).toContain('2');
    });

    it('should only flag rules not in the GL treatment set', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Mapped Rule', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br2', Name: 'Unmapped Rule', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.glTreatments = [
        { Id: 'gt1', Name: 'Treatment A', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: 'acc2', blng__GLRule__c: 'br1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('br2');
    });
  });

  // ═══════════════════════════════════════════════
  // BR-003: Orphaned Billing Rules
  // ═══════════════════════════════════════════════
  describe('BR-003: Orphaned Billing Rules', () => {
    const check = getCheck('BR-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when rule is referenced by a product', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Monthly Billing', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Product A', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty arrays', async () => {
      const data = createCleanBillingData();
      data.billingRules = [];
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag a rule not referenced by any product', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Orphaned Rule', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('br1');
    });

    it('should flag multiple orphaned rules', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Orphan A', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br2', Name: 'Orphan B', blng__Active__c: false, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br3', Name: 'Used Rule', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Product A', IsActive: true, blng__BillingRule__c: 'br3', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].description).toContain('2');
    });

    it('should not flag rules referenced by inactive products', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Referenced Rule', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br2', Name: 'Truly Orphaned', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'p1', Name: 'Inactive Product', IsActive: false, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      // BR-003 does NOT filter by product active status — it checks all productBillingConfigs
      // So br1 IS referenced (even by inactive product), only br2 is orphaned
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('br2');
    });
  });

  // ═══════════════════════════════════════════════
  // BR-004: Duplicate Billing Rule Names
  // ═══════════════════════════════════════════════
  describe('BR-004: Duplicate Billing Rule Names', () => {
    const check = getCheck('BR-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all rule names are unique', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Monthly Billing', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br2', Name: 'Annual Billing', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br3', Name: 'Usage Billing', blng__Active__c: false, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty billing rules', async () => {
      const data = createCleanBillingData();
      data.billingRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with a single billing rule', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Only Rule', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag 2 rules with the same name', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Monthly Billing', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br2', Name: 'Monthly Billing', blng__Active__c: false, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].description).toContain('1');
    });

    it('should flag 3 rules with the same name', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Standard Billing', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br2', Name: 'Standard Billing', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br3', Name: 'Standard Billing', blng__Active__c: false, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(3);
      expect(issues[0].description).toContain('1');
    });

    it('should flag multiple groups of duplicates', async () => {
      const data = createCleanBillingData();
      data.billingRules = [
        { Id: 'br1', Name: 'Monthly Billing', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br2', Name: 'Monthly Billing', blng__Active__c: false, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br3', Name: 'Annual Billing', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br4', Name: 'Annual Billing', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
        { Id: 'br5', Name: 'Unique Rule', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(4);
      expect(issues[0].description).toContain('2');
    });
  });
});
