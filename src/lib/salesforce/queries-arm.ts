/* eslint-disable @typescript-eslint/no-explicit-any */
import { Connection } from 'jsforce';
import type {
  ARMData,
  RLMProduct,
  RLMProductSellingModel,
  RLMProductSellingModelOption,
  RLMPriceAdjustmentSchedule,
  RLMPriceAdjustmentTier,
  RLMAttributeBasedAdjRule,
  RLMProductRelatedComponent,
  RLMPriceBook,
  RLMProductCategory,
  RLMProductCategoryProduct,
  RLMPricingProcedure,
  RLMDecisionTable,
  RLMContextDefinition,
  RLMRateCard,
  RLMRateCardEntry,
  RLMAttributeDefinition,
  RLMAttributeCategory,
  RLMAttributePicklistValue,
  RLMAsset,
  RLMAssetStatePeriod,
  RLMAssetRelationship,
  RLMContract,
  RLMContractItemPrice,
  RLMUnitOfMeasureClass,
  RLMUsageResource,
  RLMProductUsageGrant,
  RLMFulfillmentStepDefinition,
  RLMFulfillmentStepDefinitionGroup,
  RLMProductFulfillmentScenario,
  RLMFulfillmentTaskAssignmentRule,
  RLMCostBook,
  RLMCostBookEntry,
} from '@/types';

/**
 * SOQL queries against Salesforce *standard* objects exposed by Revenue Cloud
 * (a.k.a. ARM / RLM). These are NOT in the SBQQ__ or blng__ namespace —
 * Revenue Cloud is a native Salesforce platform feature, license-gated.
 *
 * Field names per the Revenue Cloud Developer Guide (Spring '26).
 * Some fields are recent additions; safeARMQuery handles INVALID_FIELD
 * by stripping the offending column and retrying.
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
 * Resilient SOQL query for ARM objects. ARM rolled out gradually — some fields
 * exist on newer orgs only — so we strip INVALID_FIELD errors and retry, and
 * return an empty result immediately if the object type doesn't exist at all.
 */
async function safeARMQuery(conn: Connection, soql: string, maxRetries = 5): Promise<any> {
  let query = soql;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(conn.query(query), 30000, 'ARM SOQL query');
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
          console.log(`[ARM] Retrying query without field: ${badField}`);
          continue;
        }
      }

      // Unrecoverable — log and return empty so the scan can continue
      console.error('[ARM] Query failed:', errorCode, errorMsg);
      return { records: [] };
    }
  }
  return { records: [] };
}

export async function fetchAllARMData(conn: Connection): Promise<ARMData> {
  const [
    productsRes,
    sellingModelsRes,
    sellingModelOptionsRes,
    priceAdjustmentSchedulesRes,
    priceAdjustmentTiersRes,
    attributeBasedAdjRulesRes,
    productRelatedComponentsRes,
    priceBooksRes,
    productCategoriesRes,
    productCategoryProductsRes,
    pricingProceduresRes,
    decisionTablesRes,
    contextDefinitionsRes,
    rateCardsRes,
    rateCardEntriesRes,
    attributeDefinitionsRes,
    attributeCategoriesRes,
    attributePicklistValuesRes,
    assetsRes,
    assetStatePeriodsRes,
    assetRelationshipsRes,
    contractsRes,
    contractItemPricesRes,
    unitOfMeasureClassesRes,
    usageResourcesRes,
    productUsageGrantsRes,
    fulfillmentStepDefinitionsRes,
    fulfillmentStepDefinitionGroupsRes,
    productFulfillmentScenariosRes,
    fulfillmentTaskAssignmentRulesRes,
    costBooksRes,
    costBookEntriesRes,
  ] = await Promise.all([
    // Products are standard Product2 — but for ARM we want active ones with
    // selling model coverage. Pull a reasonable cap to keep payload bounded.
    safeARMQuery(
      conn,
      `SELECT Id, Name, IsActive, ProductCode, Family
       FROM Product2
       WHERE IsActive = true
       LIMIT 2000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, IsActive, SellingModelType, PricingTermUnit, PricingTerm, SellingFrequencyId
       FROM ProductSellingModel
       LIMIT 500`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Product2Id, ProductSellingModelId, IsActive
       FROM ProductSellingModelOption
       LIMIT 5000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, IsActive, AdjustmentMethod, AdjustmentType
       FROM PriceAdjustmentSchedule
       LIMIT 500`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, PriceAdjustmentScheduleId, LowerBound, UpperBound, TierUnitPrice, AdjustmentValue
       FROM PriceAdjustmentTier
       LIMIT 5000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, IsActive, EffectiveStartDate, EffectiveEndDate
       FROM AttributeBasedAdjRule
       LIMIT 500`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, ParentProductId, ChildProductId, IsComponentRequired, Quantity, MinQuantity, MaxQuantity
       FROM ProductRelatedComponent
       LIMIT 5000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, IsActive, IsStandard, CurrencyIsoCode
       FROM Pricebook2
       LIMIT 200`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, IsActive, ParentCategoryId
       FROM ProductCategory
       LIMIT 500`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, ProductId, ProductCategoryId
       FROM ProductCategoryProduct
       LIMIT 5000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, IsActive, ResolutionPolicy
       FROM PricingProcedure
       LIMIT 200`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, MasterLabel, Status
       FROM DecisionTable
       LIMIT 200`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, DeveloperName, IsActive
       FROM ContextDefinition
       LIMIT 200`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, IsActive, CurrencyIsoCode, EffectiveStartDate, EffectiveEndDate
       FROM RateCard
       LIMIT 500`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, RateCardId, Product2Id, Price, CurrencyIsoCode
       FROM RateCardEntry
       LIMIT 5000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, Code, DataType, IsActive, IsRequired, DefaultValue, AttributeCategoryId
       FROM AttributeDefinition
       LIMIT 1000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, IsActive
       FROM AttributeCategory
       LIMIT 200`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, AttributeDefinitionId, Value, IsActive
       FROM AttributePicklistValue
       LIMIT 5000`
    ),
    // ── v4 queries ────────────────────────────────────────────────
    safeARMQuery(
      conn,
      `SELECT Id, Name, Status, AccountId, Product2Id, Quantity, UsageEndDate, CurrentLifecycleEndDate
       FROM Asset
       LIMIT 2000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, AssetId, StartDate, EndDate, Quantity, IsCurrent
       FROM AssetStatePeriod
       LIMIT 5000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, AssetId, RelatedAssetId, RelationshipType
       FROM AssetRelationship
       LIMIT 2000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Status, StartDate, EndDate, AccountId
       FROM Contract
       LIMIT 1000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, ContractId, Product2Id, Price, EffectiveStartDate, EffectiveEndDate
       FROM ContractItemPrice
       LIMIT 5000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, IsActive, DefaultUomId
       FROM UnitOfMeasureClass
       LIMIT 200`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, Status, UnitOfMeasureClassId, Product2Id, EffectiveEndDate
       FROM UsageResource
       LIMIT 500`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, Status, Product2Id, UsageResourceId, EffectiveStartDate, EffectiveEndDate
       FROM ProductUsageGrant
       LIMIT 1000`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, Status, FulfillmentStepDefinitionGroupId
       FROM FulfillmentStepDefinition
       LIMIT 500`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, Status
       FROM FulfillmentStepDefinitionGroup
       LIMIT 200`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, Status
       FROM ProductFulfillmentScenario
       LIMIT 200`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, Status, AssignedToId, AssignedToType
       FROM FulfillmentTaskAssignmentRule
       LIMIT 500`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, Name, IsActive, CurrencyIsoCode, IsStandard
       FROM CostBook
       LIMIT 200`
    ),
    safeARMQuery(
      conn,
      `SELECT Id, CostBookId, Product2Id, Cost, CurrencyIsoCode
       FROM CostBookEntry
       LIMIT 5000`
    ),
  ]);

  return {
    products: (productsRes.records as RLMProduct[]) || [],
    sellingModels: (sellingModelsRes.records as RLMProductSellingModel[]) || [],
    sellingModelOptions: (sellingModelOptionsRes.records as RLMProductSellingModelOption[]) || [],
    priceAdjustmentSchedules:
      (priceAdjustmentSchedulesRes.records as RLMPriceAdjustmentSchedule[]) || [],
    priceAdjustmentTiers: (priceAdjustmentTiersRes.records as RLMPriceAdjustmentTier[]) || [],
    attributeBasedAdjRules:
      (attributeBasedAdjRulesRes.records as RLMAttributeBasedAdjRule[]) || [],
    productRelatedComponents:
      (productRelatedComponentsRes.records as RLMProductRelatedComponent[]) || [],
    priceBooks: (priceBooksRes.records as RLMPriceBook[]) || [],
    productCategories: (productCategoriesRes.records as RLMProductCategory[]) || [],
    productCategoryProducts:
      (productCategoryProductsRes.records as RLMProductCategoryProduct[]) || [],
    pricingProcedures: (pricingProceduresRes.records as RLMPricingProcedure[]) || [],
    decisionTables: (decisionTablesRes.records as RLMDecisionTable[]) || [],
    contextDefinitions: (contextDefinitionsRes.records as RLMContextDefinition[]) || [],
    rateCards: (rateCardsRes.records as RLMRateCard[]) || [],
    rateCardEntries: (rateCardEntriesRes.records as RLMRateCardEntry[]) || [],
    attributeDefinitions:
      (attributeDefinitionsRes.records as RLMAttributeDefinition[]) || [],
    attributeCategories: (attributeCategoriesRes.records as RLMAttributeCategory[]) || [],
    attributePicklistValues:
      (attributePicklistValuesRes.records as RLMAttributePicklistValue[]) || [],
    // v4
    assets: (assetsRes.records as RLMAsset[]) || [],
    assetStatePeriods: (assetStatePeriodsRes.records as RLMAssetStatePeriod[]) || [],
    assetRelationships: (assetRelationshipsRes.records as RLMAssetRelationship[]) || [],
    contracts: (contractsRes.records as RLMContract[]) || [],
    contractItemPrices: (contractItemPricesRes.records as RLMContractItemPrice[]) || [],
    unitOfMeasureClasses:
      (unitOfMeasureClassesRes.records as RLMUnitOfMeasureClass[]) || [],
    usageResources: (usageResourcesRes.records as RLMUsageResource[]) || [],
    productUsageGrants: (productUsageGrantsRes.records as RLMProductUsageGrant[]) || [],
    fulfillmentStepDefinitions:
      (fulfillmentStepDefinitionsRes.records as RLMFulfillmentStepDefinition[]) || [],
    fulfillmentStepDefinitionGroups:
      (fulfillmentStepDefinitionGroupsRes.records as RLMFulfillmentStepDefinitionGroup[]) || [],
    productFulfillmentScenarios:
      (productFulfillmentScenariosRes.records as RLMProductFulfillmentScenario[]) || [],
    fulfillmentTaskAssignmentRules:
      (fulfillmentTaskAssignmentRulesRes.records as RLMFulfillmentTaskAssignmentRule[]) || [],
    costBooks: (costBooksRes.records as RLMCostBook[]) || [],
    costBookEntries: (costBookEntriesRes.records as RLMCostBookEntry[]) || [],
  };
}
