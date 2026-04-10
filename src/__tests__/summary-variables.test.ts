import { describe, it, expect } from 'vitest';
import { summaryVariableChecks } from '@/lib/analysis/checks/summary-variables';
import { createCleanData, createProblematicData } from './fixtures';

describe('Summary Variable Checks', () => {
  describe('SV-001: Orphaned Summary Variables', () => {
    const check = summaryVariableChecks.find(c => c.id === 'SV-001')!;

    it('should NOT trigger when all variables are referenced by rules', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when active variables are not referenced by any rule', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('SV-001');
    });
  });

  describe('SV-002: Incomplete Summary Variable Configuration', () => {
    const check = summaryVariableChecks.find(c => c.id === 'SV-002')!;

    it('should NOT trigger when all variables are fully configured', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when active variable missing aggregate function/field/target', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('SV-002');
      expect(issues[0].severity).toBe('critical');
    });
  });

  describe('SV-003: Duplicate Summary Variables', () => {
    const check = summaryVariableChecks.find(c => c.id === 'SV-003')!;

    it('should NOT trigger when all variables are unique', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when variables share same function+field+target+scope', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('SV-003');
    });
  });

  describe('SV-004: Filter Misconfiguration', () => {
    const check = summaryVariableChecks.find(c => c.id === 'SV-004')!;

    it('should NOT trigger when filters are complete or absent', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when filter field set but value or operator missing', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('SV-004');
    });
  });

  describe('SV-005: Composite Variable Missing Operand', () => {
    const check = summaryVariableChecks.find(c => c.id === 'SV-005')!;

    it('should NOT trigger when composite variables are complete', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when CombineWith set but CompositeOperator missing', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('SV-005');
    });
  });
});
