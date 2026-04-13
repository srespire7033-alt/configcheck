import { describe, it, expect } from 'vitest';
import { summaryVariableChecks } from '@/lib/analysis/checks/summary-variables';
import { createCleanData } from './fixtures';

const getCheck = (id: string) => summaryVariableChecks.find((c) => c.id === id)!;

describe('Summary Variables — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // SV-001: Orphaned Summary Variables
  // ═══════════════════════════════════════════════
  describe('SV-001: Orphaned Summary Variables', () => {
    const check = getCheck('SV-001');

    // ── Negative tests ──
    it('should pass when variable is referenced by a price rule', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Used by Price Rule', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 2, referencedByProductRuleCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when variable is referenced by a product rule', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Used by Product Rule', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 1 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when variable is referenced by BOTH rule types', async () => {
      const data = createCleanData();
      data.summaryVariables[0].referencedByPriceRuleCount = 1;
      data.summaryVariables[0].referencedByProductRuleCount = 3;
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive orphaned variables', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Inactive Orphan', SBQQ__Active__c: false, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty summary variables array', async () => {
      const data = createCleanData();
      data.summaryVariables = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag single orphaned active variable', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Orphan Var', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
    });

    it('should report count of multiple orphans in one issue', async () => {
      const data = createCleanData();
      data.summaryVariables = Array.from({ length: 5 }, (_, i) => ({
        Id: `sv${i}`, Name: `Orphan ${i}`, SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 0,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('5');
      expect(issues[0].affected_records).toHaveLength(5);
    });

    it('should only include orphaned variables (not referenced ones) in affected records', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Referenced', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0 },
        { Id: 'sv2', Name: 'Orphan', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__NetPrice__c', SBQQ__AggregateFunction__c: 'Max', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].name).toBe('Orphan');
    });
  });

  // ═══════════════════════════════════════════════
  // SV-002: Incomplete Summary Variable Configuration
  // ═══════════════════════════════════════════════
  describe('SV-002: Incomplete Summary Variable Configuration', () => {
    const check = getCheck('SV-002');

    // ── Negative tests ──
    it('should pass when all fields are set', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive variables with missing config', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Inactive Broken', SBQQ__Active__c: false, SBQQ__AggregateField__c: null, SBQQ__AggregateFunction__c: null, SBQQ__TargetObject__c: null, SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag variable missing Aggregate Function', async () => {
      const data = createCleanData();
      data.summaryVariables[0].SBQQ__AggregateFunction__c = null;
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].title).toContain('Aggregate Function');
    });

    it('should flag variable missing Aggregate Field', async () => {
      const data = createCleanData();
      data.summaryVariables[0].SBQQ__AggregateField__c = null;
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('Aggregate Field');
    });

    it('should flag variable missing Target Object', async () => {
      const data = createCleanData();
      data.summaryVariables[0].SBQQ__TargetObject__c = null;
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('Target Object');
    });

    it('should flag variable missing ALL three fields', async () => {
      const data = createCleanData();
      data.summaryVariables[0].SBQQ__AggregateFunction__c = null;
      data.summaryVariables[0].SBQQ__AggregateField__c = null;
      data.summaryVariables[0].SBQQ__TargetObject__c = null;
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('Aggregate Function');
      expect(issues[0].title).toContain('Aggregate Field');
      expect(issues[0].title).toContain('Target Object');
    });

    it('should flag each incomplete variable separately', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Missing Func', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 0 },
        { Id: 'sv2', Name: 'Missing Field', SBQQ__Active__c: true, SBQQ__AggregateField__c: null, SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════
  // SV-003: Duplicate Summary Variables
  // ═══════════════════════════════════════════════
  describe('SV-003: Duplicate Summary Variables', () => {
    const check = getCheck('SV-003');

    // ── Negative tests ──
    it('should pass when all variables have unique configurations', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Sum Qty', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0 },
        { Id: 'sv2', Name: 'Max Price', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__NetPrice__c', SBQQ__AggregateFunction__c: 'Max', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 1 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when same field but different function (Sum vs Max)', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Sum Qty', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0 },
        { Id: 'sv2', Name: 'Max Qty', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Max', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when same function/field but different scope', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Quote Scope', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0 },
        { Id: 'sv2', Name: 'Group Scope', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Group', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip variables with missing aggregate config from duplication check', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'No Func A', SBQQ__Active__c: true, SBQQ__AggregateField__c: null, SBQQ__AggregateFunction__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 0 },
        { Id: 'sv2', Name: 'No Func B', SBQQ__Active__c: true, SBQQ__AggregateField__c: null, SBQQ__AggregateFunction__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag 2 variables with identical function+field+target+scope', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Sum Qty A', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0 },
        { Id: 'sv2', Name: 'Sum Qty B', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].title).toContain('2 duplicate');
    });

    it('should flag 3 identical duplicates', async () => {
      const data = createCleanData();
      data.summaryVariables = Array.from({ length: 3 }, (_, i) => ({
        Id: `sv${i}`, Name: `Dup ${i}`, SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__NetPrice__c', SBQQ__AggregateFunction__c: 'Count', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(3);
    });
  });

  // ═══════════════════════════════════════════════
  // SV-004: Filter Misconfiguration
  // ═══════════════════════════════════════════════
  describe('SV-004: Summary Variable Filter Misconfiguration', () => {
    const check = getCheck('SV-004');

    // ── Negative tests ──
    it('should pass when no filter is configured', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when filter is fully configured (all 3 fields)', async () => {
      const data = createCleanData();
      data.summaryVariables[0].SBQQ__FilterField__c = 'SBQQ__ProductCode__c';
      data.summaryVariables[0].SBQQ__FilterValue__c = 'PREM';
      data.summaryVariables[0].SBQQ__Operator__c = 'equals';
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag when FilterField is set but FilterValue and Operator are missing', async () => {
      const data = createCleanData();
      data.summaryVariables[0].SBQQ__FilterField__c = 'SBQQ__ProductCode__c';
      data.summaryVariables[0].SBQQ__FilterValue__c = null;
      data.summaryVariables[0].SBQQ__Operator__c = null;
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('incomplete filter');
    });

    it('should flag when FilterField and FilterValue set but Operator missing', async () => {
      const data = createCleanData();
      data.summaryVariables[0].SBQQ__FilterField__c = 'SBQQ__ProductCode__c';
      data.summaryVariables[0].SBQQ__FilterValue__c = 'PREM';
      data.summaryVariables[0].SBQQ__Operator__c = null;
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('Operator');
    });

    it('should flag when FilterValue is set but Field and Operator are missing', async () => {
      const data = createCleanData();
      data.summaryVariables[0].SBQQ__FilterField__c = null;
      data.summaryVariables[0].SBQQ__FilterValue__c = 'PREM';
      data.summaryVariables[0].SBQQ__Operator__c = null;
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════
  // SV-005: Composite Variable Missing Operand
  // ═══════════════════════════════════════════════
  describe('SV-005: Composite Variable Missing Operand', () => {
    const check = getCheck('SV-005');

    // ── Negative tests ──
    it('should pass when variable is not composite (no CombineWith or CompositeOperator)', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when both CombineWith and CompositeOperator are set', async () => {
      const data = createCleanData();
      data.summaryVariables[0].SBQQ__CombineWith__c = 'sv_other';
      data.summaryVariables[0].SBQQ__CompositeOperator__c = 'Add';
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive variables with broken composite config', async () => {
      const data = createCleanData();
      data.summaryVariables = [
        { Id: 'sv1', Name: 'Inactive Composite', SBQQ__Active__c: false, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: 'sv_other', SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 0, referencedByProductRuleCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag when CombineWith is set but CompositeOperator is missing', async () => {
      const data = createCleanData();
      data.summaryVariables[0].SBQQ__CombineWith__c = 'sv_other';
      data.summaryVariables[0].SBQQ__CompositeOperator__c = null;
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].title).toContain('Composite Operator');
    });

    it('should flag when CompositeOperator is set but CombineWith is missing', async () => {
      const data = createCleanData();
      data.summaryVariables[0].SBQQ__CombineWith__c = null;
      data.summaryVariables[0].SBQQ__CompositeOperator__c = 'Multiply';
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('Combine With');
    });
  });
});
