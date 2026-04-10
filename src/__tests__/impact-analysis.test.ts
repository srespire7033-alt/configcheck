import { describe, it, expect } from 'vitest';
import { impactAnalysisChecks } from '@/lib/analysis/checks/impact-analysis';
import { createCleanData, createProblematicData } from './fixtures';

describe('Impact Analysis Checks', () => {
  describe('IA-001: Price Rule Dependency Chains', () => {
    const check = impactAnalysisChecks.find(c => c.id === 'IA-001')!;

    it('should NOT trigger with independent price rules', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when price rules write and read the same field (dependency chain)', async () => {
      const data = createProblematicData();
      // All 55 rules write to SBQQ__Discount__c and conditions read SBQQ__Discount__c
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('IA-001');
      expect(issues[0].category).toBe('impact_analysis');
    });
  });

  describe('IA-002: Overlapping Rule Scope', () => {
    const check = impactAnalysisChecks.find(c => c.id === 'IA-002')!;

    it('should NOT trigger when few rules target same field', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when >= 4 rules target the same field', async () => {
      const data = createProblematicData();
      // 55 rules all target SBQQ__Discount__c
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('IA-002');
      expect(issues[0].severity).toBe('critical');
    });
  });

  describe('IA-003: Discount Schedule + Price Rule Conflict', () => {
    const check = impactAnalysisChecks.find(c => c.id === 'IA-003')!;

    it('should NOT trigger when no discount schedules exist', async () => {
      const data = createCleanData();
      data.discountSchedules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when discount schedules AND price rules both target discount fields', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('IA-003');
    });
  });

  describe('IA-004: Orphaned Configuration Dependencies', () => {
    const check = impactAnalysisChecks.find(c => c.id === 'IA-004')!;

    it('should NOT trigger when all contracted prices reference active products', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when contracted prices reference inactive/deleted products', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('IA-004');
    });
  });
});
