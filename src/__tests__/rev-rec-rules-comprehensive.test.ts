import { describe, it, expect } from 'vitest';
import { revRecRuleChecks } from '@/lib/analysis/billing-checks/rev-rec-rules';
import { createCleanBillingData } from './billing-fixtures';

const getCheck = (id: string) => revRecRuleChecks.find((c) => c.id === id)!;

describe('Rev Rec Rules — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // RR-001: Inactive Rev Rec Rules Referenced by Products
  // ═══════════════════════════════════════════════
  describe('RR-001: Inactive Rev Rec Rules Referenced by Products', () => {
    const check = getCheck('RR-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all referenced rev rec rules are active', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive rules exist but are not referenced by any active product', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'Active Rule', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'Yes' },
        { Id: 'rr-inactive', Name: 'Inactive Orphan', blng__Active__c: false, blng__CreateRevenueSchedule__c: 'Yes' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive rule is referenced only by inactive products', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr-inactive', Name: 'Inactive Rule', blng__Active__c: false, blng__CreateRevenueSchedule__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'Inactive Product', IsActive: false, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr-inactive', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty rev rec rules and product configs', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [];
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when product has null rev rec rule reference', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr-inactive', Name: 'Inactive Rule', blng__Active__c: false, blng__CreateRevenueSchedule__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'No Rev Rec Ref', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: null, blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active product referencing an inactive rev rec rule', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr-inactive', Name: 'Deactivated Rule', blng__Active__c: false, blng__CreateRevenueSchedule__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'Active Product', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr-inactive', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('pbc1');
    });

    it('should flag multiple active products referencing inactive rules', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr-dead1', Name: 'Dead Rule 1', blng__Active__c: false, blng__CreateRevenueSchedule__c: 'Yes' },
        { Id: 'rr-dead2', Name: 'Dead Rule 2', blng__Active__c: false, blng__CreateRevenueSchedule__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'Product X', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr-dead1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
        { Id: 'pbc2', Name: 'Product Y', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr-dead2', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
        { Id: 'pbc3', Name: 'Product Z', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr-dead1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(3);
      expect(issues[0].description).toContain('3');
    });
  });

  // ═══════════════════════════════════════════════
  // RR-002: Rev Rec Rules Without Schedule Creation Config
  // ═══════════════════════════════════════════════
  describe('RR-002: Rev Rec Rules Without Schedule Creation Config', () => {
    const check = getCheck('RR-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all active rules have schedule creation configured', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive rules lack config', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'Inactive No Config', blng__Active__c: false, blng__CreateRevenueSchedule__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty rev rec rules', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active rule with null schedule creation', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'Missing Config', blng__Active__c: true, blng__CreateRevenueSchedule__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('rr1');
    });

    it('should flag multiple active rules missing config', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'No Config 1', blng__Active__c: true, blng__CreateRevenueSchedule__c: null },
        { Id: 'rr2', Name: 'No Config 2', blng__Active__c: true, blng__CreateRevenueSchedule__c: null },
        { Id: 'rr3', Name: 'Has Config', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'Yes' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should only flag active rules, not inactive ones', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'Active No Config', blng__Active__c: true, blng__CreateRevenueSchedule__c: null },
        { Id: 'rr2', Name: 'Inactive No Config', blng__Active__c: false, blng__CreateRevenueSchedule__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('rr1');
    });
  });

  // ═══════════════════════════════════════════════
  // RR-003: Rev Rec Rules Not Creating Schedules
  // ═══════════════════════════════════════════════
  describe('RR-003: Rev Rec Rules Not Creating Schedules', () => {
    const check = getCheck('RR-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all active rules create schedules', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive rules have schedule creation disabled', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'Inactive No Create', blng__Active__c: false, blng__CreateRevenueSchedule__c: 'No' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when active rule has null CreateRevenueSchedule (not "No")', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'Null Create', blng__Active__c: true, blng__CreateRevenueSchedule__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty rev rec rules', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should NOT flag active rule with "Yes" value', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'Yes Create', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'Yes' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active rule with CreateRevenueSchedule set to "No"', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'No Create', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'No' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('rr1');
    });

    it('should flag multiple active rules with schedule creation disabled', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'No Create 1', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'No' },
        { Id: 'rr2', Name: 'No Create 2', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'No' },
        { Id: 'rr3', Name: 'Yes Create', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'Yes' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should use exact string match for "No" (case-sensitive)', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'Lowercase no', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'no' },
      ];
      const issues = await check.run(data);
      // Exact match on 'No' means lowercase 'no' should NOT trigger
      expect(issues).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  // RR-004: Orphaned Revenue Recognition Rules
  // ═══════════════════════════════════════════════
  describe('RR-004: Orphaned Revenue Recognition Rules', () => {
    const check = getCheck('RR-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all rules are referenced by at least one product', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty rules and products', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [];
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag rules not referenced by any product', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'Used Rule', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'Yes' },
        { Id: 'rr-orphan', Name: 'Orphaned Rule', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'Product A', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('rr-orphan');
    });

    it('should flag all rules when no products exist', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'Rule A', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'Yes' },
        { Id: 'rr2', Name: 'Rule B', blng__Active__c: false, blng__CreateRevenueSchedule__c: 'No' },
      ];
      data.productBillingConfigs = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should not count null rev rec references as usage', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr1', Name: 'Unused Rule', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'No Rev Rec', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: null, blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('rr1');
    });

    it('should include both active and inactive orphaned rules', async () => {
      const data = createCleanBillingData();
      data.revRecRules = [
        { Id: 'rr-active', Name: 'Active Orphan', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'Yes' },
        { Id: 'rr-inactive', Name: 'Inactive Orphan', blng__Active__c: false, blng__CreateRevenueSchedule__c: 'Yes' },
        { Id: 'rr-used', Name: 'Used Rule', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'Yes' },
      ];
      data.productBillingConfigs = [
        { Id: 'pbc1', Name: 'Product A', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr-used', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      const ids = issues[0].affected_records!.map(r => r.id);
      expect(ids).toContain('rr-active');
      expect(ids).toContain('rr-inactive');
    });
  });
});
