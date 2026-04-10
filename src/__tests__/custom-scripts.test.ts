import { describe, it, expect } from 'vitest';
import { customScriptChecks } from '@/lib/analysis/checks/custom-scripts';
import { createCleanData, createProblematicData } from './fixtures';

describe('Custom Script (QCP) Checks', () => {
  describe('QCP-001: Empty Quote Calculator Plugin', () => {
    const check = customScriptChecks.find(c => c.id === 'QCP-001')!;

    it('should NOT trigger when scripts have code', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when script has empty or missing code', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('QCP-001');
      expect(issues[0].severity).toBe('critical');
    });
  });

  describe('QCP-002: QCP Missing Transpiled Code', () => {
    const check = customScriptChecks.find(c => c.id === 'QCP-002')!;

    it('should NOT trigger when scripts are transpiled', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when script has code but empty transpiled code', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('QCP-002');
    });
  });

  describe('QCP-003: QCP Performance Concerns', () => {
    const check = customScriptChecks.find(c => c.id === 'QCP-003')!;

    it('should NOT trigger when code is simple', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when code has many loops or console statements', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('QCP-003');
    });
  });

  describe('QCP-004: Multiple QCP Scripts', () => {
    const check = customScriptChecks.find(c => c.id === 'QCP-004')!;

    it('should NOT trigger with single QCP', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when multiple QCP scripts exist', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('QCP-004');
    });
  });
});
