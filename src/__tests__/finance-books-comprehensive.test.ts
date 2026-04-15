import { describe, it, expect } from 'vitest';
import { financeBookChecks } from '@/lib/analysis/billing-checks/finance-books';
import { createCleanBillingData } from './billing-fixtures';

const getCheck = (id: string) => financeBookChecks.find((c) => c.id === id)!;

// Helper: "today" as the code computes it
const today = new Date().toISOString().split('T')[0];
const currentYear = new Date().getFullYear();

// Helper to build a period covering today
function periodCoveringToday(bookId = 'fb1', id = 'fp-today') {
  const start = `${today.slice(0, 8)}01`; // first of this month
  const endMonth = new Date();
  endMonth.setMonth(endMonth.getMonth() + 1, 0); // last day of this month
  const end = endMonth.toISOString().split('T')[0];
  return {
    Id: id,
    Name: 'Current Period',
    blng__FinanceBook__c: bookId,
    blng__PeriodStartDate__c: start,
    blng__PeriodEndDate__c: end,
    blng__PeriodStatus__c: 'Open' as string | null,
    blng__PeriodType__c: 'Monthly' as string | null,
  };
}

describe('Finance Books — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // FB-001: No Open Finance Period for Current Date
  // ═══════════════════════════════════════════════
  describe('FB-001: No Open Finance Period for Current Date', () => {
    const check = getCheck('FB-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when active book has an open period covering today', async () => {
      const data = createCleanBillingData();
      const p = periodCoveringToday('fb1');
      data.financeBooks = [
        {
          Id: 'fb1', Name: 'Main Book', blng__Active__c: true, blng__PeriodType__c: 'Monthly',
          blng__FinancePeriods__r: { totalSize: 1, records: [p] },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when book is inactive (skipped entirely)', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        {
          Id: 'fb1', Name: 'Inactive Book', blng__Active__c: false, blng__PeriodType__c: 'Monthly',
          blng__FinancePeriods__r: { totalSize: 1, records: [{ Id: 'fp1', Name: 'Old Period', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2020-01-01', blng__PeriodEndDate__c: '2020-01-31', blng__PeriodStatus__c: 'Closed', blng__PeriodType__c: 'Monthly' }] },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when book has no periods (not flagged by this check)', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Empty Book', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active book where all periods are Closed for today', async () => {
      const data = createCleanBillingData();
      const p = periodCoveringToday('fb1');
      p.blng__PeriodStatus__c = 'Closed';
      data.financeBooks = [
        {
          Id: 'fb1', Name: 'Main Book', blng__Active__c: true, blng__PeriodType__c: 'Monthly',
          blng__FinancePeriods__r: { totalSize: 1, records: [p] },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('FB-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records[0].id).toBe('fb1');
    });

    it('should flag active book where periods exist but none cover today', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        {
          Id: 'fb1', Name: 'Main Book', blng__Active__c: true, blng__PeriodType__c: 'Monthly',
          blng__FinancePeriods__r: {
            totalSize: 1,
            records: [
              { Id: 'fp1', Name: 'Old Period', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2020-01-01', blng__PeriodEndDate__c: '2020-12-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
            ],
          },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('FB-001');
    });

    it('should flag multiple active books each missing a current open period', async () => {
      const data = createCleanBillingData();
      const oldPeriod = (bookId: string, id: string) => ({
        Id: id, Name: 'Old', blng__FinanceBook__c: bookId,
        blng__PeriodStartDate__c: '2020-06-01', blng__PeriodEndDate__c: '2020-06-30',
        blng__PeriodStatus__c: 'Open' as string | null, blng__PeriodType__c: 'Monthly' as string | null,
      });
      data.financeBooks = [
        { Id: 'fb1', Name: 'Book A', blng__Active__c: true, blng__PeriodType__c: 'Monthly', blng__FinancePeriods__r: { totalSize: 1, records: [oldPeriod('fb1', 'fp1')] } },
        { Id: 'fb2', Name: 'Book B', blng__Active__c: true, blng__PeriodType__c: 'Monthly', blng__FinancePeriods__r: { totalSize: 1, records: [oldPeriod('fb2', 'fp2')] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues.every(i => i.check_id === 'FB-001')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // FB-002: Gaps Between Finance Periods
  // ═══════════════════════════════════════════════
  describe('FB-002: Gaps Between Finance Periods', () => {
    const check = getCheck('FB-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when periods are contiguous (no gap)', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp2', Name: 'Feb', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-02-01', blng__PeriodEndDate__c: '2026-02-28', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when there is exactly 1 day between end and next start', async () => {
      const data = createCleanBillingData();
      // End Jan 31, Start Feb 1 => diff = 1 day, not > 1
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp2', Name: 'Feb', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-02-01', blng__PeriodEndDate__c: '2026-02-28', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with a single period (no consecutive pair)', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty financePeriods', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag a gap of more than 1 day between periods', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        // Gap: Feb 1 to Feb 28 missing
        { Id: 'fp2', Name: 'Mar', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-03-01', blng__PeriodEndDate__c: '2026-03-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('FB-002');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records[0].id).toBe('fb1');
    });

    it('should flag multiple gaps in the same book', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        // Gap: entire Feb
        { Id: 'fp2', Name: 'Mar', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-03-01', blng__PeriodEndDate__c: '2026-03-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        // Gap: entire Apr
        { Id: 'fp3', Name: 'May', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-05-01', blng__PeriodEndDate__c: '2026-05-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1); // one issue per book
      expect(issues[0].description).toContain('2');
    });

    it('should flag gaps in different books separately', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Book A', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
        { Id: 'fb2', Name: 'Book B', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
      ];
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan A', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp2', Name: 'Mar A', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-03-01', blng__PeriodEndDate__c: '2026-03-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp3', Name: 'Jan B', blng__FinanceBook__c: 'fb2', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp4', Name: 'Apr B', blng__FinanceBook__c: 'fb2', blng__PeriodStartDate__c: '2026-04-01', blng__PeriodEndDate__c: '2026-04-30', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues.every(i => i.check_id === 'FB-002')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // FB-003: Overlapping Finance Periods
  // ═══════════════════════════════════════════════
  describe('FB-003: Overlapping Finance Periods', () => {
    const check = getCheck('FB-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when periods do not overlap', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp2', Name: 'Feb', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-02-01', blng__PeriodEndDate__c: '2026-02-28', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when periods in different books have same dates (no overlap per book)', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan A', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp2', Name: 'Jan B', blng__FinanceBook__c: 'fb2', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with a single period', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when periods share a boundary (currStart === prevEnd)', async () => {
      const data = createCleanBillingData();
      // Jan ends Jan 31, Feb starts Jan 31 — currStart === prevEnd, NOT < prevEnd
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp2', Name: 'Feb', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-31', blng__PeriodEndDate__c: '2026-02-28', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag overlapping periods within the same book', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-02-15', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp2', Name: 'Feb', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-02-01', blng__PeriodEndDate__c: '2026-02-28', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('FB-003');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records.length).toBeGreaterThanOrEqual(2);
    });

    it('should flag multiple overlapping pairs and dedupe affected records', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: 'P1', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-02-15', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp2', Name: 'P2', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-02-01', blng__PeriodEndDate__c: '2026-03-15', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp3', Name: 'P3', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-03-01', blng__PeriodEndDate__c: '2026-03-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1); // one issue per book
      // Records should be deduped — fp2 appears in two overlap pairs but listed once
      const ids = issues[0].affected_records.map(r => r.id);
      expect(new Set(ids).size).toBe(ids.length); // no duplicates
    });
  });

  // ═══════════════════════════════════════════════
  // FB-004: Finance Book Without Periods
  // ═══════════════════════════════════════════════
  describe('FB-004: Finance Book Without Periods', () => {
    const check = getCheck('FB-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all active books have periods in financePeriods', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Book A', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
      ];
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive book has no periods (inactive ignored)', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Active Book', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
        { Id: 'fb2', Name: 'Inactive Book', blng__Active__c: false, blng__PeriodType__c: 'Monthly' },
      ];
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty financeBooks array', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [];
      data.financePeriods = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active book with no matching financePeriods', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Book A', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
      ];
      data.financePeriods = []; // no periods at all
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('FB-004');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('fb1');
    });

    it('should flag only active books without periods, not inactive ones', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Active No Periods', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
        { Id: 'fb2', Name: 'Inactive No Periods', blng__Active__c: false, blng__PeriodType__c: 'Monthly' },
      ];
      data.financePeriods = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('fb1');
    });

    it('should flag multiple active books without periods in one issue', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Book A', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
        { Id: 'fb2', Name: 'Book B', blng__Active__c: true, blng__PeriodType__c: 'Quarterly' },
        { Id: 'fb3', Name: 'Book C (has periods)', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
      ];
      data.financePeriods = [
        { Id: 'fp1', Name: 'Jan C', blng__FinanceBook__c: 'fb3', blng__PeriodStartDate__c: '2026-01-01', blng__PeriodEndDate__c: '2026-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1); // single issue listing multiple books
      expect(issues[0].affected_records).toHaveLength(2);
      const ids = issues[0].affected_records.map(r => r.id);
      expect(ids).toContain('fb1');
      expect(ids).toContain('fb2');
      expect(ids).not.toContain('fb3');
    });
  });

  // ═══════════════════════════════════════════════
  // FB-005: Prior Year Periods Still Open
  // ═══════════════════════════════════════════════
  describe('FB-005: Prior Year Periods Still Open', () => {
    const check = getCheck('FB-005');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all open periods are in current or previous year', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: 'Current Year', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: `${currentYear}-01-01`, blng__PeriodEndDate__c: `${currentYear}-01-31`, blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp2', Name: 'Prev Year', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: `${currentYear - 1}-12-01`, blng__PeriodEndDate__c: `${currentYear - 1}-12-31`, blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when old periods are Closed', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: 'Very Old', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2020-01-01', blng__PeriodEndDate__c: '2020-01-31', blng__PeriodStatus__c: 'Closed', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty financePeriods', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag open periods with end date more than 1 year old', async () => {
      const data = createCleanBillingData();
      const oldYear = currentYear - 2;
      data.financePeriods = [
        { Id: 'fp1', Name: 'Very Old Open', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: `${oldYear}-06-01`, blng__PeriodEndDate__c: `${oldYear}-06-30`, blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('FB-005');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('fp1');
    });

    it('should flag multiple old open periods from different years', async () => {
      const data = createCleanBillingData();
      data.financePeriods = [
        { Id: 'fp1', Name: '2020 Open', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2020-01-01', blng__PeriodEndDate__c: '2020-01-31', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp2', Name: '2021 Open', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: '2021-06-01', blng__PeriodEndDate__c: '2021-06-30', blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
        { Id: 'fp3', Name: 'Current Open', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: `${currentYear}-01-01`, blng__PeriodEndDate__c: `${currentYear}-01-31`, blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1); // one issue
      expect(issues[0].affected_records).toHaveLength(2); // fp1 and fp2
    });

    it('should not flag open period from exactly previous year (boundary)', async () => {
      const data = createCleanBillingData();
      // End date year = currentYear - 1 => NOT < currentYear - 1 => not flagged
      data.financePeriods = [
        { Id: 'fp1', Name: 'Prev Year', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: `${currentYear - 1}-01-01`, blng__PeriodEndDate__c: `${currentYear - 1}-01-31`, blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  // FB-006: No Active Finance Book
  // ═══════════════════════════════════════════════
  describe('FB-006: No Active Finance Book', () => {
    const check = getCheck('FB-006');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when at least one active finance book exists', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Active Book', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when mix of active and inactive books', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Active', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
        { Id: 'fb2', Name: 'Inactive', blng__Active__c: false, blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with multiple active books', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Book A', blng__Active__c: true, blng__PeriodType__c: 'Monthly' },
        { Id: 'fb2', Name: 'Book B', blng__Active__c: true, blng__PeriodType__c: 'Quarterly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag when no finance books exist at all', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('FB-006');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].title).toBe('No finance books found');
      expect(issues[0].affected_records).toHaveLength(0);
    });

    it('should flag when all finance books are inactive', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Inactive A', blng__Active__c: false, blng__PeriodType__c: 'Monthly' },
        { Id: 'fb2', Name: 'Inactive B', blng__Active__c: false, blng__PeriodType__c: 'Quarterly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('FB-006');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].title).toBe('No active finance books');
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should include all inactive books in affected_records', async () => {
      const data = createCleanBillingData();
      data.financeBooks = [
        { Id: 'fb1', Name: 'Dead A', blng__Active__c: false, blng__PeriodType__c: 'Monthly' },
        { Id: 'fb2', Name: 'Dead B', blng__Active__c: false, blng__PeriodType__c: 'Monthly' },
        { Id: 'fb3', Name: 'Dead C', blng__Active__c: false, blng__PeriodType__c: 'Monthly' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(3);
      const ids = issues[0].affected_records.map(r => r.id);
      expect(ids).toEqual(['fb1', 'fb2', 'fb3']);
    });
  });
});
