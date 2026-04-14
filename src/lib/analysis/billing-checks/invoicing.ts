import type { BillingData, BillingHealthCheck, Issue } from '@/types';

export const invoicingChecks: BillingHealthCheck[] = [
  {
    id: 'INV-001',
    name: 'Invoices Stuck in Draft',
    category: 'invoicing',
    severity: 'warning',
    description: 'Finds invoices in Draft status for more than 30 days',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const stuckDrafts = data.invoices.filter(inv => {
        if (inv.blng__InvoiceStatus__c !== 'Draft') return false;
        const createdDate = new Date(inv.CreatedDate);
        return createdDate < thirtyDaysAgo;
      });

      if (stuckDrafts.length > 0) {
        issues.push({
          check_id: 'INV-001',
          category: 'invoicing',
          severity: 'warning',
          title: 'Invoices stuck in Draft for 30+ days',
          description: `${stuckDrafts.length} invoice(s) have been in Draft status for more than 30 days. These need to be posted or cancelled.`,
          impact: 'Revenue is not being recognized and customers have not been billed. Cash flow is impacted.',
          recommendation: 'Review and post draft invoices, or cancel them if they are no longer needed.',
          affected_records: stuckDrafts.slice(0, 50).map(inv => ({
            id: inv.Id,
            name: inv.Name,
            type: 'blng__Invoice__c',
          })),
          revenue_impact: stuckDrafts.reduce((sum, inv) => sum + (inv.blng__TotalAmount__c || 0), 0),
          effort_hours: Math.ceil(stuckDrafts.length / 20) + 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'INV-002',
    name: 'Zero Amount Invoices',
    category: 'invoicing',
    severity: 'warning',
    description: 'Finds posted invoices with $0 total amount',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const zeroInvoices = data.invoices.filter(
        inv => inv.blng__InvoiceStatus__c === 'Posted' && inv.blng__TotalAmount__c === 0
      );

      if (zeroInvoices.length > 0) {
        issues.push({
          check_id: 'INV-002',
          category: 'invoicing',
          severity: 'warning',
          title: 'Posted invoices with $0 amount',
          description: `${zeroInvoices.length} posted invoice(s) have a $0 total. This may indicate duplicate or erroneous invoice generation.`,
          impact: 'Clutters financial records and may indicate underlying billing configuration issues.',
          recommendation: 'Investigate why $0 invoices were generated. Check billing rules and order product configuration.',
          affected_records: zeroInvoices.slice(0, 50).map(inv => ({
            id: inv.Id,
            name: inv.Name,
            type: 'blng__Invoice__c',
          })),
          effort_hours: Math.ceil(zeroInvoices.length / 20) + 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'INV-003',
    name: 'Credit Notes With Remaining Balance',
    category: 'invoicing',
    severity: 'warning',
    description: 'Finds credit notes that have not been fully allocated',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const unallocated = data.creditNotes.filter(
        cn => cn.blng__Balance__c && cn.blng__Balance__c > 0
      );

      if (unallocated.length > 0) {
        const totalBalance = unallocated.reduce((sum, cn) => sum + (cn.blng__Balance__c || 0), 0);
        issues.push({
          check_id: 'INV-003',
          category: 'invoicing',
          severity: 'warning',
          title: 'Credit notes with unallocated balance',
          description: `${unallocated.length} credit note(s) have unallocated balance totaling $${totalBalance.toLocaleString()}. These credits have not been applied to invoices.`,
          impact: 'Customers may be overpaying while credits sit unused, affecting customer satisfaction and AR accuracy.',
          recommendation: 'Apply credit note balances to outstanding invoices or issue refunds.',
          affected_records: unallocated.slice(0, 50).map(cn => ({
            id: cn.Id,
            name: cn.Name,
            type: 'blng__CreditNote__c',
          })),
          revenue_impact: totalBalance,
          effort_hours: Math.ceil(unallocated.length / 10) + 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'INV-004',
    name: 'Overdue Invoices',
    category: 'invoicing',
    severity: 'info',
    description: 'Reports on invoices past their due date',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const today = new Date().toISOString().split('T')[0];

      const overdue = data.invoices.filter(inv =>
        inv.blng__InvoiceStatus__c === 'Posted' &&
        inv.blng__DueDate__c &&
        inv.blng__DueDate__c < today
      );

      if (overdue.length > 10) {
        const totalOverdue = overdue.reduce((sum, inv) => sum + (inv.blng__TotalAmount__c || 0), 0);
        issues.push({
          check_id: 'INV-004',
          category: 'invoicing',
          severity: 'info',
          title: 'Significant number of overdue invoices',
          description: `${overdue.length} posted invoice(s) are past their due date, totaling $${totalOverdue.toLocaleString()}.`,
          impact: 'High volume of overdue invoices may indicate collection process issues or billing timing problems.',
          recommendation: 'Review accounts receivable processes and consider automating payment reminders.',
          affected_records: overdue.slice(0, 50).map(inv => ({
            id: inv.Id,
            name: inv.Name,
            type: 'blng__Invoice__c',
          })),
          revenue_impact: totalOverdue,
          effort_hours: 4,
        });
      }

      return issues;
    },
  },
];
