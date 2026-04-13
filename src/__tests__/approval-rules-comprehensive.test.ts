import { describe, it, expect } from 'vitest';
import { approvalRuleChecks } from '@/lib/analysis/checks/approval-rules';
import { createCleanData } from './fixtures';

// Helper to get a specific check
const getCheck = (id: string) => approvalRuleChecks.find((c) => c.id === id)!;

describe('Approval Rules — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // AR-001: Approval Rules Without Approver
  // ═══════════════════════════════════════════════
  describe('AR-001: Approval Rules Without Approver', () => {
    const check = getCheck('AR-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when rule has Approver set', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Discount Approval', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'manager@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when rule has ApproverField set (dynamic lookup)', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Manager Lookup', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: null, SBQQ__ApproverField__c: 'Manager__c', SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when rule has BOTH Approver and ApproverField', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Both Set', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: 'Backup_Approver__c', SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive rules with no approver', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Inactive No Approver', SBQQ__Active__c: false, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: null, SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty approval rules array', async () => {
      const data = createCleanData();
      data.approvalRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active rule with neither Approver nor ApproverField', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Broken Rule', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: null, SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [{ Id: 'ac1', SBQQ__TestedField__c: 'SBQQ__Discount__c', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '20', SBQQ__TestedVariable__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].title).toContain('Broken Rule');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('ar1');
    });

    it('should flag multiple rules without approvers', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Rule A', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: null, SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar2', Name: 'Rule B', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 2, SBQQ__Approver__c: null, SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 2, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar3', Name: 'Valid Rule', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 3, SBQQ__Approver__c: 'boss@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 3, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });

    it('should flag rule with empty string approver (not just null)', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Empty Approver', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: '' as unknown as null, SBQQ__ApproverField__c: '' as unknown as null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════
  // AR-002: Approval Rules Without Conditions
  // ═══════════════════════════════════════════════
  describe('AR-002: Approval Rules Without Conditions', () => {
    const check = getCheck('AR-002');

    // ── Negative tests ──
    it('should pass when rule has conditions', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive rules without conditions', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Inactive No Cond', SBQQ__Active__c: false, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when rule has multiple conditions', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Multi Cond', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [
          { Id: 'ac1', SBQQ__TestedField__c: 'SBQQ__Discount__c', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '20', SBQQ__TestedVariable__c: null },
          { Id: 'ac2', SBQQ__TestedField__c: 'Amount', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '50000', SBQQ__TestedVariable__c: null },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag active rule with empty conditions array', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'No Conditions', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('No Conditions');
    });

    it('should flag rule with null conditions records', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Null Conditions', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: null as unknown as { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });

    it('should flag only the conditionless rules in a mixed set', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Good Rule', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [{ Id: 'ac1', SBQQ__TestedField__c: 'SBQQ__Discount__c', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '20', SBQQ__TestedVariable__c: null }] } },
        { Id: 'ar2', Name: 'Bad Rule', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 2, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 2, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('Bad Rule');
    });
  });

  // ═══════════════════════════════════════════════
  // AR-003: Duplicate Approval Evaluation Order
  // ═══════════════════════════════════════════════
  describe('AR-003: Duplicate Approval Evaluation Order', () => {
    const check = getCheck('AR-003');

    // ── Negative tests ──
    it('should pass when all orders are unique', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Rule 1', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'a@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar2', Name: 'Rule 2', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 2, SBQQ__Approver__c: 'b@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 2, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar3', Name: 'Rule 3', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 3, SBQQ__Approver__c: 'c@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 3, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip null evaluation orders', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Rule 1', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'a@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: null as unknown as number, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar2', Name: 'Rule 2', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 2, SBQQ__Approver__c: 'b@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: null as unknown as number, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should ignore inactive rules with duplicate orders', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Inactive A', SBQQ__Active__c: false, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'a@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 5, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar2', Name: 'Inactive B', SBQQ__Active__c: false, SBQQ__ApprovalStep__c: 2, SBQQ__Approver__c: 'b@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 5, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with single rule', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag 2 rules with same evaluation order', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Dup A', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'a@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 10, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar2', Name: 'Dup B', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 2, SBQQ__Approver__c: 'b@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 10, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].title).toContain('2 approval rules');
    });

    it('should flag 3 rules with same order', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Triple A', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'a@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar2', Name: 'Triple B', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 2, SBQQ__Approver__c: 'b@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar3', Name: 'Triple C', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 3, SBQQ__Approver__c: 'c@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(3);
      expect(issues[0].title).toContain('3');
    });

    it('should flag multiple groups of duplicates separately', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Group1 A', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'a@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 5, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar2', Name: 'Group1 B', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 2, SBQQ__Approver__c: 'b@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 5, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar3', Name: 'Group2 A', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 3, SBQQ__Approver__c: 'c@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 15, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
        { Id: 'ar4', Name: 'Group2 B', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 4, SBQQ__Approver__c: 'd@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 15, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════
  // AR-004: Missing Condition Logic
  // ═══════════════════════════════════════════════
  describe('AR-004: Approval Rules Missing Condition Logic', () => {
    const check = getCheck('AR-004');

    // ── Negative tests ──
    it('should pass when ConditionsMet is set to All', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when ConditionsMet is set to Any', async () => {
      const data = createCleanData();
      data.approvalRules[0].SBQQ__ConditionsMet__c = 'Any';
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip rules with no conditions (AR-002 handles that)', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'No Cond No Logic', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: null as unknown as string, SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive rules', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Inactive Missing Logic', SBQQ__Active__c: false, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: null as unknown as string, SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [{ Id: 'ac1', SBQQ__TestedField__c: 'Amount', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '1000', SBQQ__TestedVariable__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag rule with conditions but null ConditionsMet', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Missing Logic', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: null as unknown as string, SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [{ Id: 'ac1', SBQQ__TestedField__c: 'SBQQ__NetAmount__c', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '100000', SBQQ__TestedVariable__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('AR-004');
      expect(issues[0].title).toContain('Missing Logic');
    });

    it('should flag rule with empty string ConditionsMet', async () => {
      const data = createCleanData();
      data.approvalRules = [
        { Id: 'ar1', Name: 'Empty Logic', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: '' as unknown as string, SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [{ Id: 'ac1', SBQQ__TestedField__c: 'Amount', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '10000', SBQQ__TestedVariable__c: null }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });
  });
});
