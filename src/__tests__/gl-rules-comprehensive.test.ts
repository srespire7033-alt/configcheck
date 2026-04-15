import { describe, it, expect } from 'vitest';
import { glRuleChecks } from '@/lib/analysis/billing-checks/gl-rules';
import { createCleanBillingData } from './billing-fixtures';

const getCheck = (id: string) => glRuleChecks.find((c) => c.id === id)!;

describe('GL Rules — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // GL-001: GL Treatment Missing GL Account
  // ═══════════════════════════════════════════════
  describe('GL-001: GL Treatment Missing GL Account', () => {
    const check = getCheck('GL-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with clean data defaults', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when both credit and debit accounts are set', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: 'acc2', blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when treatment is inactive even if both accounts null', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: false, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty glTreatments array', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when only credit is null (one-sided, not both null)', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: true, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: 'acc2', blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when only debit is null (one-sided, not both null)', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active treatment with both accounts null', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'Bad Treatment', blng__Active__c: true, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].check_id).toBe('GL-001');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('glt1');
    });

    it('should flag multiple active treatments with both accounts null', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'Bad 1', blng__Active__c: true, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
        { Id: 'glt2', Name: 'Bad 2', blng__Active__c: true, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
        { Id: 'glt3', Name: 'Good', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: 'acc2', blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should include correct description count in issue', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: true, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
        { Id: 'glt2', Name: 'T2', blng__Active__c: true, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues[0].description).toContain('2');
    });
  });

  // ═══════════════════════════════════════════════
  // GL-002: GL Rule Without Treatments
  // ═══════════════════════════════════════════════
  describe('GL-002: GL Rule Without Treatments', () => {
    const check = getCheck('GL-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with clean data defaults', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when active rule has treatments via subquery totalSize', async () => {
      const data = createCleanBillingData();
      data.glRules = [
        { Id: 'glr1', Name: 'Rule 1', blng__Active__c: true, blng__GLTreatments__r: { totalSize: 3, records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive rule has no treatments', async () => {
      const data = createCleanBillingData();
      data.glRules = [
        { Id: 'glr1', Name: 'Inactive Rule', blng__Active__c: false, blng__GLTreatments__r: { totalSize: 0, records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive rule has no subquery relationship at all', async () => {
      const data = createCleanBillingData();
      data.glRules = [
        { Id: 'glr1', Name: 'Inactive Rule', blng__Active__c: false },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty glRules array', async () => {
      const data = createCleanBillingData();
      data.glRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active rule with totalSize 0', async () => {
      const data = createCleanBillingData();
      data.glRules = [
        { Id: 'glr1', Name: 'Empty Rule', blng__Active__c: true, blng__GLTreatments__r: { totalSize: 0, records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].check_id).toBe('GL-002');
      expect(issues[0].affected_records[0].id).toBe('glr1');
    });

    it('should flag active rule with missing subquery relationship (undefined)', async () => {
      const data = createCleanBillingData();
      data.glRules = [
        { Id: 'glr1', Name: 'No Treatments', blng__Active__c: true },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
    });

    it('should flag multiple active rules without treatments', async () => {
      const data = createCleanBillingData();
      data.glRules = [
        { Id: 'glr1', Name: 'Empty 1', blng__Active__c: true, blng__GLTreatments__r: { totalSize: 0, records: [] } },
        { Id: 'glr2', Name: 'Empty 2', blng__Active__c: true },
        { Id: 'glr3', Name: 'Has Treatments', blng__Active__c: true, blng__GLTreatments__r: { totalSize: 2, records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should use subquery totalSize and NOT the separate glTreatments array', async () => {
      const data = createCleanBillingData();
      // Rule has totalSize 0 even though the separate glTreatments array has entries for it
      data.glRules = [
        { Id: 'glr1', Name: 'Rule', blng__Active__c: true, blng__GLTreatments__r: { totalSize: 0, records: [] } },
      ];
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: 'acc2', blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      // Should still flag because totalSize is 0, regardless of glTreatments array
      expect(issues).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════
  // GL-003: Inactive GL Treatments on Active Rules
  // ═══════════════════════════════════════════════
  describe('GL-003: Inactive GL Treatments on Active Rules', () => {
    const check = getCheck('GL-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with clean data defaults', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when all treatments are active', async () => {
      const data = createCleanBillingData();
      data.glRules = [
        { Id: 'glr1', Name: 'Rule 1', blng__Active__c: true },
      ];
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: true, blng__CreditGLAccount__c: 'a', blng__DebitGLAccount__c: 'b', blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive treatment is on an inactive rule', async () => {
      const data = createCleanBillingData();
      data.glRules = [
        { Id: 'glr1', Name: 'Inactive Rule', blng__Active__c: false },
      ];
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: false, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive treatment has no GLRule__c (orphan)', async () => {
      const data = createCleanBillingData();
      data.glRules = [
        { Id: 'glr1', Name: 'Active Rule', blng__Active__c: true },
      ];
      data.glTreatments = [
        { Id: 'glt1', Name: 'Orphan', blng__Active__c: false, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: null, blng__GLRule__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty arrays', async () => {
      const data = createCleanBillingData();
      data.glRules = [];
      data.glTreatments = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag inactive treatment under active rule', async () => {
      const data = createCleanBillingData();
      data.glRules = [
        { Id: 'glr1', Name: 'Active Rule', blng__Active__c: true },
      ];
      data.glTreatments = [
        { Id: 'glt1', Name: 'Inactive Treatment', blng__Active__c: false, blng__CreditGLAccount__c: 'a', blng__DebitGLAccount__c: 'b', blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].check_id).toBe('GL-003');
      expect(issues[0].affected_records[0].id).toBe('glt1');
    });

    it('should flag multiple inactive treatments across active rules', async () => {
      const data = createCleanBillingData();
      data.glRules = [
        { Id: 'glr1', Name: 'Rule A', blng__Active__c: true },
        { Id: 'glr2', Name: 'Rule B', blng__Active__c: true },
      ];
      data.glTreatments = [
        { Id: 'glt1', Name: 'IT1', blng__Active__c: false, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
        { Id: 'glt2', Name: 'IT2', blng__Active__c: false, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr2' },
        { Id: 'glt3', Name: 'Active', blng__Active__c: true, blng__CreditGLAccount__c: 'a', blng__DebitGLAccount__c: 'b', blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════
  // GL-004: GL Treatment Missing One Side
  // ═══════════════════════════════════════════════
  describe('GL-004: GL Treatment Missing One Side', () => {
    const check = getCheck('GL-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with clean data defaults', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when both accounts are set', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: 'acc2', blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when both accounts are null (caught by GL-001 instead)', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: true, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when treatment is inactive even with one side missing', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: false, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty glTreatments array', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active treatment with only credit set', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'Credit Only', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].check_id).toBe('GL-004');
      expect(issues[0].affected_records[0].id).toBe('glt1');
    });

    it('should flag active treatment with only debit set', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'Debit Only', blng__Active__c: true, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: 'acc2', blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('glt1');
    });

    it('should flag multiple one-sided treatments', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'Credit Only', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
        { Id: 'glt2', Name: 'Debit Only', blng__Active__c: true, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: 'acc2', blng__GLRule__c: 'glr1' },
        { Id: 'glt3', Name: 'Both Set', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: 'acc2', blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should include correct count in description', async () => {
      const data = createCleanBillingData();
      data.glTreatments = [
        { Id: 'glt1', Name: 'T1', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
        { Id: 'glt2', Name: 'T2', blng__Active__c: true, blng__CreditGLAccount__c: null, blng__DebitGLAccount__c: 'acc2', blng__GLRule__c: 'glr1' },
        { Id: 'glt3', Name: 'T3', blng__Active__c: true, blng__CreditGLAccount__c: 'acc1', blng__DebitGLAccount__c: null, blng__GLRule__c: 'glr1' },
      ];
      const issues = await check.run(data);
      expect(issues[0].description).toContain('3');
    });
  });
});
