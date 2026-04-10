import { describe, it, expect } from 'vitest';
import { performanceChecks } from '@/lib/analysis/checks/performance';
import { createCleanData, createProblematicData } from './fixtures';

describe('Performance Checks', () => {
  describe('PERF-001: High Price Rule Count', () => {
    const check = performanceChecks.find(c => c.id === 'PERF-001')!;

    it('should NOT trigger with few price rules', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when >= 50 active price rules', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('PERF-001');
      expect(issues[0].severity).toBe('warning');
    });
  });

  describe('PERF-002: High Product Rule Count', () => {
    const check = performanceChecks.find(c => c.id === 'PERF-002')!;

    it('should NOT trigger with few product rules', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when >= 30 active product rules', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('PERF-002');
    });
  });

  describe('PERF-004: Summary Variable Overhead', () => {
    const check = performanceChecks.find(c => c.id === 'PERF-004')!;

    it('should NOT trigger with few summary variables', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when >= 20 active summary variables', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('PERF-004');
    });
  });

  describe('PERF-005: Overall Complexity Score', () => {
    const check = performanceChecks.find(c => c.id === 'PERF-005')!;

    it('should NOT trigger with low complexity', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger with high complexity data', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('PERF-005');
    });
  });
});
