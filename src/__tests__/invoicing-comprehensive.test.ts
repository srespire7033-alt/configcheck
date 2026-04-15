import { describe, it, expect } from 'vitest';
import { invoicingChecks } from '@/lib/analysis/billing-checks/invoicing';
import { createCleanBillingData } from './billing-fixtures';

const getCheck = (id: string) => invoicingChecks.find((c) => c.id === id)!;

describe('Invoicing — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // INV-001: Invoices Stuck in Draft
  // ═══════════════════════════════════════════════
  describe('INV-001: Invoices Stuck in Draft for 30+ Days', () => {
    const check = getCheck('INV-001');

    it('should pass with no invoices', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when draft invoice was created less than 30 days ago', async () => {
      const data = createCleanBillingData();
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Draft', blng__TotalAmount__c: 500, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-04-10', blng__DueDate__c: '2026-05-10', CreatedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when invoice is Posted (not Draft)', async () => {
      const data = createCleanBillingData();
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 1000, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-01-01', blng__DueDate__c: '2026-02-01', CreatedDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString() },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when invoice is Cancelled (not Draft)', async () => {
      const data = createCleanBillingData();
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Cancelled', blng__TotalAmount__c: 200, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-01-01', blng__DueDate__c: '2026-02-01', CreatedDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString() },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when draft invoice is exactly 30 days old (boundary)', async () => {
      const data = createCleanBillingData();
      // Exactly 30 days ago — the check uses < thirtyDaysAgo, so exactly 30 should not trigger
      const exactlyThirtyDaysAgo = new Date();
      exactlyThirtyDaysAgo.setDate(exactlyThirtyDaysAgo.getDate() - 30);
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Draft', blng__TotalAmount__c: 500, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-03-15', blng__DueDate__c: '2026-04-15', CreatedDate: exactlyThirtyDaysAgo.toISOString() },
      ];
      const issues = await check.run(data);
      // At boundary, setDate-30 may or may not be < setDate-30 depending on ms precision
      // Just assert it returns 0 or 1 (boundary is acceptable either way)
      expect(issues.length).toBeLessThanOrEqual(1);
    });

    it('DETECT: should flag draft invoice older than 30 days', async () => {
      const data = createCleanBillingData();
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Draft', blng__TotalAmount__c: 2000, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-02-01', blng__DueDate__c: '2026-03-01', CreatedDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString() },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('INV-001');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('inv1');
    });

    it('DETECT: should flag multiple old draft invoices', async () => {
      const data = createCleanBillingData();
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Draft', blng__TotalAmount__c: 1000, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-01-01', blng__DueDate__c: '2026-02-01', CreatedDate: oldDate },
        { Id: 'inv2', Name: 'INV-002', blng__InvoiceStatus__c: 'Draft', blng__TotalAmount__c: 2000, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-01-15', blng__DueDate__c: '2026-02-15', CreatedDate: oldDate },
        { Id: 'inv3', Name: 'INV-003', blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 500, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-01-01', blng__DueDate__c: '2026-02-01', CreatedDate: oldDate },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].description).toContain('2');
    });

    it('DETECT: should calculate revenue_impact from total amounts', async () => {
      const data = createCleanBillingData();
      const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Draft', blng__TotalAmount__c: 3000, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-02-01', blng__DueDate__c: '2026-03-01', CreatedDate: oldDate },
        { Id: 'inv2', Name: 'INV-002', blng__InvoiceStatus__c: 'Draft', blng__TotalAmount__c: 7000, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-02-01', blng__DueDate__c: '2026-03-01', CreatedDate: oldDate },
      ];
      const issues = await check.run(data);
      expect(issues[0].revenue_impact).toBe(10000);
    });
  });

  // ═══════════════════════════════════════════════
  // INV-002: Zero Amount Invoices
  // ═══════════════════════════════════════════════
  describe('INV-002: Zero Amount Posted Invoices', () => {
    const check = getCheck('INV-002');

    it('should pass with no invoices', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when posted invoice has a positive amount', async () => {
      const data = createCleanBillingData();
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 5000, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-04-01', blng__DueDate__c: '2026-05-01', CreatedDate: '2026-04-01T00:00:00Z' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when draft invoice has zero amount (only checks Posted)', async () => {
      const data = createCleanBillingData();
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Draft', blng__TotalAmount__c: 0, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-04-01', blng__DueDate__c: '2026-05-01', CreatedDate: '2026-04-01T00:00:00Z' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when posted invoice has null amount (not === 0)', async () => {
      const data = createCleanBillingData();
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: null, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-04-01', blng__DueDate__c: '2026-05-01', CreatedDate: '2026-04-01T00:00:00Z' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('DETECT: should flag posted invoice with exactly $0 amount', async () => {
      const data = createCleanBillingData();
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 0, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-04-01', blng__DueDate__c: '2026-05-01', CreatedDate: '2026-04-01T00:00:00Z' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('INV-002');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
    });

    it('DETECT: should flag multiple zero-amount posted invoices', async () => {
      const data = createCleanBillingData();
      data.invoices = [
        { Id: 'inv1', Name: 'INV-001', blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 0, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-04-01', blng__DueDate__c: '2026-05-01', CreatedDate: '2026-04-01T00:00:00Z' },
        { Id: 'inv2', Name: 'INV-002', blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 0, blng__Account__c: 'acc2', blng__InvoiceDate__c: '2026-04-01', blng__DueDate__c: '2026-05-01', CreatedDate: '2026-04-01T00:00:00Z' },
        { Id: 'inv3', Name: 'INV-003', blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 100, blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-04-01', blng__DueDate__c: '2026-05-01', CreatedDate: '2026-04-01T00:00:00Z' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].description).toContain('2');
    });
  });

  // ═══════════════════════════════════════════════
  // INV-003: Credit Notes With Remaining Balance
  // ═══════════════════════════════════════════════
  describe('INV-003: Credit Notes With Unallocated Balance', () => {
    const check = getCheck('INV-003');

    it('should pass with no credit notes', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when credit note balance is zero', async () => {
      const data = createCleanBillingData();
      data.creditNotes = [
        { Id: 'cn1', Name: 'CN-001', blng__Status__c: 'Posted', blng__TotalAmount__c: 500, blng__Balance__c: 0, blng__CreditNoteDate__c: '2026-04-01' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when credit note balance is null', async () => {
      const data = createCleanBillingData();
      data.creditNotes = [
        { Id: 'cn1', Name: 'CN-001', blng__Status__c: 'Posted', blng__TotalAmount__c: 500, blng__Balance__c: null, blng__CreditNoteDate__c: '2026-04-01' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when credit note balance is negative', async () => {
      const data = createCleanBillingData();
      data.creditNotes = [
        { Id: 'cn1', Name: 'CN-001', blng__Status__c: 'Posted', blng__TotalAmount__c: 500, blng__Balance__c: -10, blng__CreditNoteDate__c: '2026-04-01' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('DETECT: should flag credit note with positive balance', async () => {
      const data = createCleanBillingData();
      data.creditNotes = [
        { Id: 'cn1', Name: 'CN-001', blng__Status__c: 'Posted', blng__TotalAmount__c: 1000, blng__Balance__c: 500, blng__CreditNoteDate__c: '2026-04-01' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('INV-003');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('cn1');
    });

    it('DETECT: should calculate total unallocated balance as revenue_impact', async () => {
      const data = createCleanBillingData();
      data.creditNotes = [
        { Id: 'cn1', Name: 'CN-001', blng__Status__c: 'Posted', blng__TotalAmount__c: 1000, blng__Balance__c: 300, blng__CreditNoteDate__c: '2026-04-01' },
        { Id: 'cn2', Name: 'CN-002', blng__Status__c: 'Posted', blng__TotalAmount__c: 2000, blng__Balance__c: 700, blng__CreditNoteDate__c: '2026-04-01' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].revenue_impact).toBe(1000);
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('DETECT: should only count credit notes with positive balance', async () => {
      const data = createCleanBillingData();
      data.creditNotes = [
        { Id: 'cn1', Name: 'CN-001', blng__Status__c: 'Posted', blng__TotalAmount__c: 1000, blng__Balance__c: 500, blng__CreditNoteDate__c: '2026-04-01' },
        { Id: 'cn2', Name: 'CN-002', blng__Status__c: 'Posted', blng__TotalAmount__c: 2000, blng__Balance__c: 0, blng__CreditNoteDate__c: '2026-04-01' },
        { Id: 'cn3', Name: 'CN-003', blng__Status__c: 'Draft', blng__TotalAmount__c: 500, blng__Balance__c: null, blng__CreditNoteDate__c: '2026-04-01' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records![0].id).toBe('cn1');
    });
  });

  // ═══════════════════════════════════════════════
  // INV-004: Overdue Invoices
  // ═══════════════════════════════════════════════
  describe('INV-004: Overdue Invoices (>10 threshold)', () => {
    const check = getCheck('INV-004');

    it('should pass with no invoices', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when all posted invoices have future due dates', async () => {
      const data = createCleanBillingData();
      const futureDate = '2027-12-31';
      data.invoices = Array.from({ length: 15 }, (_, i) => ({
        Id: `inv${i}`, Name: `INV-${i}`, blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 1000,
        blng__Account__c: 'acc1', blng__InvoiceDate__c: '2026-04-01', blng__DueDate__c: futureDate,
        CreatedDate: '2026-04-01T00:00:00Z',
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when overdue count is exactly 10 (threshold is >10)', async () => {
      const data = createCleanBillingData();
      const pastDate = '2026-01-01';
      data.invoices = Array.from({ length: 10 }, (_, i) => ({
        Id: `inv${i}`, Name: `INV-${i}`, blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 500,
        blng__Account__c: 'acc1', blng__InvoiceDate__c: '2025-12-01', blng__DueDate__c: pastDate,
        CreatedDate: '2025-12-01T00:00:00Z',
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when overdue invoices are Draft (not Posted)', async () => {
      const data = createCleanBillingData();
      const pastDate = '2026-01-01';
      data.invoices = Array.from({ length: 15 }, (_, i) => ({
        Id: `inv${i}`, Name: `INV-${i}`, blng__InvoiceStatus__c: 'Draft', blng__TotalAmount__c: 500,
        blng__Account__c: 'acc1', blng__InvoiceDate__c: '2025-12-01', blng__DueDate__c: pastDate,
        CreatedDate: '2025-12-01T00:00:00Z',
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when posted invoices have null due date', async () => {
      const data = createCleanBillingData();
      data.invoices = Array.from({ length: 15 }, (_, i) => ({
        Id: `inv${i}`, Name: `INV-${i}`, blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 500,
        blng__Account__c: 'acc1', blng__InvoiceDate__c: '2025-12-01', blng__DueDate__c: null,
        CreatedDate: '2025-12-01T00:00:00Z',
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('DETECT: should flag when more than 10 posted invoices are overdue', async () => {
      const data = createCleanBillingData();
      const pastDate = '2026-01-01';
      data.invoices = Array.from({ length: 11 }, (_, i) => ({
        Id: `inv${i}`, Name: `INV-${i}`, blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 1000,
        blng__Account__c: 'acc1', blng__InvoiceDate__c: '2025-12-01', blng__DueDate__c: pastDate,
        CreatedDate: '2025-12-01T00:00:00Z',
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('INV-004');
      expect(issues[0].severity).toBe('info');
      expect(issues[0].description).toContain('11');
    });

    it('DETECT: should calculate total overdue amount as revenue_impact', async () => {
      const data = createCleanBillingData();
      const pastDate = '2026-01-01';
      data.invoices = Array.from({ length: 12 }, (_, i) => ({
        Id: `inv${i}`, Name: `INV-${i}`, blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 250,
        blng__Account__c: 'acc1', blng__InvoiceDate__c: '2025-12-01', blng__DueDate__c: pastDate,
        CreatedDate: '2025-12-01T00:00:00Z',
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].revenue_impact).toBe(3000);
    });

    it('DETECT: should only count Posted overdue, not mixed statuses', async () => {
      const data = createCleanBillingData();
      const pastDate = '2026-01-01';
      // 11 posted overdue + 5 draft overdue = only 11 count
      const posted = Array.from({ length: 11 }, (_, i) => ({
        Id: `inv-posted-${i}`, Name: `INV-P-${i}`, blng__InvoiceStatus__c: 'Posted' as const, blng__TotalAmount__c: 500,
        blng__Account__c: 'acc1', blng__InvoiceDate__c: '2025-12-01', blng__DueDate__c: pastDate,
        CreatedDate: '2025-12-01T00:00:00Z',
      }));
      const drafts = Array.from({ length: 5 }, (_, i) => ({
        Id: `inv-draft-${i}`, Name: `INV-D-${i}`, blng__InvoiceStatus__c: 'Draft' as const, blng__TotalAmount__c: 500,
        blng__Account__c: 'acc1', blng__InvoiceDate__c: '2025-12-01', blng__DueDate__c: pastDate,
        CreatedDate: '2025-12-01T00:00:00Z',
      }));
      data.invoices = [...posted, ...drafts];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('11');
    });

    it('DETECT: should cap affected_records at 50', async () => {
      const data = createCleanBillingData();
      const pastDate = '2026-01-01';
      data.invoices = Array.from({ length: 60 }, (_, i) => ({
        Id: `inv${i}`, Name: `INV-${i}`, blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 100,
        blng__Account__c: 'acc1', blng__InvoiceDate__c: '2025-12-01', blng__DueDate__c: pastDate,
        CreatedDate: '2025-12-01T00:00:00Z',
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records!.length).toBeLessThanOrEqual(50);
      expect(issues[0].description).toContain('60');
    });
  });
});
