import { describe, it, expect } from 'vitest';
import { priceRuleChecks } from '@/lib/analysis/checks/price-rules';
import { createCleanData } from './fixtures';

// Helper to get a specific check
const getCheck = (id: string) => priceRuleChecks.find((c) => c.id === id)!;

describe('Price Rules — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // PR-001: Conflicting Price Rules
  // ═══════════════════════════════════════════════
  describe('PR-001: Conflicting Price Rules', () => {
    const check = getCheck('PR-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when active rules have unique evaluation orders', async () => {
      const data = createCleanData();
      // Default fixture has orders 10 and 20 — no conflict
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when same order but different target fields', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Rule A', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [{ Id: 'pc1', SBQQ__Field__c: 'SBQQ__Quantity__c', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '1', SBQQ__Object__c: 'Quote Line' }] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr2', Name: 'Rule B', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [{ Id: 'pc2', SBQQ__Field__c: 'SBQQ__Quantity__c', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '1', SBQQ__Object__c: 'Quote Line' }] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa2', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '100', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive rules with same order and same field', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Inactive A', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [{ Id: 'pc1', SBQQ__Field__c: 'F', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '1', SBQQ__Object__c: 'Quote Line' }] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr2', Name: 'Inactive B', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [{ Id: 'pc2', SBQQ__Field__c: 'F', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '1', SBQQ__Object__c: 'Quote Line' }] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa2', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '15', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty price rules array', async () => {
      const data = createCleanData();
      data.priceRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag 2 active rules with same order and same target field', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Rule A', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [{ Id: 'pc1', SBQQ__Field__c: 'F', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '1', SBQQ__Object__c: 'Quote Line' }] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr2', Name: 'Rule B', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [{ Id: 'pc2', SBQQ__Field__c: 'F', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '1', SBQQ__Object__c: 'Quote Line' }] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa2', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '15', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PR-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should flag 3 active rules with same order and same target field', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Rule A', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 5, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr2', Name: 'Rule B', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 5, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa2', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '20', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr3', Name: 'Rule C', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 5, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa3', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '30', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(3);
    });

    it('should flag only the conflicting group when mixed orders exist', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Conflict A', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '5', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr2', Name: 'Conflict B', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa2', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr3', Name: 'Safe Rule', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 20, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa3', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '15', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('order (10)');
    });
  });

  // ═══════════════════════════════════════════════
  // PR-002: Dead Price Rules
  // ═══════════════════════════════════════════════
  describe('PR-002: Dead Price Rules', () => {
    const check = getCheck('PR-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when active rules have both conditions and actions', async () => {
      const data = createCleanData();
      // Default fixture rules have both
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive rules even with empty conditions/actions', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Inactive Empty', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty price rules array', async () => {
      const data = createCleanData();
      data.priceRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active rule with no conditions', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'No Conditions', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PR-002');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].description).toContain('conditions');
    });

    it('should flag active rule with no actions', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'No Actions', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [{ Id: 'pc1', SBQQ__Field__c: 'SBQQ__Quantity__c', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '1', SBQQ__Object__c: 'Quote Line' }] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('actions');
    });

    it('should flag active rule with null conditions and actions subrelations', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Null Subrels', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: null as any, SBQQ__PriceActions__r: null as any },
      ];
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThanOrEqual(1);
      expect(issues[0].check_id).toBe('PR-002');
    });

    it('should flag multiple dead rules independently', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Dead A', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'F', SBQQ__Value__c: '1', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr2', Name: 'Dead B', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 2, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [{ Id: 'pc1', SBQQ__Field__c: 'F', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '1', SBQQ__Object__c: 'Quote Line' }] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════
  // PR-003: Evaluation Order Gaps
  // ═══════════════════════════════════════════════
  describe('PR-003: Evaluation Order Gaps', () => {
    const check = getCheck('PR-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when evaluation orders are consecutive', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Rule 1', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
        { Id: 'pr2', Name: 'Rule 2', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 2, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
        { Id: 'pr3', Name: 'Rule 3', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 3, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with a single active rule', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Only Rule', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with fewer than 2 active rules', async () => {
      const data = createCleanData();
      data.priceRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should ignore inactive rules when checking for gaps', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Active', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
        { Id: 'pr2', Name: 'Active', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 2, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
        { Id: 'pr3', Name: 'Inactive Gap', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: 50, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag gaps in evaluation order (10, 30)', async () => {
      const data = createCleanData();
      // Default fixture has orders 10 and 20 — gap from 11-19
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PR-003');
      expect(issues[0].severity).toBe('info');
      expect(issues[0].description).toContain('gaps');
    });

    it('should flag large gap between orders (1, 100)', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'First', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
        { Id: 'pr2', Name: 'Last', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 100, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('1, 100');
    });
  });

  // ═══════════════════════════════════════════════
  // PR-004: Multiple Rules Targeting Same Field
  // ═══════════════════════════════════════════════
  describe('PR-004: Multiple Rules Targeting Same Field', () => {
    const check = getCheck('PR-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when only 2 rules write to the same field (under threshold)', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Rule A', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '5', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr2', Name: 'Rule B', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 2, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa2', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when rules target different fields', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Rule A', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '5', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr2', Name: 'Rule B', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 2, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa2', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '100', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr3', Name: 'Rule C', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 3, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa3', SBQQ__Field__c: 'SBQQ__ListPrice__c', SBQQ__Value__c: '200', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty price rules array', async () => {
      const data = createCleanData();
      data.priceRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag when 3 active rules target the same field', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Rule A', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '5', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr2', Name: 'Rule B', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 2, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa2', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr3', Name: 'Rule C', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 3, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa3', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '15', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PR-004');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(3);
      expect(issues[0].description).toContain('SBQQ__Discount__c');
    });

    it('should flag 4 rules targeting the same field', async () => {
      const data = createCleanData();
      data.priceRules = Array.from({ length: 4 }, (_, i) => ({
        Id: `pr${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: i + 1, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] },
        SBQQ__PriceActions__r: { records: [{ Id: `pa${i}`, SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: `${i * 10}`, SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(4);
    });
  });

  // ═══════════════════════════════════════════════
  // PR-005: Price Rules Missing Evaluation Order
  // ═══════════════════════════════════════════════
  describe('PR-005: Price Rules Missing Evaluation Order', () => {
    const check = getCheck('PR-005');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all active rules have evaluation orders', async () => {
      const data = createCleanData();
      // Default fixture rules all have orders
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive rules with null evaluation order', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Inactive Null', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty price rules array', async () => {
      const data = createCleanData();
      data.priceRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active rule with null evaluation order', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Missing Order', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PR-005');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
    });

    it('should flag multiple active rules with null evaluation order', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'No Order A', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
        { Id: 'pr2', Name: 'No Order B', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
        { Id: 'pr3', Name: 'Has Order', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should only count active rules with null order, not inactive ones', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Active Null', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
        { Id: 'pr2', Name: 'Inactive Null', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].name).toBe('Active Null');
    });
  });
});
