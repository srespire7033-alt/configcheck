import { describe, it, expect } from 'vitest';
import { runAnalysis } from '@/lib/analysis/engine';
import { createCleanData, createProblematicData } from './fixtures';

describe('Analysis Engine', () => {
  describe('runAnalysis with clean data', () => {
    it('should return a high score (>= 80) with clean config', async () => {
      const data = createCleanData();
      const result = await runAnalysis(data);

      expect(result.overall_score).toBeGreaterThanOrEqual(80);
      expect(result.issues.length).toBeLessThanOrEqual(5);
      expect(result.category_scores).toBeDefined();
      expect(result.duration_ms).toBeGreaterThan(0);
    });

    it('should return complexity data', async () => {
      const data = createCleanData();
      const result = await runAnalysis(data);

      expect(result.complexity).toBeDefined();
      expect(result.complexity!.rating).toBe('Low');
      expect(result.complexity!.totalScore).toBeLessThanOrEqual(30);
      expect(result.complexity!.factors).toBeInstanceOf(Array);
    });

    it('should return revenue summary', async () => {
      const data = createCleanData();
      const result = await runAnalysis(data);

      expect(result.revenue_summary).toBeDefined();
      expect(result.revenue_summary!.totalQuoteValue).toBeGreaterThanOrEqual(0);
      expect(result.revenue_summary!.currency).toBe('₹');
    });

    it('should have all category scores between 0 and 100', async () => {
      const data = createCleanData();
      const result = await runAnalysis(data);

      for (const [, score] of Object.entries(result.category_scores)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('runAnalysis with problematic data', () => {
    it('should return a low score (< 60) with many issues', async () => {
      const data = createProblematicData();
      const result = await runAnalysis(data);

      expect(result.overall_score).toBeLessThan(85);
      expect(result.issues.length).toBeGreaterThan(15);
    });

    it('should find critical issues', async () => {
      const data = createProblematicData();
      const result = await runAnalysis(data);

      const criticals = result.issues.filter(i => i.severity === 'critical');
      expect(criticals.length).toBeGreaterThan(0);
    });

    it('should have high complexity score', async () => {
      const data = createProblematicData();
      const result = await runAnalysis(data);

      expect(result.complexity).toBeDefined();
      expect(result.complexity!.totalScore).toBeGreaterThan(60);
      expect(['High', 'Very High']).toContain(result.complexity!.rating);
    });

    it('should calculate revenue at risk', async () => {
      const data = createProblematicData();
      const result = await runAnalysis(data);

      expect(result.revenue_summary).toBeDefined();
      expect(result.revenue_summary!.atRiskValue).toBeGreaterThan(0);
    });

    it('should detect issues across multiple categories', async () => {
      const data = createProblematicData();
      const result = await runAnalysis(data);

      const categories = new Set(result.issues.map(i => i.category));
      // Should have issues in at least 8 different categories
      expect(categories.size).toBeGreaterThanOrEqual(8);
    });

    it('should include affected records in issues', async () => {
      const data = createProblematicData();
      const result = await runAnalysis(data);

      const issuesWithRecords = result.issues.filter(i => i.affected_records.length > 0);
      expect(issuesWithRecords.length).toBeGreaterThan(0);
    });
  });
});
