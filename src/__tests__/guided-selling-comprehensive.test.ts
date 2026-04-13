import { describe, it, expect } from 'vitest';
import { guidedSellingChecks } from '@/lib/analysis/checks/guided-selling';
import { createCleanData } from './fixtures';

const getCheck = (id: string) => guidedSellingChecks.find((c) => c.id === id)!;

describe('Guided Selling — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // GS-001: Guided Selling Without Inputs
  // ═══════════════════════════════════════════════
  describe('GS-001: Guided Selling Without Inputs', () => {
    const check = getCheck('GS-001');

    // ── Negative tests ──
    it('should pass when process has inputs', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when process has exactly 1 input', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Minimal Wizard', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: 'One question', inputCount: 1, outputCount: 2 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when process has many inputs', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Rich Wizard', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '10 questions', inputCount: 10, outputCount: 5 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive process with no inputs', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Inactive No Input', SBQQ__Active__c: false, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: 'Old', inputCount: 0, outputCount: 2 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty guided selling array', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag active process with 0 inputs', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Empty Wizard', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: 'No questions', inputCount: 0, outputCount: 3 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].check_id).toBe('GS-001');
      expect(issues[0].title).toContain('Empty Wizard');
      expect(issues[0].affected_records[0].type).toBe('SBQQ__GuidedSellingProcess__c');
    });

    it('should flag multiple processes without inputs', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Blank A', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 0, outputCount: 1 },
        { Id: 'gs2', Name: 'Blank B', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 0, outputCount: 2 },
        { Id: 'gs3', Name: 'Good One', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 5, outputCount: 3 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });

    it('should flag process with 0 inputs AND 0 outputs (completely empty)', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Ghost Process', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 0, outputCount: 0 },
      ];
      const issues = await check.run(data);
      // GS-001 should catch inputCount=0
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('GS-001');
    });
  });

  // ═══════════════════════════════════════════════
  // GS-002: Guided Selling Without Outputs
  // ═══════════════════════════════════════════════
  describe('GS-002: Guided Selling Without Outputs', () => {
    const check = getCheck('GS-002');

    // ── Negative tests ──
    it('should pass when process has outputs', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when process has exactly 1 output', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Single Output', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 3, outputCount: 1 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip inactive process with no outputs', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Inactive', SBQQ__Active__c: false, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 3, outputCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag active process with 0 outputs', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Dead End Wizard', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 5, outputCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].check_id).toBe('GS-002');
      expect(issues[0].title).toContain('Dead End Wizard');
    });

    it('should flag only output-less processes in a mixed set', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Good', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 3, outputCount: 4 },
        { Id: 'gs2', Name: 'No Output', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 3, outputCount: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records[0].name).toBe('No Output');
    });
  });

  // ═══════════════════════════════════════════════
  // GS-003: Inactive Guided Selling Processes
  // ═══════════════════════════════════════════════
  describe('GS-003: Inactive Guided Selling Processes', () => {
    const check = getCheck('GS-003');

    // ── Negative tests ──
    it('should pass when all processes are active', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty processes array', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when all 3 processes are active', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Active 1', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 2, outputCount: 2 },
        { Id: 'gs2', Name: 'Active 2', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 3, outputCount: 1 },
        { Id: 'gs3', Name: 'Active 3', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 1, outputCount: 4 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag single inactive process', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Old Wizard', SBQQ__Active__c: false, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: 'Deprecated', inputCount: 2, outputCount: 2 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].check_id).toBe('GS-003');
      expect(issues[0].title).toContain('1 inactive');
    });

    it('should group multiple inactive processes in one issue', async () => {
      const data = createCleanData();
      data.guidedSellingProcesses = [
        { Id: 'gs1', Name: 'Active', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 3, outputCount: 2 },
        { Id: 'gs2', Name: 'Old A', SBQQ__Active__c: false, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 1, outputCount: 1 },
        { Id: 'gs3', Name: 'Old B', SBQQ__Active__c: false, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 2, outputCount: 2 },
        { Id: 'gs4', Name: 'Old C', SBQQ__Active__c: false, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 1, outputCount: 1 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(3);
      expect(issues[0].title).toContain('3 inactive');
    });
  });
});
