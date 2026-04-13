import { describe, it, expect } from 'vitest';
import { cpqSettingsChecks } from '@/lib/analysis/checks/cpq-settings';
import { createCleanData } from './fixtures';

// Helper to get a specific check
const getCheck = (id: string) => cpqSettingsChecks.find((c) => c.id === id)!;

describe('CPQ Settings — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // SET-001: CPQ Triggers Disabled
  // ═══════════════════════════════════════════════
  describe('SET-001: CPQ Triggers Disabled', () => {
    const check = getCheck('SET-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when TriggerDisabled is false', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__TriggerDisabled__c: false };
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when cpqSettings is null', async () => {
      const data = createCleanData();
      data.cpqSettings = null as unknown as typeof data.cpqSettings;
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when TriggerDisabled is undefined', async () => {
      const data = createCleanData();
      const settings = { ...data.cpqSettings } as Record<string, unknown>;
      delete settings.SBQQ__TriggerDisabled__c;
      data.cpqSettings = settings as typeof data.cpqSettings;
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with clean data defaults', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag when TriggerDisabled is true', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__TriggerDisabled__c: true };
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('SET-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].title).toContain('DISABLED');
    });

    it('should include re-enable recommendation', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__TriggerDisabled__c: true };
      const issues = await check.run(data);
      expect(issues[0].recommendation).toContain('Re-enable');
    });
  });

  // ═══════════════════════════════════════════════
  // SET-002: Quote Calculator Plugin Detected
  // ═══════════════════════════════════════════════
  describe('SET-002: Quote Calculator Plugin Detected', () => {
    const check = getCheck('SET-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when hasQuoteCalculatorPlugin is false', async () => {
      const data = createCleanData();
      (data.cpqSettings as Record<string, unknown>).hasQuoteCalculatorPlugin = false;
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when hasQuoteCalculatorPlugin is missing', async () => {
      const data = createCleanData();
      // clean data does not have hasQuoteCalculatorPlugin by default
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when cpqSettings is null', async () => {
      const data = createCleanData();
      data.cpqSettings = null as unknown as typeof data.cpqSettings;
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag when hasQuoteCalculatorPlugin is true', async () => {
      const data = createCleanData();
      (data.cpqSettings as Record<string, unknown>).hasQuoteCalculatorPlugin = true;
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('SET-002');
      expect(issues[0].severity).toBe('info');
      expect(issues[0].title).toContain('Quote Calculator Plugin');
    });

    it('should mention QCP in the description', async () => {
      const data = createCleanData();
      (data.cpqSettings as Record<string, unknown>).hasQuoteCalculatorPlugin = true;
      const issues = await check.run(data);
      expect(issues[0].description).toContain('QCP');
    });
  });

  // ═══════════════════════════════════════════════
  // SET-003: Renewal Model Not Configured
  // ═══════════════════════════════════════════════
  describe('SET-003: Renewal Model Not Configured', () => {
    const check = getCheck('SET-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when RenewalModel is set to Same Products', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__RenewalModel__c: 'Same Products' };
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when RenewalModel is set to Contract Based', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__RenewalModel__c: 'Contract Based' };
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with clean data defaults', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag when RenewalModel is null', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__RenewalModel__c: null as unknown as string };
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('SET-003');
      expect(issues[0].severity).toBe('warning');
    });

    it('should flag when RenewalModel is empty string', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__RenewalModel__c: '' };
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('SET-003');
    });

    it('should flag when RenewalModel is undefined', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__RenewalModel__c: undefined as unknown as string };
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });

    it('should include recommendation about renewal model options', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__RenewalModel__c: '' };
      const issues = await check.run(data);
      expect(issues[0].recommendation).toContain('Renewal Model');
    });
  });

  // ═══════════════════════════════════════════════
  // SET-004: Subscription Term Unit Not Set
  // ═══════════════════════════════════════════════
  describe('SET-004: Subscription Term Unit Not Set', () => {
    const check = getCheck('SET-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when SubscriptionTermUnit is Month', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__SubscriptionTermUnit__c: 'Month' };
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when SubscriptionTermUnit is Day', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__SubscriptionTermUnit__c: 'Day' };
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with clean data defaults', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag when SubscriptionTermUnit is null', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__SubscriptionTermUnit__c: null as unknown as string };
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('SET-004');
      expect(issues[0].severity).toBe('info');
    });

    it('should flag when SubscriptionTermUnit is empty string', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__SubscriptionTermUnit__c: '' };
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('SET-004');
    });

    it('should flag when SubscriptionTermUnit is undefined', async () => {
      const data = createCleanData();
      data.cpqSettings = { ...data.cpqSettings, SBQQ__SubscriptionTermUnit__c: undefined as unknown as string };
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });
  });
});
