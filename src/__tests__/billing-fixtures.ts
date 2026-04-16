import type { BillingData } from '@/types';

// Helper: get current month start/end as YYYY-MM-DD
function getCurrentMonthDates() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

/**
 * Creates a minimal clean BillingData with no issues (negative test baseline).
 * All rules are active, all products are fully configured, finance books have valid periods.
 */
export function createCleanBillingData(): BillingData {
  const month = getCurrentMonthDates();

  return {
    billingRules: [
      { Id: 'br1', Name: 'Standard Billing Rule', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Product Activation Date', blng__PartialPeriodTreatment__c: 'Separate', blng__GenerateInvoices__c: 'Yes' },
      { Id: 'br2', Name: 'Usage Billing Rule', blng__Active__c: true, blng__InitialBillingTrigger__c: 'Order Activation Date', blng__PartialPeriodTreatment__c: 'Combined', blng__GenerateInvoices__c: 'Yes' },
    ],
    revRecRules: [
      { Id: 'rr1', Name: 'Standard Rev Rec', blng__Active__c: true, blng__CreateRevenueSchedule__c: 'Yes' },
    ],
    taxRules: [
      { Id: 'tr1', Name: 'Standard Tax Rule', blng__Active__c: true, blng__TaxableYesNo__c: 'Yes' },
    ],
    financeBooks: [
      {
        Id: 'fb1', Name: 'Primary Finance Book', blng__Active__c: true, blng__PeriodType__c: 'Monthly',
        blng__FinancePeriods__r: {
          totalSize: 1,
          records: [
            { Id: 'fp1', Name: 'Current Month', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: month.start, blng__PeriodEndDate__c: month.end, blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
          ],
        },
      },
    ],
    financePeriods: [
      { Id: 'fp1', Name: 'Current Month', blng__FinanceBook__c: 'fb1', blng__PeriodStartDate__c: month.start, blng__PeriodEndDate__c: month.end, blng__PeriodStatus__c: 'Open', blng__PeriodType__c: 'Monthly' },
    ],
    glRules: [
      {
        Id: 'glr1', Name: 'Standard GL Rule', blng__Active__c: true,
        blng__GLTreatments__r: { totalSize: 1, records: [{ Id: 'glt1', Name: 'Revenue Treatment', blng__Active__c: true, blng__CreditGLAccount__c: 'acc-credit-1', blng__DebitGLAccount__c: 'acc-debit-1', blng__GLRule__c: 'glr1' }] },
      },
    ],
    glTreatments: [
      { Id: 'glt1', Name: 'Revenue Treatment', blng__Active__c: true, blng__CreditGLAccount__c: 'acc-credit-1', blng__DebitGLAccount__c: 'acc-debit-1', blng__GLRule__c: 'glr1' },
    ],
    legalEntities: [
      { Id: 'le1', Name: 'Acme Corp', blng__Active__c: true, blng__Street__c: '123 Main St', blng__City__c: 'San Francisco', blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: 'United States' },
    ],
    invoices: [
      { Id: 'inv1', Name: 'INV-0001', blng__InvoiceStatus__c: 'Posted', blng__TotalAmount__c: 5000, blng__Account__c: 'acc1', blng__InvoiceDate__c: month.start, blng__DueDate__c: month.end, CreatedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
    ],
    creditNotes: [
      { Id: 'cn1', Name: 'CN-0001', blng__Status__c: 'Allocated', blng__TotalAmount__c: 500, blng__Balance__c: 0, blng__CreditNoteDate__c: month.start },
    ],
    productBillingConfigs: [
      { Id: 'pbc1', Name: 'Product Alpha', IsActive: true, blng__BillingRule__c: 'br1', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingType__c: 'Advance', SBQQ__BillingFrequency__c: 'Monthly' },
      { Id: 'pbc2', Name: 'Product Beta', IsActive: true, blng__BillingRule__c: 'br2', blng__RevenueRecognitionRule__c: 'rr1', blng__TaxRule__c: 'tr1', SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingType__c: null, SBQQ__BillingFrequency__c: null },
    ],
  };
}
