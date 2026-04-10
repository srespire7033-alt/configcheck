import { describe, it, expect } from 'vitest';
import { approvalRuleChecks } from '@/lib/analysis/checks/approval-rules';
import { createCleanData, createProblematicData } from './fixtures';

describe('Approval Rule Checks', () => {
  describe('AR-001: Approval Rules Without Approver', () => {
    const check = approvalRuleChecks.find(c => c.id === 'AR-001')!;

    it('should NOT trigger when all rules have approvers', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when active rule has no approver or approver field', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('AR-001');
      expect(issues[0].severity).toBe('critical');
    });
  });

  describe('AR-002: Approval Rules Without Conditions', () => {
    const check = approvalRuleChecks.find(c => c.id === 'AR-002')!;

    it('should NOT trigger when all rules have conditions', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when active rule has empty conditions', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('AR-002');
    });
  });

  describe('AR-003: Duplicate Approval Evaluation Order', () => {
    const check = approvalRuleChecks.find(c => c.id === 'AR-003')!;

    it('should NOT trigger when evaluation orders are unique', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when multiple rules share same evaluation order', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('AR-003');
    });
  });

  describe('AR-004: Missing Condition Logic', () => {
    const check = approvalRuleChecks.find(c => c.id === 'AR-004')!;

    it('should NOT trigger when all rules have condition logic set', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when active rule has conditions but no ConditionsMet logic', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('AR-004');
    });
  });
});
