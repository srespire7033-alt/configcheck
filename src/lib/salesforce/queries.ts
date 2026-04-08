import jsforce from 'jsforce';
import type {
  SFPriceRule,
  SFDiscountSchedule,
  SFProduct,
  SFProductOption,
  SFProductRule,
  SFSubscription,
  SFQuote,
  SFQuoteLine,
  SFPricebookEntry,
  SFCPQSettings,
  CPQData,
} from '@/types';

/**
 * Fetch all CPQ configuration data from a Salesforce org
 * Runs queries in parallel for speed
 */
export async function fetchAllCPQData(conn: jsforce.Connection): Promise<CPQData> {
  const [
    priceRules,
    discountSchedules,
    products,
    productOptions,
    productRules,
    subscriptions,
    quotes,
    quoteLines,
    pricebookEntries,
    cpqSettings,
  ] = await Promise.all([
    fetchPriceRules(conn),
    fetchDiscountSchedules(conn),
    fetchProducts(conn),
    fetchProductOptions(conn),
    fetchProductRules(conn),
    fetchSubscriptions(conn),
    fetchQuotes(conn),
    fetchQuoteLines(conn),
    fetchPricebookEntries(conn),
    fetchCPQSettings(conn),
  ]);

  return {
    priceRules,
    discountSchedules,
    products,
    productOptions,
    productRules,
    subscriptions,
    quotes,
    quoteLines,
    pricebookEntries,
    cpqSettings,
  };
}

// ============================================
// INDIVIDUAL QUERIES
// ============================================

async function fetchPriceRules(conn: jsforce.Connection): Promise<SFPriceRule[]> {
  try {
    const result = await conn.query(`
      SELECT
        Id, Name, SBQQ__Active__c, SBQQ__EvaluationOrder__c,
        SBQQ__TargetObject__c, SBQQ__LookupObject__c,
        (SELECT Id, SBQQ__Field__c, SBQQ__Operator__c, SBQQ__Value__c, SBQQ__TestedObject__c
         FROM SBQQ__PriceConditions__r),
        (SELECT Id, SBQQ__TargetField__c, SBQQ__Value__c, SBQQ__Formula__c, SBQQ__SourceLookupField__c
         FROM SBQQ__PriceActions__r)
      FROM SBQQ__PriceRule__c
      ORDER BY SBQQ__EvaluationOrder__c ASC NULLS LAST
    `);
    return result.records as unknown as SFPriceRule[];
  } catch (error) {
    console.error('Error fetching price rules:', error);
    return [];
  }
}

async function fetchDiscountSchedules(conn: jsforce.Connection): Promise<SFDiscountSchedule[]> {
  try {
    const result = await conn.query(`
      SELECT
        Id, Name, SBQQ__Type__c, SBQQ__DiscountUnit__c,
        (SELECT Id, Name, SBQQ__LowerBound__c, SBQQ__UpperBound__c, SBQQ__Discount__c
         FROM SBQQ__DiscountTiers__r
         ORDER BY SBQQ__LowerBound__c ASC)
      FROM SBQQ__DiscountSchedule__c
    `);
    return result.records as unknown as SFDiscountSchedule[];
  } catch (error) {
    console.error('Error fetching discount schedules:', error);
    return [];
  }
}

async function fetchProducts(conn: jsforce.Connection): Promise<SFProduct[]> {
  try {
    const result = await conn.query(`
      SELECT
        Id, Name, ProductCode, IsActive,
        SBQQ__SubscriptionType__c, SBQQ__SubscriptionPricing__c,
        SBQQ__ChargeType__c, SBQQ__BillingFrequency__c,
        SBQQ__PricingMethod__c
      FROM Product2
      WHERE IsActive = true
      ORDER BY Name ASC
    `);
    return result.records as unknown as SFProduct[];
  } catch (error) {
    console.error('Error fetching products:', error);
    return [];
  }
}

async function fetchProductOptions(conn: jsforce.Connection): Promise<SFProductOption[]> {
  try {
    const result = await conn.query(`
      SELECT
        Id, Name,
        SBQQ__ConfiguredSKU__c, SBQQ__OptionalSKU__c,
        SBQQ__ConfiguredSKU__r.Name, SBQQ__ConfiguredSKU__r.IsActive,
        SBQQ__OptionalSKU__r.Name, SBQQ__OptionalSKU__r.IsActive
      FROM SBQQ__ProductOption__c
    `);
    return result.records as unknown as SFProductOption[];
  } catch (error) {
    console.error('Error fetching product options:', error);
    return [];
  }
}

async function fetchProductRules(conn: jsforce.Connection): Promise<SFProductRule[]> {
  try {
    const result = await conn.query(`
      SELECT
        Id, Name, SBQQ__Active__c, SBQQ__Type__c,
        SBQQ__EvaluationOrder__c, SBQQ__ErrorConditionsMet__c,
        (SELECT Id, SBQQ__TestedField__c, SBQQ__Operator__c, SBQQ__FilterValue__c
         FROM SBQQ__ErrorConditions__r),
        (SELECT Id, SBQQ__Type__c, SBQQ__Product__c
         FROM SBQQ__ProductActions__r)
      FROM SBQQ__ProductRule__c
      ORDER BY SBQQ__EvaluationOrder__c ASC NULLS LAST
    `);
    return result.records as unknown as SFProductRule[];
  } catch (error) {
    console.error('Error fetching product rules:', error);
    return [];
  }
}

async function fetchSubscriptions(conn: jsforce.Connection): Promise<SFSubscription[]> {
  try {
    const result = await conn.query(`
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

async function fetchQuotes(conn: jsforce.Connection): Promise<SFQuote[]> {
  try {
    const result = await conn.query(`
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

async function fetchQuoteLines(conn: jsforce.Connection): Promise<SFQuoteLine[]> {
  try {
    const result = await conn.query(`
      SELECT
        Id, SBQQ__Quote__c,
        SBQQ__Product__r.Name,
        SBQQ__Quantity__c, SBQQ__NetPrice__c,
        SBQQ__NetTotal__c, SBQQ__ListPrice__c,
        SBQQ__ProrateMultiplier__c,
        SBQQ__SubscriptionPricing__c, SBQQ__ChargeType__c
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

async function fetchPricebookEntries(conn: jsforce.Connection): Promise<SFPricebookEntry[]> {
  try {
    const result = await conn.query(`
      SELECT
        Id, Product2Id, Product2.Name,
        Pricebook2Id, UnitPrice, IsActive
      FROM PricebookEntry
      WHERE IsActive = true
    `);
    return result.records as unknown as SFPricebookEntry[];
  } catch (error) {
    console.error('Error fetching pricebook entries:', error);
    return [];
  }
}

async function fetchCPQSettings(conn: jsforce.Connection): Promise<SFCPQSettings | null> {
  try {
    // Query the CPQ custom setting
    const result = await conn.query(`
      SELECT
        SBQQ__TriggerDisabled__c
      FROM SBQQ__GeneralSettings__c
      LIMIT 1
    `);

    if (result.records.length === 0) return null;

    const settings = result.records[0] as Record<string, unknown>;

    // Also check for Quote Calculator Plugin
    let hasQCP = false;
    try {
      const qcpResult = await conn.query(`
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
      hasQuoteCalculatorPlugin: hasQCP,
    } as SFCPQSettings;
  } catch (error) {
    console.error('Error fetching CPQ settings:', error);
    return null;
  }
}
