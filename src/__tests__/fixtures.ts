import type { CPQData } from '@/types';

/**
 * Creates a minimal clean CPQData with no issues (negative test baseline)
 */
export function createCleanData(): CPQData {
  return {
    priceRules: [
      { Id: 'pr1', Name: 'Standard Pricing', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [{ Id: 'pc1', SBQQ__Field__c: 'SBQQ__ProductCode__c', SBQQ__Operator__c: 'equals', SBQQ__Value__c: 'PREM', SBQQ__Object__c: 'Quote Line' }] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] } },
      { Id: 'pr2', Name: 'Volume Pricing', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 20, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null, SBQQ__PriceConditions__r: { records: [{ Id: 'pc2', SBQQ__Field__c: 'SBQQ__Quantity__c', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '100', SBQQ__Object__c: 'Quote Line' }] }, SBQQ__PriceActions__r: { records: [{ Id: 'pa2', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: null, SBQQ__Formula__c: 'SBQQ__ListPrice__c * 0.9', SBQQ__SourceLookupField__c: null }] } },
    ],
    discountSchedules: [
      { Id: 'ds1', Name: 'Volume Discount', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [{ Id: 'dt1', Name: 'Tier 1', SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 5 }, { Id: 'dt2', Name: 'Tier 2', SBQQ__LowerBound__c: 100, SBQQ__UpperBound__c: 500, SBQQ__Discount__c: 10 }] } },
    ],
    products: [
      { Id: 'p1', Name: 'Product A', ProductCode: 'PROD-A', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      { Id: 'p2', Name: 'Product B', ProductCode: 'PROD-B', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      { Id: 'p3', Name: 'Product C', ProductCode: 'PROD-C', IsActive: true, SBQQ__SubscriptionType__c: 'Renewable', SBQQ__SubscriptionPricing__c: 'Fixed Price', SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: 'Monthly', SBQQ__PricingMethod__c: 'List' },
    ],
    productOptions: [
      { Id: 'po1', Name: 'Bundle Opt 1', SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2', SBQQ__ConfiguredSKU__r: { Name: 'Product A', IsActive: true }, SBQQ__OptionalSKU__r: { Name: 'Product B', IsActive: true } },
    ],
    productRules: [
      { Id: 'prd1', Name: 'Validation Rule', SBQQ__Active__c: true, SBQQ__Type__c: 'Validation', SBQQ__EvaluationOrder__c: 10, SBQQ__ConditionsMet__c: 'All', SBQQ__ErrorConditions__r: { records: [{ Id: 'ec1', SBQQ__TestedField__c: 'SBQQ__Quantity__c', SBQQ__Operator__c: 'greater than', SBQQ__FilterValue__c: '0' }] }, SBQQ__Actions__r: { records: [] } },
    ],
    summaryVariables: [
      { Id: 'sv1', Name: 'Total Quantity', SBQQ__Active__c: true, SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum', SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote', SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null, SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null, referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0 },
    ],
    approvalRules: [
      { Id: 'ar1', Name: 'Discount Approval', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'manager@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [{ Id: 'ac1', SBQQ__TestedField__c: 'SBQQ__Discount__c', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '20', SBQQ__TestedVariable__c: null }] } },
    ],
    customScripts: [
      { Id: 'cs1', Name: 'QCP Main', SBQQ__Code__c: 'export function onAfterCalculate(quote, lines) { return lines; }', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: 'SBQQ__NetAmount__c', SBQQ__QuoteLineFields__c: 'SBQQ__NetPrice__c', SBQQ__TranspiledCode__c: 'compiled code here' },
    ],
    quoteTemplates: [
      { Id: 'qt1', Name: 'Standard Template', SBQQ__Default__c: true, SBQQ__Status__c: 'Active', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Header', SBQQ__Content__c: '<h1>Quote</h1>' }] } },
    ],
    configurationAttributes: [
      { Id: 'ca1', Name: 'Color', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__TargetField__c: 'Color__c', SBQQ__Required__c: false, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: null, SBQQ__ColumnOrder__c: 1, SBQQ__DisplayOrder__c: 1, SBQQ__Feature__c: null, SBQQ__AppliedImmediately__c: false },
    ],
    guidedSellingProcesses: [
      { Id: 'gs1', Name: 'Product Finder', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: 'Helps find the right product', inputCount: 3, outputCount: 2 },
    ],
    subscriptions: [
      { Id: 'sub1', Name: 'SUB-001', SBQQ__Contract__c: 'contract1', SBQQ__NetPrice__c: 1000, SBQQ__Quantity__c: 1, SBQQ__ProrateMultiplier__c: 1.0 },
    ],
    quoteLines: [
      { Id: 'ql1', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 1000, SBQQ__ListPrice__c: 120, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      { Id: 'ql2', SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: 'Product B' }, SBQQ__Quantity__c: 5, SBQQ__NetPrice__c: 200, SBQQ__NetTotal__c: 1000, SBQQ__ListPrice__c: 250, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: 10, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
      { Id: 'ql3', SBQQ__Quote__c: 'q2', SBQQ__Product__r: { Name: 'Product C' }, SBQQ__Quantity__c: 1, SBQQ__NetPrice__c: 5000, SBQQ__NetTotal__c: 5000, SBQQ__ListPrice__c: 5000, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
    ],
    quotes: [
      { Id: 'q1', Name: 'Q-001', SBQQ__Type__c: 'Quote', SBQQ__Status__c: 'Draft', SBQQ__Primary__c: true },
      { Id: 'q2', Name: 'Q-002', SBQQ__Type__c: 'Quote', SBQQ__Status__c: 'Approved', SBQQ__Primary__c: true },
    ],
    pricebookEntries: [
      { Id: 'pbe1', Product2Id: 'p1', Product2: { Name: 'Product A' }, Pricebook2Id: 'std', UnitPrice: 120, IsActive: true },
      { Id: 'pbe2', Product2Id: 'p2', Product2: { Name: 'Product B' }, Pricebook2Id: 'std', UnitPrice: 250, IsActive: true },
      { Id: 'pbe3', Product2Id: 'p3', Product2: { Name: 'Product C' }, Pricebook2Id: 'std', UnitPrice: 5000, IsActive: true },
    ],
    contractedPrices: [
      { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2027-12-31', SBQQ__OriginalQuoteLine__c: null },
    ],
    cpqSettings: {
      SBQQ__TriggerDisabled__c: false,
      SBQQ__CalculatorEvaluationSequence__c: 'Standard',
      SBQQ__RenewalModel__c: 'Same Products',
      SBQQ__SubscriptionTermUnit__c: 'Month',
      SBQQ__ContractAutoRenew__c: true,
      SBQQ__EnablePricingGuidance__c: false,
    },
  };
}

/**
 * Creates problematic CPQData that should trigger many issues (positive test)
 */
export function createProblematicData(): CPQData {
  // Generate 55 active price rules with duplicate eval orders to trigger PERF-001, PR-002
  const manyPriceRules = Array.from({ length: 55 }, (_, i) => ({
    Id: `pr_${i}`,
    Name: `Price Rule ${i}`,
    SBQQ__Active__c: true,
    SBQQ__EvaluationOrder__c: i < 10 ? 10 : (i + 1) * 10, // First 10 share order=10
    SBQQ__TargetObject__c: 'Quote Line',
    SBQQ__LookupObject__c: null,
    SBQQ__PriceConditions__r: { records: [{ Id: `pc_${i}`, SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '10', SBQQ__Object__c: 'Quote Line' }] },
    SBQQ__PriceActions__r: { records: [{ Id: `pa_${i}`, SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '15', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
  }));
  // Add 10 inactive price rules for UA-003
  const inactivePriceRules = Array.from({ length: 10 }, (_, i) => ({
    Id: `pr_inactive_${i}`,
    Name: `Old Rule ${i}`,
    SBQQ__Active__c: false,
    SBQQ__EvaluationOrder__c: null,
    SBQQ__TargetObject__c: 'Quote Line',
    SBQQ__LookupObject__c: null,
    SBQQ__PriceConditions__r: { records: [] },
    SBQQ__PriceActions__r: { records: [] },
  }));

  // 35 active product rules for PERF-002
  const manyProductRules = Array.from({ length: 35 }, (_, i) => ({
    Id: `prd_${i}`,
    Name: `Product Rule ${i}`,
    SBQQ__Active__c: true,
    SBQQ__Type__c: 'Validation',
    SBQQ__EvaluationOrder__c: (i + 1) * 10,
    SBQQ__ConditionsMet__c: 'All',
    SBQQ__ErrorConditions__r: { records: [{ Id: `ec_${i}`, SBQQ__TestedField__c: 'SBQQ__Quantity__c', SBQQ__Operator__c: 'greater than', SBQQ__FilterValue__c: '0' }] },
    SBQQ__Actions__r: { records: [] },
  }));
  // Add 8 inactive product rules
  const inactiveProductRules = Array.from({ length: 8 }, (_, i) => ({
    Id: `prd_inactive_${i}`,
    Name: `Old Product Rule ${i}`,
    SBQQ__Active__c: false,
    SBQQ__Type__c: 'Validation',
    SBQQ__EvaluationOrder__c: null,
    SBQQ__ConditionsMet__c: null,
    SBQQ__ErrorConditions__r: { records: [] },
    SBQQ__Actions__r: { records: [] },
  }));

  // 10 active products referenced in quote lines + 10 active but NEVER quoted (UA-001)
  const quotedProducts = Array.from({ length: 10 }, (_, i) => ({
    Id: `p_quoted_${i}`,
    Name: `Quoted Product ${i}`,
    ProductCode: `QP-${i}`,
    IsActive: true,
    SBQQ__SubscriptionType__c: null,
    SBQQ__SubscriptionPricing__c: null,
    SBQQ__ChargeType__c: 'One-Time',
    SBQQ__BillingFrequency__c: null,
    SBQQ__PricingMethod__c: 'List',
  }));
  const unquotedProducts = Array.from({ length: 10 }, (_, i) => ({
    Id: `p_dead_${i}`,
    Name: `Dead Weight Product ${i}`,
    ProductCode: `DW-${i}`,
    IsActive: true,
    SBQQ__SubscriptionType__c: null,
    SBQQ__SubscriptionPricing__c: null,
    SBQQ__ChargeType__c: 'One-Time',
    SBQQ__BillingFrequency__c: null,
    SBQQ__PricingMethod__c: 'List',
  }));
  // MDQ product missing subscription (AP-001)
  const mdqProduct = {
    Id: 'p_mdq', Name: 'MDQ Product', ProductCode: 'MDQ-1', IsActive: true,
    SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null,
    SBQQ__ChargeType__c: null, SBQQ__BillingFrequency__c: null,
    SBQQ__PricingMethod__c: 'Block',
  };
  // Percent of Total not in bundle (AP-002)
  const potProduct = {
    Id: 'p_pot', Name: 'PoT Product', ProductCode: 'POT-1', IsActive: true,
    SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null,
    SBQQ__ChargeType__c: null, SBQQ__BillingFrequency__c: null,
    SBQQ__PricingMethod__c: 'Percent Of Total',
  };
  // Cost product without pricebook entry (AP-003)
  const costProduct = {
    Id: 'p_cost', Name: 'Cost Product', ProductCode: 'COST-1', IsActive: true,
    SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null,
    SBQQ__ChargeType__c: null, SBQQ__BillingFrequency__c: null,
    SBQQ__PricingMethod__c: 'Cost',
  };
  // Recurring without billing frequency (AP-004)
  const recurringProduct = {
    Id: 'p_recur', Name: 'Recurring No Billing', ProductCode: 'REC-1', IsActive: true,
    SBQQ__SubscriptionType__c: 'Renewable', SBQQ__SubscriptionPricing__c: 'Fixed Price',
    SBQQ__ChargeType__c: 'Recurring', SBQQ__BillingFrequency__c: null,
    SBQQ__PricingMethod__c: 'List',
  };

  // Discount schedules (5 total, but none utilized in quote lines -> UA-002)
  const discountSchedules = Array.from({ length: 5 }, (_, i) => ({
    Id: `ds_${i}`,
    Name: `Discount Schedule ${i}`,
    SBQQ__Type__c: 'Range',
    SBQQ__DiscountUnit__c: 'Percent',
    SBQQ__DiscountTiers__r: { records: [
      { Id: `dt_${i}_1`, Name: `Tier 1`, SBQQ__LowerBound__c: 1, SBQQ__UpperBound__c: 50, SBQQ__Discount__c: 5 },
      { Id: `dt_${i}_2`, Name: `Tier 2`, SBQQ__LowerBound__c: 55, SBQQ__UpperBound__c: 100, SBQQ__Discount__c: 10 }, // Gap at 50-55 -> DS-003
    ] },
  }));

  // 25 summary variables (PERF-004), some orphaned (SV-001), some incomplete (SV-002)
  const summaryVariables = Array.from({ length: 25 }, (_, i) => ({
    Id: `sv_${i}`,
    Name: `Summary Var ${i}`,
    SBQQ__Active__c: true,
    SBQQ__AggregateField__c: i < 23 ? 'SBQQ__Quantity__c' : null, // SV-002: last 2 missing field
    SBQQ__AggregateFunction__c: i < 23 ? 'Sum' : null,
    SBQQ__TargetObject__c: i < 23 ? 'Quote Line' : null,
    SBQQ__Scope__c: 'Quote',
    SBQQ__FilterField__c: i === 20 ? 'SBQQ__ProductCode__c' : null, // SV-004: filter field without value
    SBQQ__FilterValue__c: null,
    SBQQ__Operator__c: null,
    SBQQ__CombineWith__c: i === 22 ? 'sv_21' : null, // SV-005: combine without operator
    SBQQ__SecondOperand__c: null,
    SBQQ__CompositeOperator__c: null,
    referencedByPriceRuleCount: i < 5 ? 1 : 0, // SV-001: most are orphaned
    referencedByProductRuleCount: 0,
  }));
  // Add duplicate summary variables (SV-003)
  summaryVariables.push({
    Id: 'sv_dup1', Name: 'Dup Var 1', SBQQ__Active__c: true,
    SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum',
    SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote',
    SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null,
    SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null,
    referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0,
  });

  // Approval rules: missing approver (AR-001), no conditions (AR-002), duplicate order (AR-003), missing logic (AR-004)
  const approvalRules = [
    { Id: 'ar_no_approver', Name: 'No Approver Rule', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: null, SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [{ Id: 'ac_1', SBQQ__TestedField__c: 'SBQQ__Discount__c', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '30', SBQQ__TestedVariable__c: null }] } },
    { Id: 'ar_no_cond', Name: 'No Conditions Rule', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 2, SBQQ__Approver__c: 'admin@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 2, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [] } },
    { Id: 'ar_dup1', Name: 'Dup Order A', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'mgr@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 5, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [{ Id: 'ac_2', SBQQ__TestedField__c: 'Amount', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '10000', SBQQ__TestedVariable__c: null }] } },
    { Id: 'ar_dup2', Name: 'Dup Order B', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: 'mgr2@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 5, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [{ Id: 'ac_3', SBQQ__TestedField__c: 'Amount', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '50000', SBQQ__TestedVariable__c: null }] } },
    { Id: 'ar_no_logic', Name: 'Missing Logic', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 3, SBQQ__Approver__c: 'cfo@test.com', SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: null, SBQQ__EvaluationOrder__c: 10, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [{ Id: 'ac_4', SBQQ__TestedField__c: 'SBQQ__NetAmount__c', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '100000', SBQQ__TestedVariable__c: null }] } },
  ];

  // Custom scripts: empty code (QCP-001), missing transpiled (QCP-002), performance issues (QCP-003), multiple QCPs (QCP-004)
  const customScripts = [
    { Id: 'cs_empty', Name: 'Empty QCP', SBQQ__Code__c: '', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: null },
    { Id: 'cs_no_transpile', Name: 'Not Transpiled', SBQQ__Code__c: 'export function onAfterCalculate(q, l) { return l; }', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: '' },
    { Id: 'cs_perf', Name: 'Heavy QCP', SBQQ__Code__c: `export function onAfterCalculate(quote, lines) {\n${'  for (var i = 0; i < lines.length; i++) {\n    for (var j = 0; j < lines.length; j++) {\n      for (var k = 0; k < lines.length; k++) {\n        console.log(i, j, k);\n        console.log("debug");\n        console.log("more debug");\n        console.log("still debugging");\n        console.log("verbose output");\n        console.log("another one");\n      }\n    }\n  }\n'}\n  return lines;\n}`, SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
  ];

  // Quote templates: no default (QT-001), non-active (QT-002), empty (QT-003)
  const quoteTemplates = [
    { Id: 'qt_1', Name: 'Template A', SBQQ__Default__c: false, SBQQ__Status__c: 'Draft', SBQQ__TemplateSections__r: { records: [] } },
    { Id: 'qt_2', Name: 'Template B', SBQQ__Default__c: false, SBQQ__Status__c: 'Active', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
  ];

  // Config attributes: hidden+required (CA-001), no target field (CA-002), duplicates (CA-003), required no default (CA-004)
  const configAttributes = [
    { Id: 'ca_hidden_req', Name: 'Hidden Required', SBQQ__Product__c: 'p_quoted_0', SBQQ__Product__r: { Name: 'Quoted Product 0' }, SBQQ__TargetField__c: 'Field__c', SBQQ__Required__c: true, SBQQ__Hidden__c: true, SBQQ__DefaultField__c: null, SBQQ__ColumnOrder__c: 1, SBQQ__DisplayOrder__c: 1, SBQQ__Feature__c: null, SBQQ__AppliedImmediately__c: false },
    { Id: 'ca_no_target', Name: 'No Target', SBQQ__Product__c: 'p_quoted_1', SBQQ__Product__r: { Name: 'Quoted Product 1' }, SBQQ__TargetField__c: null, SBQQ__Required__c: false, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: null, SBQQ__ColumnOrder__c: 1, SBQQ__DisplayOrder__c: 1, SBQQ__Feature__c: null, SBQQ__AppliedImmediately__c: false },
    { Id: 'ca_dup1', Name: 'Duplicate Attr', SBQQ__Product__c: 'p_quoted_2', SBQQ__Product__r: { Name: 'Quoted Product 2' }, SBQQ__TargetField__c: 'Size__c', SBQQ__Required__c: false, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: null, SBQQ__ColumnOrder__c: 1, SBQQ__DisplayOrder__c: 1, SBQQ__Feature__c: null, SBQQ__AppliedImmediately__c: false },
    { Id: 'ca_dup2', Name: 'Duplicate Attr', SBQQ__Product__c: 'p_quoted_2', SBQQ__Product__r: { Name: 'Quoted Product 2' }, SBQQ__TargetField__c: 'Size__c', SBQQ__Required__c: false, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: null, SBQQ__ColumnOrder__c: 2, SBQQ__DisplayOrder__c: 2, SBQQ__Feature__c: null, SBQQ__AppliedImmediately__c: false },
    { Id: 'ca_req_no_default', Name: 'Req No Default', SBQQ__Product__c: 'p_quoted_3', SBQQ__Product__r: { Name: 'Quoted Product 3' }, SBQQ__TargetField__c: 'Tier__c', SBQQ__Required__c: true, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: null, SBQQ__ColumnOrder__c: 1, SBQQ__DisplayOrder__c: 1, SBQQ__Feature__c: null, SBQQ__AppliedImmediately__c: false },
  ];

  // Guided selling: no inputs (GS-001), no outputs (GS-002), inactive (GS-003)
  const guidedSelling = [
    { Id: 'gs_no_input', Name: 'No Input Process', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: 'Missing inputs', inputCount: 0, outputCount: 2 },
    { Id: 'gs_no_output', Name: 'No Output Process', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: 'Missing outputs', inputCount: 3, outputCount: 0 },
    { Id: 'gs_inactive', Name: 'Inactive Process', SBQQ__Active__c: false, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: 'Old process', inputCount: 2, outputCount: 1 },
  ];

  // Quote lines for quoted products only (no discounts for UA-002 trigger)
  const quoteLines = quotedProducts.flatMap((p, i) => [
    { Id: `ql_${i}_1`, SBQQ__Quote__c: 'q1', SBQQ__Product__r: { Name: p.Name }, SBQQ__Quantity__c: 10, SBQQ__NetPrice__c: 500, SBQQ__NetTotal__c: 5000, SBQQ__ListPrice__c: 600, SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null, SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null },
  ]);

  // Contracted price for inactive product (IA-004)
  const contractedPrices = [
    { Id: 'cp_orphan', Name: 'Orphaned CP', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme' }, SBQQ__Product__c: 'p_deleted', SBQQ__Product__r: { Name: 'Deleted Product', IsActive: false }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2027-01-01', SBQQ__OriginalQuoteLine__c: null },
  ];

  return {
    priceRules: [...manyPriceRules, ...inactivePriceRules],
    discountSchedules,
    products: [...quotedProducts, ...unquotedProducts, mdqProduct, potProduct, costProduct, recurringProduct],
    productOptions: [],
    productRules: [...manyProductRules, ...inactiveProductRules],
    summaryVariables,
    approvalRules,
    customScripts,
    quoteTemplates,
    configurationAttributes: configAttributes,
    guidedSellingProcesses: guidedSelling,
    subscriptions: [],
    quoteLines,
    quotes: [{ Id: 'q1', Name: 'Q-001', SBQQ__Type__c: 'Quote', SBQQ__Status__c: 'Draft', SBQQ__Primary__c: true }],
    pricebookEntries: quotedProducts.map((p, i) => ({ Id: `pbe_${i}`, Product2Id: p.Id, Product2: { Name: p.Name }, Pricebook2Id: 'std', UnitPrice: 600, IsActive: true })),
    contractedPrices,
    cpqSettings: {
      SBQQ__TriggerDisabled__c: true, // SET-001
      SBQQ__CalculatorEvaluationSequence__c: null as unknown as string, // SET-002
      SBQQ__RenewalModel__c: null as unknown as string,
      SBQQ__SubscriptionTermUnit__c: null as unknown as string,
      SBQQ__ContractAutoRenew__c: false,
      SBQQ__EnablePricingGuidance__c: false,
    },
  };
}
