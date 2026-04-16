/* eslint-disable @typescript-eslint/no-explicit-any */
import { Connection } from 'jsforce';
import type {
  SFBillingRule,
  SFRevRecRule,
  SFTaxRule,
  SFFinanceBook,
  SFFinancePeriod,
  SFGLRule,
  SFGLTreatment,
  SFLegalEntity,
  SFBillingInvoice,
  SFCreditNote,
  SFProductBillingFields,
  BillingData,
} from '@/types';

/**
 * Wrap a promise-like (including jsforce Query) with a timeout.
 */
function withTimeout<T>(promiseLike: PromiseLike<T>, ms: number, label = 'Operation'): Promise<T> {
  return Promise.race([
    Promise.resolve(promiseLike),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/**
 * Resilient SOQL query with auto-retry for invalid fields and timeout.
 */
async function safeQuery(conn: Connection, soql: string, maxRetries = 5): Promise<any> {
  let query = soql;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(conn.query(query), 45000, 'SOQL query');
    } catch (err: any) {
      const errorCode = err?.errorCode || err?.data?.errorCode || '';
      const errorMsg = err?.message || err?.data?.message || '';

      if (errorCode === 'INVALID_TYPE') {
        return { records: [] };
      }

      if (errorCode === 'INVALID_FIELD' && attempt < maxRetries) {
        const fieldMatch = errorMsg.match(/No such column '([^']+)'/);
        if (fieldMatch) {
          const badField = fieldMatch[1];
          query = query
            .replace(new RegExp(`,\\s*${badField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), '')
            .replace(new RegExp(`\\b${badField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`), '')
            .replace(new RegExp(`\\b${badField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), '');
          console.log(`[BILLING] Retrying query without field: ${badField}`);
          continue;
        }
      }

      throw err;
    }
  }
  return { records: [] };
}

// ============================================
// BILLING PACKAGE DETECTION
// ============================================

/**
 * Check if the Salesforce Billing (blng) package is installed.
 * Attempts to describe blng__BillingRule__c — if it exists, billing is installed.
 */
export async function isBillingPackageInstalled(conn: Connection): Promise<boolean> {
  try {
    await withTimeout(conn.describe('blng__BillingRule__c'), 15000, 'Billing package check');
    return true;
  } catch {
    return false;
  }
}

// ============================================
// INDIVIDUAL FETCH FUNCTIONS
// ============================================

async function fetchBillingRules(conn: Connection): Promise<SFBillingRule[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT Id, Name, blng__Active__c,
        blng__InitialBillingTrigger__c, blng__PartialPeriodTreatment__c,
        blng__GenerateInvoices__c
      FROM blng__BillingRule__c
      ORDER BY Name
      LIMIT 2000
    `);
    return result.records as SFBillingRule[];
  } catch (error) {
    console.error('Error fetching billing rules:', error);
    return [];
  }
}

async function fetchRevRecRules(conn: Connection): Promise<SFRevRecRule[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT Id, Name, blng__Active__c,
        blng__CreateRevenueSchedule__c
      FROM blng__RevenueRecognitionRule__c
      ORDER BY Name
      LIMIT 2000
    `);
    return result.records as SFRevRecRule[];
  } catch (error) {
    console.error('Error fetching rev rec rules:', error);
    return [];
  }
}

async function fetchTaxRules(conn: Connection): Promise<SFTaxRule[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT Id, Name, blng__Active__c,
        blng__TaxableYesNo__c
      FROM blng__TaxRule__c
      ORDER BY Name
      LIMIT 2000
    `);
    return result.records as SFTaxRule[];
  } catch (error) {
    console.error('Error fetching tax rules:', error);
    return [];
  }
}

async function fetchFinanceBooks(conn: Connection): Promise<SFFinanceBook[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT Id, Name, blng__Active__c, blng__PeriodType__c,
        (SELECT Id, Name, blng__PeriodStartDate__c, blng__PeriodEndDate__c,
          blng__PeriodStatus__c, blng__PeriodType__c
         FROM blng__FinancePeriods__r
         ORDER BY blng__PeriodStartDate__c
         LIMIT 200)
      FROM blng__FinanceBook__c
      ORDER BY Name
      LIMIT 500
    `);
    return result.records as SFFinanceBook[];
  } catch (error) {
    console.error('Error fetching finance books:', error);
    return [];
  }
}

async function fetchFinancePeriods(conn: Connection): Promise<SFFinancePeriod[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT Id, Name, blng__FinanceBook__c,
        blng__PeriodStartDate__c, blng__PeriodEndDate__c,
        blng__PeriodStatus__c, blng__PeriodType__c
      FROM blng__FinancePeriod__c
      ORDER BY blng__PeriodStartDate__c
      LIMIT 5000
    `);
    return result.records as SFFinancePeriod[];
  } catch (error) {
    console.error('Error fetching finance periods:', error);
    return [];
  }
}

async function fetchGLRules(conn: Connection): Promise<SFGLRule[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT Id, Name, blng__Active__c,
        (SELECT Id, Name, blng__Active__c,
          blng__CreditGLAccount__c, blng__DebitGLAccount__c, blng__GLRule__c,
          blng__CreditGLAccount__r.Name, blng__DebitGLAccount__r.Name
         FROM blng__GLTreatments__r
         LIMIT 200)
      FROM blng__GLRule__c
      ORDER BY Name
      LIMIT 1000
    `);
    return result.records as SFGLRule[];
  } catch (error) {
    console.error('Error fetching GL rules:', error);
    return [];
  }
}

async function fetchGLTreatments(conn: Connection): Promise<SFGLTreatment[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT Id, Name, blng__Active__c,
        blng__CreditGLAccount__c, blng__DebitGLAccount__c, blng__GLRule__c,
        blng__CreditGLAccount__r.Name, blng__DebitGLAccount__r.Name
      FROM blng__GLTreatment__c
      ORDER BY Name
      LIMIT 2000
    `);
    return result.records as SFGLTreatment[];
  } catch (error) {
    console.error('Error fetching GL treatments:', error);
    return [];
  }
}

async function fetchLegalEntities(conn: Connection): Promise<SFLegalEntity[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT Id, Name, blng__Active__c,
        blng__Street__c, blng__City__c, blng__State__c,
        blng__PostalCode__c, blng__Country__c
      FROM blng__LegalEntity__c
      ORDER BY Name
      LIMIT 500
    `);
    return result.records as SFLegalEntity[];
  } catch (error) {
    console.error('Error fetching legal entities:', error);
    return [];
  }
}

async function fetchInvoices(conn: Connection): Promise<SFBillingInvoice[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT Id, Name, blng__InvoiceStatus__c, blng__TotalAmount__c,
        blng__Account__c, blng__InvoiceDate__c, blng__DueDate__c, CreatedDate
      FROM blng__Invoice__c
      ORDER BY CreatedDate DESC
      LIMIT 5000
    `);
    return result.records as SFBillingInvoice[];
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return [];
  }
}

async function fetchCreditNotes(conn: Connection): Promise<SFCreditNote[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT Id, Name, blng__Status__c, blng__TotalAmount__c,
        blng__Balance__c, blng__CreditNoteDate__c
      FROM blng__CreditNote__c
      ORDER BY blng__CreditNoteDate__c DESC
      LIMIT 2000
    `);
    return result.records as SFCreditNote[];
  } catch (error) {
    console.error('Error fetching credit notes:', error);
    return [];
  }
}

async function fetchProductBillingConfigs(conn: Connection): Promise<SFProductBillingFields[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT Id, Name, IsActive,
        blng__BillingRule__c, blng__RevenueRecognitionRule__c, blng__TaxRule__c,
        SBQQ__ChargeType__c, SBQQ__BillingType__c, SBQQ__BillingFrequency__c,
        blng__BillingRule__r.Name, blng__BillingRule__r.blng__Active__c,
        blng__RevenueRecognitionRule__r.Name, blng__RevenueRecognitionRule__r.blng__Active__c,
        blng__TaxRule__r.Name, blng__TaxRule__r.blng__Active__c
      FROM Product2
      WHERE IsActive = true
      ORDER BY Name
      LIMIT 5000
    `);
    return result.records as SFProductBillingFields[];
  } catch (error) {
    console.error('Error fetching product billing configs:', error);
    return [];
  }
}

// ============================================
// MAIN FETCH FUNCTION
// ============================================

/**
 * Fetch all Salesforce Billing configuration data.
 * Runs queries in parallel for speed.
 */
export async function fetchAllBillingData(conn: Connection): Promise<BillingData> {
  console.log('[BILLING] Fetching all billing configuration data...');

  const [
    billingRules,
    revRecRules,
    taxRules,
    financeBooks,
    financePeriods,
    glRules,
    glTreatments,
    legalEntities,
    invoices,
    creditNotes,
    productBillingConfigs,
  ] = await Promise.all([
    fetchBillingRules(conn),
    fetchRevRecRules(conn),
    fetchTaxRules(conn),
    fetchFinanceBooks(conn),
    fetchFinancePeriods(conn),
    fetchGLRules(conn),
    fetchGLTreatments(conn),
    fetchLegalEntities(conn),
    fetchInvoices(conn),
    fetchCreditNotes(conn),
    fetchProductBillingConfigs(conn),
  ]);

  console.log(`[BILLING] Data fetched: ${billingRules.length} billing rules, ${revRecRules.length} rev rec rules, ${taxRules.length} tax rules, ${financeBooks.length} finance books, ${financePeriods.length} finance periods, ${glRules.length} GL rules, ${glTreatments.length} GL treatments, ${legalEntities.length} legal entities, ${invoices.length} invoices, ${creditNotes.length} credit notes, ${productBillingConfigs.length} products`);

  return {
    billingRules,
    revRecRules,
    taxRules,
    financeBooks,
    financePeriods,
    glRules,
    glTreatments,
    legalEntities,
    invoices,
    creditNotes,
    productBillingConfigs,
  };
}
