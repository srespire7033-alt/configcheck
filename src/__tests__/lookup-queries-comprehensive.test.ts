import { describe, it, expect } from 'vitest';
import { lookupQueryChecks } from '@/lib/analysis/checks/lookup-queries';
import { createCleanData } from './fixtures';

const getCheck = (id: string) => lookupQueryChecks.find((c) => c.id === id)!;

describe('Lookup Queries — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // LQ-001: Incomplete Price Rule Lookups
  // ═══════════════════════════════════════════════
  describe('LQ-001: Incomplete Price Rule Lookups', () => {
    const check = getCheck('LQ-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when price rules have no lookup object', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when lookup object and source lookup field are both set', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Lookup Rule', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: 'Custom_Rate__c',
          SBQQ__PriceConditions__r: { records: [{ Id: 'pc1', SBQQ__Field__c: 'SBQQ__ProductCode__c', SBQQ__Operator__c: 'equals', SBQQ__Value__c: 'X', SBQQ__Object__c: 'Quote Line' }] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: null, SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: 'Rate__c' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive rule has lookup without source field', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Inactive Lookup', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: 'Custom_Rate__c',
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '100', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag active rule with lookup object but no source lookup field', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Broken Lookup Rule', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: 'Custom_Rate__c',
          SBQQ__PriceConditions__r: { records: [{ Id: 'pc1', SBQQ__Field__c: 'SBQQ__ProductCode__c', SBQQ__Operator__c: 'equals', SBQQ__Value__c: 'X', SBQQ__Object__c: 'Quote Line' }] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '100', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('LQ-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].description).toContain('Custom_Rate__c');
    });

    it('DETECT: should flag multiple broken lookup rules', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Broken A', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: 'Obj_A__c',
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'F', SBQQ__Value__c: '1', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
        { Id: 'pr2', Name: 'Broken B', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 20, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: 'Obj_B__c',
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa2', SBQQ__Field__c: 'G', SBQQ__Value__c: '2', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues.every((i) => i.check_id === 'LQ-001')).toBe(true);
    });

    it('should pass when rule has no actions at all', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'No Actions', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: 'Custom__c',
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1); // Still flags — lookup configured but unused
    });
  });

  // ═══════════════════════════════════════════════
  // LQ-002: Orphaned Lookup References
  // ═══════════════════════════════════════════════
  describe('LQ-002: Orphaned Lookup References', () => {
    const check = getCheck('LQ-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when no source lookup fields are used', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when lookup object matches source lookup field', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Good Lookup', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: 'Custom__c',
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'Price', SBQQ__Value__c: null, SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: 'Rate__c' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive rule has orphaned lookup ref', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Inactive Orphan', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'Price', SBQQ__Value__c: null, SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: 'Rate__c' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag action with source lookup field but rule has no lookup object', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Orphaned Ref', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: null, SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: 'Custom_Rate__c' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('LQ-002');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].description).toContain('Custom_Rate__c');
    });

    it('DETECT: should flag even with multiple actions where one has orphaned ref', async () => {
      const data = createCleanData();
      data.priceRules = [
        { Id: 'pr1', Name: 'Mixed Actions', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [
            { Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null },
            { Id: 'pa2', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: null, SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: 'Rate__c' },
          ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('LQ-002');
    });
  });

  // ═══════════════════════════════════════════════
  // LQ-003: Selection Rules Missing Target Product
  // ═══════════════════════════════════════════════
  describe('LQ-003: Selection Rules Missing Target Product', () => {
    const check = getCheck('LQ-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when no selection rules exist', async () => {
      const data = createCleanData();
      // Clean data has Validation type rules only
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when selection rule has product on action', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Good Selection', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: null, SBQQ__LookupProductField__c: null,
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [{ Id: 'a1', SBQQ__Type__c: 'Add', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true } }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when selection rule uses lookup object (dynamic selection)', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Lookup Selection', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: 'Custom_Product_Map__c', SBQQ__LookupProductField__c: 'Target_Product__c',
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [{ Id: 'a1', SBQQ__Type__c: 'Add', SBQQ__Product__c: null, SBQQ__Product__r: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive selection rule has no product', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Inactive Selection', SBQQ__Active__c: false, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: null, SBQQ__LookupProductField__c: null,
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [{ Id: 'a1', SBQQ__Type__c: 'Add', SBQQ__Product__c: null, SBQQ__Product__r: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag selection rule with Add action but no product', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Missing Product Rule', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: null, SBQQ__LookupProductField__c: null,
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [{ Id: 'a1', SBQQ__Type__c: 'Add', SBQQ__Product__c: null, SBQQ__Product__r: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('LQ-003');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].description).toContain('Add');
    });

    it('DETECT: should flag Remove action without product', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Remove No Product', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: null, SBQQ__LookupProductField__c: null,
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [{ Id: 'a1', SBQQ__Type__c: 'Remove', SBQQ__Product__c: null, SBQQ__Product__r: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('LQ-003');
    });

    it('DETECT: should flag Enable & Add action without product', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Enable Add No Product', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: null, SBQQ__LookupProductField__c: null,
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [{ Id: 'a1', SBQQ__Type__c: 'Enable & Add', SBQQ__Product__c: null, SBQQ__Product__r: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════
  // LQ-004: Selection Rules Targeting Inactive Products
  // ═══════════════════════════════════════════════
  describe('LQ-004: Selection Rules Targeting Inactive Products', () => {
    const check = getCheck('LQ-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when selection rule targets active product', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Good Selection', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: null, SBQQ__LookupProductField__c: null,
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [{ Id: 'a1', SBQQ__Type__c: 'Add', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true } }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when no selection rules exist', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when action has no product (LQ-003 handles that)', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'No Product', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: null, SBQQ__LookupProductField__c: null,
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [{ Id: 'a1', SBQQ__Type__c: 'Add', SBQQ__Product__c: null, SBQQ__Product__r: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive rule targets inactive product', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Inactive Rule', SBQQ__Active__c: false, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: null, SBQQ__LookupProductField__c: null,
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [{ Id: 'a1', SBQQ__Type__c: 'Add', SBQQ__Product__c: 'dead', SBQQ__Product__r: { Name: 'Dead Product', IsActive: false } }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('DETECT: should flag selection rule targeting inactive product via relationship', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Targets Dead Product', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: null, SBQQ__LookupProductField__c: null,
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [{ Id: 'a1', SBQQ__Type__c: 'Add', SBQQ__Product__c: 'dead_prod', SBQQ__Product__r: { Name: 'Deactivated Widget', IsActive: false } }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('LQ-004');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].description).toContain('Deactivated Widget');
    });

    it('DETECT: should flag when product ID exists but not in active products (no relationship data)', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Unknown Product', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: null, SBQQ__LookupProductField__c: null,
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [{ Id: 'a1', SBQQ__Type__c: 'Add', SBQQ__Product__c: 'deleted_id' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('LQ-004');
    });

    it('DETECT: should flag multiple inactive product targets across actions', async () => {
      const data = createCleanData();
      data.productRules = [
        { Id: 'prd1', Name: 'Multi Dead', SBQQ__Active__c: true, SBQQ__Type__c: 'Selection', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__LookupObject__c: null, SBQQ__LookupProductField__c: null,
          SBQQ__ErrorConditions__r: { records: [] },
          SBQQ__Actions__r: { records: [
            { Id: 'a1', SBQQ__Type__c: 'Add', SBQQ__Product__c: 'dead1', SBQQ__Product__r: { Name: 'Dead 1', IsActive: false } },
            { Id: 'a2', SBQQ__Type__c: 'Remove', SBQQ__Product__c: 'dead2', SBQQ__Product__r: { Name: 'Dead 2', IsActive: false } },
            { Id: 'a3', SBQQ__Type__c: 'Add', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Active One', IsActive: true } },
          ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues.every((i) => i.check_id === 'LQ-004')).toBe(true);
    });
  });
});
