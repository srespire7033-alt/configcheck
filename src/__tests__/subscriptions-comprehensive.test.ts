import { describe, it, expect } from 'vitest';
import { subscriptionChecks } from '@/lib/analysis/checks/subscriptions';
import { createCleanData } from './fixtures';

// Helper to get a specific check
const getCheck = (id: string) => subscriptionChecks.find((c) => c.id === id)!;

describe('Subscriptions — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // SR-001: Zero-Value Subscriptions
  // ═══════════════════════════════════════════════
  describe('SR-001: Zero-Value Subscriptions', () => {
    const check = getCheck('SR-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all subscriptions have positive net price', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-001', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 1000, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
        { Id: 'sub2', Name: 'SUB-002', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 500, SBQQ__Quantity__c: 2, SBQQ__ProrateMultiplier__c: 1.0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty subscriptions array', async () => {
      const data = createCleanData();
      data.subscriptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with clean data defaults', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when net price is a small positive value', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-001', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 0.01, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when net price is negative (credit)', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-001', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: -100, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag subscription with zero net price', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-Zero', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 0, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('SR-001');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('1');
    });

    it('should flag subscription with null net price', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-Null', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: null, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('SR-001');
    });

    it('should report correct count when multiple zero-price subs exist', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-001', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 0, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
        { Id: 'sub2', Name: 'SUB-002', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: null, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
        { Id: 'sub3', Name: 'SUB-003', SBQQ__Contract__c: 'c2', SBQQ__NetPrice__c: 0, SBQQ__Quantity__c: 5, SBQQ__ProrateMultiplier__c: 1.0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('3');
      expect(issues[0].affected_records).toHaveLength(3);
    });

    it('should only flag zero/null subs in a mixed set', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-Good', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 500, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
        { Id: 'sub2', Name: 'SUB-Bad', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 0, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('1');
    });

    it('should include revenue_impact in the issue', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-001', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 0, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
      ];
      const issues = await check.run(data);
      expect(issues[0]).toHaveProperty('revenue_impact');
    });
  });

  // ═══════════════════════════════════════════════
  // SR-002: Missing Prorate Multiplier
  // ═══════════════════════════════════════════════
  describe('SR-002: Missing Prorate Multiplier', () => {
    const check = getCheck('SR-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all subscriptions have positive prorate multiplier', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-001', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 1000, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
        { Id: 'sub2', Name: 'SUB-002', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 500, SBQQ__Quantity__c: 2, SBQQ__ProrateMultiplier__c: 0.5 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty subscriptions array', async () => {
      const data = createCleanData();
      data.subscriptions = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with clean data defaults', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when prorate multiplier is a fractional value', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-001', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 1000, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 0.75 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag subscription with null prorate multiplier', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-NullProrate', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 1000, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('SR-002');
      expect(issues[0].severity).toBe('warning');
    });

    it('should flag subscription with zero prorate multiplier', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-ZeroProrate', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 1000, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 0 },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('SR-002');
    });

    it('should report correct count for multiple missing prorate subs', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-001', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 1000, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: null },
        { Id: 'sub2', Name: 'SUB-002', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 500, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 0 },
        { Id: 'sub3', Name: 'SUB-003', SBQQ__Contract__c: 'c2', SBQQ__NetPrice__c: 200, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('3');
      expect(issues[0].affected_records).toHaveLength(3);
    });

    it('should only flag missing prorate in a mixed set', async () => {
      const data = createCleanData();
      data.subscriptions = [
        { Id: 'sub1', Name: 'SUB-Good', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 1000, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
        { Id: 'sub2', Name: 'SUB-Bad', SBQQ__Contract__c: 'c1', SBQQ__NetPrice__c: 500, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('1');
    });
  });
});
