/* eslint-disable @typescript-eslint/no-explicit-any */
import { Connection } from 'jsforce';
import type {
  SFPriceRule,
  SFDiscountSchedule,
  SFProduct,
  SFProductOption,
  SFProductRule,
  SFSummaryVariable,
  SFApprovalRule,
  SFCustomScript,
  SFQuoteTemplate,
  SFConfigurationAttribute,
  SFGuidedSellingProcess,
  SFSubscription,
  SFQuote,
  SFQuoteLine,
  SFPricebookEntry,
  SFContractedPrice,
  SFCPQSettings,
  CPQData,
} from '@/types';

/**
 * Wrap a promise-like (including jsforce Query) with a timeout.
 * Rejects if not resolved within `ms` milliseconds.
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
 * Resilient SOQL query that auto-retries by stripping invalid fields.
 * Handles INVALID_FIELD errors by parsing the bad field name, removing it
 * from the SELECT clause, and retrying — up to maxRetries times.
 * Also handles INVALID_TYPE by returning empty result immediately.
 * Each query attempt has a 45-second timeout to prevent hanging.
 * Large orgs with many rules + subqueries may need the full timeout.
 */
async function safeQuery(conn: Connection, soql: string, maxRetries = 5): Promise<any> {
  let query = soql;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(conn.query(query), 45000, 'SOQL query');
    } catch (err: any) {
      const errorCode = err?.errorCode || err?.data?.errorCode || '';
      const errorMsg = err?.message || err?.data?.message || '';

      // Object doesn't exist at all — return empty
      if (errorCode === 'INVALID_TYPE') {
        return { records: [] };
      }

      // Field doesn't exist — strip it and retry
      if (errorCode === 'INVALID_FIELD' && attempt < maxRetries) {
        const fieldMatch = errorMsg.match(/No such column '([^']+)'/);
        if (fieldMatch) {
          const badField = fieldMatch[1];
          // Remove the bad field from SELECT (handle trailing comma, leading comma, standalone)
          query = query
            .replace(new RegExp(`,\\s*${badField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), '')
            .replace(new RegExp(`\\b${badField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`), '')
            .replace(new RegExp(`\\b${badField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), '');
          console.log(`Retrying query without field: ${badField}`);
          continue;
        }
      }

      // Unrecoverable error
      throw err;
    }
  }
  return { records: [] };
}

/**
 * Fetch all CPQ configuration data from a Salesforce org
 * Runs queries in parallel for speed
 */
export async function fetchAllCPQData(conn: Connection): Promise<CPQData> {
  const [
    priceRules,
    discountSchedules,
    products,
    productOptions,
    productRules,
    summaryVariables,
    approvalRules,
    customScripts,
    quoteTemplates,
    configurationAttributes,
    guidedSellingProcesses,
    subscriptions,
    quotes,
    quoteLines,
    pricebookEntries,
    contractedPrices,
    cpqSettings,
  ] = await Promise.all([
    fetchPriceRules(conn),
    fetchDiscountSchedules(conn),
    fetchProducts(conn),
    fetchProductOptions(conn),
    fetchProductRules(conn),
    fetchSummaryVariables(conn),
    fetchApprovalRules(conn),
    fetchCustomScripts(conn),
    fetchQuoteTemplates(conn),
    fetchConfigurationAttributes(conn),
    fetchGuidedSellingProcesses(conn),
    fetchSubscriptions(conn),
    fetchQuotes(conn),
    fetchQuoteLines(conn),
    fetchPricebookEntries(conn),
    fetchContractedPrices(conn),
    fetchCPQSettings(conn),
  ]);

  return {
    priceRules,
    discountSchedules,
    products,
    productOptions,
    productRules,
    summaryVariables,
    approvalRules,
    customScripts,
    quoteTemplates,
    configurationAttributes,
    guidedSellingProcesses,
    subscriptions,
    quotes,
    quoteLines,
    pricebookEntries,
    contractedPrices,
    cpqSettings,
  };
}

// ============================================
// INDIVIDUAL QUERIES
// ============================================

async function fetchPriceRules(conn: Connection): Promise<SFPriceRule[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name, SBQQ__Active__c, SBQQ__EvaluationOrder__c,
        SBQQ__TargetObject__c, SBQQ__LookupObject__c,
        (SELECT Id, SBQQ__Field__c, SBQQ__Operator__c, SBQQ__Value__c, SBQQ__Object__c
         FROM SBQQ__PriceConditions__r),
        (SELECT Id, SBQQ__Field__c, SBQQ__Value__c, SBQQ__Formula__c, SBQQ__SourceLookupField__c
         FROM SBQQ__PriceActions__r)
      FROM SBQQ__PriceRule__c
      ORDER BY SBQQ__EvaluationOrder__c ASC NULLS LAST
      LIMIT 2000
    `);
    return result.records as unknown as SFPriceRule[];
  } catch (error) {
    console.error('Error fetching price rules:', error);
    return [];
  }
}

async function fetchDiscountSchedules(conn: Connection): Promise<SFDiscountSchedule[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name, SBQQ__Type__c, SBQQ__DiscountUnit__c,
        (SELECT Id, Name, SBQQ__LowerBound__c, SBQQ__UpperBound__c, SBQQ__Discount__c
         FROM SBQQ__DiscountTiers__r
         ORDER BY SBQQ__LowerBound__c ASC)
      FROM SBQQ__DiscountSchedule__c
      LIMIT 2000
    `);
    return result.records as unknown as SFDiscountSchedule[];
  } catch (error) {
    console.error('Error fetching discount schedules:', error);
    return [];
  }
}

async function fetchProducts(conn: Connection): Promise<SFProduct[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name, ProductCode, IsActive,
        SBQQ__SubscriptionType__c, SBQQ__SubscriptionPricing__c,
        SBQQ__ChargeType__c, SBQQ__BillingFrequency__c,
        SBQQ__PricingMethod__c, SBQQ__ConfigurationType__c
      FROM Product2
      WHERE IsActive = true
      ORDER BY Name ASC
      LIMIT 5000
    `);
    return result.records as unknown as SFProduct[];
  } catch (error) {
    console.error('Error fetching products:', error);
    return [];
  }
}

async function fetchProductOptions(conn: Connection): Promise<SFProductOption[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name,
        SBQQ__ConfiguredSKU__c, SBQQ__OptionalSKU__c,
        SBQQ__ConfiguredSKU__r.Name, SBQQ__ConfiguredSKU__r.IsActive,
        SBQQ__OptionalSKU__r.Name, SBQQ__OptionalSKU__r.IsActive,
        SBQQ__Required__c, SBQQ__MinQuantity__c, SBQQ__MaxQuantity__c,
        SBQQ__Number__c, SBQQ__Feature__c, SBQQ__Feature__r.Name
      FROM SBQQ__ProductOption__c
      LIMIT 5000
    `);
    return result.records as unknown as SFProductOption[];
  } catch (error) {
    console.error('Error fetching product options:', error);
    return [];
  }
}

async function fetchProductRules(conn: Connection): Promise<SFProductRule[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name, SBQQ__Active__c, SBQQ__Type__c,
        SBQQ__EvaluationOrder__c, SBQQ__ConditionsMet__c,
        SBQQ__LookupObject__c, SBQQ__LookupProductField__c,
        (SELECT Id, SBQQ__TestedField__c, SBQQ__Operator__c, SBQQ__FilterValue__c
         FROM SBQQ__ErrorConditions__r),
        (SELECT Id, SBQQ__Type__c, SBQQ__Product__c,
                SBQQ__Product__r.Name, SBQQ__Product__r.IsActive
         FROM SBQQ__Actions__r)
      FROM SBQQ__ProductRule__c
      ORDER BY SBQQ__EvaluationOrder__c ASC NULLS LAST
      LIMIT 2000
    `);
    return result.records as unknown as SFProductRule[];
  } catch (error) {
    console.error('Error fetching product rules:', error);
    return [];
  }
}

async function fetchApprovalRules(conn: Connection): Promise<SFApprovalRule[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name, SBQQ__Active__c,
        SBQQ__ApprovalStep__c, SBQQ__Approver__c,
        SBQQ__ApproverField__c, SBQQ__ConditionsMet__c,
        SBQQ__EvaluationOrder__c, SBQQ__ApprovalChain__c,
        (SELECT Id, SBQQ__TestedField__c, SBQQ__Operator__c,
                SBQQ__Value__c, SBQQ__TestedVariable__c
         FROM SBQQ__ApprovalConditions__r)
      FROM SBQQ__ApprovalRule__c
      ORDER BY SBQQ__EvaluationOrder__c ASC NULLS LAST
      LIMIT 2000
    `);
    return result.records as unknown as SFApprovalRule[];
  } catch (error) {
    console.error('Error fetching approval rules:', error);
    return [];
  }
}

async function fetchCustomScripts(conn: Connection): Promise<SFCustomScript[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name, SBQQ__Code__c, SBQQ__Type__c,
        SBQQ__GroupFields__c, SBQQ__QuoteFields__c,
        SBQQ__QuoteLineFields__c, SBQQ__TranspiledCode__c
      FROM SBQQ__CustomScript__c
      ORDER BY Name ASC
      LIMIT 500
    `);
    return result.records as unknown as SFCustomScript[];
  } catch (error) {
    console.error('Error fetching custom scripts:', error);
    return [];
  }
}

async function fetchQuoteTemplates(conn: Connection): Promise<SFQuoteTemplate[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name, SBQQ__Default__c, SBQQ__DeploymentStatus__c,
        (SELECT Id, Name, SBQQ__Content__c
         FROM SBQQ__TemplateSections__r)
      FROM SBQQ__QuoteTemplate__c
      ORDER BY Name ASC
      LIMIT 500
    `);
    return result.records as unknown as SFQuoteTemplate[];
  } catch (error) {
    console.error('Error fetching quote templates:', error);
    return [];
  }
}

async function fetchConfigurationAttributes(conn: Connection): Promise<SFConfigurationAttribute[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name,
        SBQQ__Product__c, SBQQ__Product__r.Name,
        SBQQ__TargetField__c, SBQQ__Required__c,
        SBQQ__Hidden__c, SBQQ__DefaultField__c,
        SBQQ__ColumnOrder__c, SBQQ__DisplayOrder__c,
        SBQQ__Feature__c, SBQQ__AppliedImmediately__c
      FROM SBQQ__ConfigurationAttribute__c
      ORDER BY SBQQ__Product__r.Name, SBQQ__DisplayOrder__c ASC
      LIMIT 5000
    `);
    return result.records as unknown as SFConfigurationAttribute[];
  } catch (error) {
    console.error('Error fetching configuration attributes:', error);
    return [];
  }
}

async function fetchGuidedSellingProcesses(conn: Connection): Promise<SFGuidedSellingProcess[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name, SBQQ__Active__c,
        SBQQ__LabelPosition__c, SBQQ__Description__c
      FROM SBQQ__GuidedSellingProcess__c
      ORDER BY Name ASC
      LIMIT 500
    `);
    const processes = result.records as unknown as SFGuidedSellingProcess[];

    // Count inputs and outputs for each process
    for (const proc of processes) {
      proc.inputCount = 0;
      proc.outputCount = 0;
    }

    try {
      const inputResult = await safeQuery(conn, `
        SELECT SBQQ__GuidedSellingProcess__c, COUNT(Id) cnt
        FROM SBQQ__GuidedSellingInput__c
        GROUP BY SBQQ__GuidedSellingProcess__c
      `);
      for (const rec of inputResult.records as unknown as { SBQQ__GuidedSellingProcess__c: string; cnt: number }[]) {
        const proc = processes.find((p) => p.Id === rec.SBQQ__GuidedSellingProcess__c);
        if (proc) proc.inputCount = rec.cnt;
      }
    } catch { /* inputs object may not exist */ }

    try {
      const outputResult = await safeQuery(conn, `
        SELECT SBQQ__GuidedSellingProcess__c, COUNT(Id) cnt
        FROM SBQQ__GuidedSellingOutput__c
        GROUP BY SBQQ__GuidedSellingProcess__c
      `);
      for (const rec of outputResult.records as unknown as { SBQQ__GuidedSellingProcess__c: string; cnt: number }[]) {
        const proc = processes.find((p) => p.Id === rec.SBQQ__GuidedSellingProcess__c);
        if (proc) proc.outputCount = rec.cnt;
      }
    } catch { /* outputs object may not exist */ }

    return processes;
  } catch (error) {
    console.error('Error fetching guided selling processes:', error);
    return [];
  }
}

async function fetchSummaryVariables(conn: Connection): Promise<SFSummaryVariable[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name, SBQQ__Active__c,
        SBQQ__AggregateField__c, SBQQ__AggregateFunction__c,
        SBQQ__TargetObject__c, SBQQ__Scope__c,
        SBQQ__FilterField__c, SBQQ__FilterValue__c,
        SBQQ__Operator__c,
        SBQQ__CombineWith__c, SBQQ__SecondOperand__c,
        SBQQ__CompositeOperator__c
      FROM SBQQ__SummaryVariable__c
      ORDER BY Name ASC
      LIMIT 2000
    `);

    const variables = result.records as unknown as SFSummaryVariable[];

    // Count references from price rules and product rules
    // Price rules reference summary variables via conditions
    // Product rules reference summary variables via error conditions
    for (const v of variables) {
      v.referencedByPriceRuleCount = 0;
      v.referencedByProductRuleCount = 0;
    }

    // Check price rule conditions for summary variable references
    try {
      const priceCondResult = await safeQuery(conn, `
        SELECT SBQQ__Variable__c, COUNT(Id) cnt
        FROM SBQQ__PriceCondition__c
        WHERE SBQQ__Variable__c != null
        GROUP BY SBQQ__Variable__c
      `);
      for (const rec of priceCondResult.records as unknown as { SBQQ__Variable__c: string; cnt: number }[]) {
        const v = variables.find((sv) => sv.Id === rec.SBQQ__Variable__c);
        if (v) v.referencedByPriceRuleCount = rec.cnt;
      }
    } catch {
      // Price condition object may not exist or field may not exist
    }

    // Check product rule error conditions for summary variable references
    try {
      const prodCondResult = await safeQuery(conn, `
        SELECT SBQQ__Variable__c, COUNT(Id) cnt
        FROM SBQQ__ErrorCondition__c
        WHERE SBQQ__Variable__c != null
        GROUP BY SBQQ__Variable__c
      `);
      for (const rec of prodCondResult.records as unknown as { SBQQ__Variable__c: string; cnt: number }[]) {
        const v = variables.find((sv) => sv.Id === rec.SBQQ__Variable__c);
        if (v) v.referencedByProductRuleCount = rec.cnt;
      }
    } catch {
      // Error condition object may not exist or field may not exist
    }

    return variables;
  } catch (error) {
    console.error('Error fetching summary variables:', error);
    return [];
  }
}

async function fetchSubscriptions(conn: Connection): Promise<SFSubscription[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name,
        SBQQ__Contract__c,
        SBQQ__NetPrice__c, SBQQ__Quantity__c,
        SBQQ__ProrateMultiplier__c
      FROM SBQQ__Subscription__c
      WHERE SBQQ__TerminatedDate__c = null
      ORDER BY CreatedDate DESC
      LIMIT 2000
    `);
    return result.records as unknown as SFSubscription[];
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    return [];
  }
}

async function fetchQuotes(conn: Connection): Promise<SFQuote[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name,
        SBQQ__Type__c, SBQQ__Status__c, SBQQ__Primary__c
      FROM SBQQ__Quote__c
      WHERE CreatedDate = LAST_N_DAYS:90
      ORDER BY CreatedDate DESC
      LIMIT 500
    `);
    return result.records as unknown as SFQuote[];
  } catch (error) {
    console.error('Error fetching quotes:', error);
    return [];
  }
}

async function fetchQuoteLines(conn: Connection): Promise<SFQuoteLine[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, SBQQ__Quote__c,
        SBQQ__Product__r.Name,
        SBQQ__Quantity__c, SBQQ__NetPrice__c,
        SBQQ__NetTotal__c, SBQQ__ListPrice__c,
        SBQQ__ProrateMultiplier__c,
        SBQQ__SubscriptionPricing__c, SBQQ__ChargeType__c,
        SBQQ__Discount__c, SBQQ__AdditionalDiscount__c,
        SBQQ__UpliftAmount__c, SBQQ__Uplift__c
      FROM SBQQ__QuoteLine__c
      WHERE SBQQ__Quote__r.CreatedDate = LAST_N_DAYS:90
      ORDER BY CreatedDate DESC
      LIMIT 5000
    `);
    return result.records as unknown as SFQuoteLine[];
  } catch (error) {
    console.error('Error fetching quote lines:', error);
    return [];
  }
}

async function fetchPricebookEntries(conn: Connection): Promise<SFPricebookEntry[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Product2Id, Product2.Name,
        Pricebook2Id, UnitPrice, IsActive
      FROM PricebookEntry
      WHERE IsActive = true
      LIMIT 10000
    `);
    return result.records as unknown as SFPricebookEntry[];
  } catch (error) {
    console.error('Error fetching pricebook entries:', error);
    return [];
  }
}

async function fetchContractedPrices(conn: Connection): Promise<SFContractedPrice[]> {
  try {
    const result = await safeQuery(conn, `
      SELECT
        Id, Name,
        SBQQ__Account__c, SBQQ__Account__r.Name,
        SBQQ__Product__c, SBQQ__Product__r.Name, SBQQ__Product__r.IsActive,
        SBQQ__Price__c,
        SBQQ__EffectiveDate__c, SBQQ__ExpirationDate__c,
        SBQQ__OriginalQuoteLine__c
      FROM SBQQ__ContractedPrice__c
      ORDER BY CreatedDate DESC
      LIMIT 2000
    `);
    return result.records as unknown as SFContractedPrice[];
  } catch (error) {
    console.error('Error fetching contracted prices:', error);
    return [];
  }
}

async function fetchCPQSettings(conn: Connection): Promise<SFCPQSettings | null> {
  try {
    // Query the CPQ custom setting
    const result = await safeQuery(conn, `
      SELECT
        SBQQ__TriggerDisabled__c,
        SBQQ__RenewalModel__c,
        SBQQ__SubscriptionTermUnit__c
      FROM SBQQ__GeneralSettings__c
      LIMIT 1
    `);

    if (result.records.length === 0) return null;

    const settings = result.records[0] as Record<string, unknown>;

    // Also check for Quote Calculator Plugin
    let hasQCP = false;
    try {
      const qcpResult = await safeQuery(conn, `
        SELECT Id FROM SBQQ__CustomScript__c
        WHERE SBQQ__Type__c = 'Quote Calculator Plugin'
        LIMIT 1
      `);
      hasQCP = qcpResult.records.length > 0;
    } catch {
      // QCP object may not exist
    }

    return {
      SBQQ__TriggerDisabled__c: settings.SBQQ__TriggerDisabled__c as boolean,
      SBQQ__RenewalModel__c: settings.SBQQ__RenewalModel__c as string | undefined,
      SBQQ__SubscriptionTermUnit__c: settings.SBQQ__SubscriptionTermUnit__c as string | undefined,
      hasQuoteCalculatorPlugin: hasQCP,
    } as SFCPQSettings;
  } catch (error) {
    console.error('Error fetching CPQ settings:', error);
    return null;
  }
}
