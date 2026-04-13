import { describe, it, expect } from 'vitest';
import { productRuleChecks } from '@/lib/analysis/checks/product-rules';
import { createCleanData } from './fixtures';

// Helper to get a specific check
const getCheck = (id: string) => productRuleChecks.find((c) => c.id === id)!;

describe('Product Rules — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // PRD-001: Conflicting Selection Rules
  // ═══════════════════════════════════════════════
  describe('PRD-001: Conflicting Selection Rules', () => {
    const check = getCheck('PRD-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with clean data (no conflicts)', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when selection rule only adds products', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Add Accessories', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Add' }, { SBQQ__Product__c: 'prodB', SBQQ__Type__c: 'Add' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when selection rule only removes products', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Remove Old SKUs', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Remove' }, { SBQQ__Product__c: 'prodB', SBQQ__Type__c: 'Hide' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when no selection rules exist (only Validation)', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Qty Check', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [{ Id: 'ec1', SBQQ__TestedField__c: 'SBQQ__Quantity__c', SBQQ__Operator__c: 'greater than', SBQQ__FilterValue__c: '0' }] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when add and remove target different products', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Add Premium', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Add' }] } },
        { Id: 'prd2', Name: 'Remove Basic', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 20, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodB', SBQQ__Type__c: 'Remove' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive rule has conflicting actions', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Inactive Add', SBQQ__Active__c: false, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Add' }] } },
        { Id: 'prd2', Name: 'Inactive Remove', SBQQ__Active__c: false, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 20, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Remove' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty productRules array', async () => {
      const data = createCleanData();
      data.productRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag when same product is added and removed by different rules', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Add Warranty', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Add' }] } },
        { Id: 'prd2', Name: 'Remove Warranty', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 20, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Remove' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PRD-001');
      expect(issues[0].severity).toBe('critical');
    });

    it('should flag when same product is added and hidden', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Add Support', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodX', SBQQ__Type__c: 'Add' }] } },
        { Id: 'prd2', Name: 'Hide Support', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 20, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodX', SBQQ__Type__c: 'Hide' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].description).toContain('prodX');
    });

    it('should flag multiple conflicting products independently', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Add Both', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Add' }, { SBQQ__Product__c: 'prodB', SBQQ__Type__c: 'Add' }] } },
        { Id: 'prd2', Name: 'Remove Both', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 20, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Remove' }, { SBQQ__Product__c: 'prodB', SBQQ__Type__c: 'Hide' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });

    it('should flag conflict within same rule actions', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Confused Rule', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Add' }, { SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Remove' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════
  // PRD-002: Duplicate Evaluation Order
  // ═══════════════════════════════════════════════
  describe('PRD-002: Duplicate Product Rule Evaluation Order', () => {
    const check = getCheck('PRD-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all active rules have unique evaluation orders', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Rule 1', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd2', Name: 'Rule 2', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 20, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when different types share the same order', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Validation Rule', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd2', Name: 'Selection Rule', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive rules with duplicate orders', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Inactive 1', SBQQ__Active__c: false, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd2', Name: 'Inactive 2', SBQQ__Active__c: false, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip rules with null evaluation order', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Null Order 1', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd2', Name: 'Null Order 2', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty productRules array', async () => {
      const data = createCleanData();
      data.productRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag two active rules of same type with same evaluation order', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Validation A', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd2', Name: 'Validation B', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PRD-002');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('2');
    });

    it('should flag three rules sharing order in a single issue', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Selection A', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 5, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd2', Name: 'Selection B', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 5, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd3', Name: 'Selection C', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 5, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('3');
      expect(issues[0].affected_records).toHaveLength(3);
    });

    it('should flag duplicates in multiple groups separately', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Alert A', SBQQ__Active__c: true, SBQQ__Type__c: 'Alert', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd2', Name: 'Alert B', SBQQ__Active__c: true, SBQQ__Type__c: 'Alert', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd3', Name: 'Validation X', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 20, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd4', Name: 'Validation Y', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 20, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════
  // PRD-003: Product Rules Without Conditions or Actions
  // ═══════════════════════════════════════════════
  describe('PRD-003: Product Rules Without Conditions or Actions', () => {
    const check = getCheck('PRD-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when active rule has error conditions', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Has Conditions', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [{ Id: 'ec1', SBQQ__TestedField__c: 'SBQQ__Quantity__c', SBQQ__Operator__c: 'greater than', SBQQ__FilterValue__c: '0' }] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when active rule has actions', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Has Actions', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Add' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive rule with no conditions or actions', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Inactive Empty', SBQQ__Active__c: false, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when active rule has both conditions and actions', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Complete Rule', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [{ Id: 'ec1', SBQQ__TestedField__c: 'SBQQ__Quantity__c', SBQQ__Operator__c: 'equals', SBQQ__FilterValue__c: '1' }] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Add' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active rule with empty conditions AND empty actions', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Empty Rule', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PRD-003');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('Empty Rule');
    });

    it('should flag multiple empty active rules', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Empty A', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: null, SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd2', Name: 'Empty B', SBQQ__Active__c: true, SBQQ__Type__c: 'Alert', SBQQ__EvaluationOrder__c: 20, SBQQ__ConditionsMet__c: null, SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });

    it('should include affected record in the issue', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd-dead', Name: 'Dead Rule', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('prd-dead');
    });
  });

  // ═══════════════════════════════════════════════
  // PRD-004: Validation/Alert Rules Missing ConditionsMet
  // ═══════════════════════════════════════════════
  describe('PRD-004: Validation Rules Missing Error Condition Logic', () => {
    const check = getCheck('PRD-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when Validation rule has ConditionsMet set', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Good Validation', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [{ Id: 'ec1', SBQQ__TestedField__c: 'SBQQ__Quantity__c', SBQQ__Operator__c: 'greater than', SBQQ__FilterValue__c: '0' }] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when Alert rule has ConditionsMet set to Any', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Good Alert', SBQQ__Active__c: true, SBQQ__Type__c: 'Alert', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'Any', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip Selection type rules even with null ConditionsMet', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Selection No Conditions', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: null, SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [{ SBQQ__Product__c: 'prodA', SBQQ__Type__c: 'Add' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive Validation rules with null ConditionsMet', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Inactive Validation', SBQQ__Active__c: false, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: null, SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty productRules array', async () => {
      const data = createCleanData();
      data.productRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active Validation rule with null ConditionsMet', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Bad Validation', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: null, SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PRD-004');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('Validation');
    });

    it('should flag active Alert rule with null ConditionsMet', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Bad Alert', SBQQ__Active__c: true, SBQQ__Type__c: 'Alert', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: null, SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('Alert');
    });

    it('should flag multiple rules missing ConditionsMet', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Missing Logic 1', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: null, SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd2', Name: 'Missing Logic 2', SBQQ__Active__c: true, SBQQ__Type__c: 'Alert', SBQQ__EvaluationOrder__c: 20, SBQQ__ConditionsMet__c: null, SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
        { Id: 'prd3', Name: 'Good Rule', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 30, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });
  });
});
