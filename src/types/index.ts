// ============================================
// DATABASE TYPES
// ============================================

export type ProductType = 'cpq' | 'cpq_billing' | 'arm';

export interface DBUser {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  job_title: string | null;
  location: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  report_branding_color: string | null;
  timezone: string;
  avatar_url: string | null;
  plan: 'free' | 'solo' | 'practice' | 'partner';
  subscribed_products: ProductType[];
  email_notifications_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface DBOrganization {
  id: string;
  user_id: string;
  name: string;
  salesforce_org_id: string;
  instance_url: string;
  access_token: string;
  refresh_token: string;
  is_sandbox: boolean;
  connection_status: 'connected' | 'expired' | 'error';
  cpq_package_version: string | null;
  installed_packages: string[];
  total_quote_lines: number | null;
  total_price_rules: number | null;
  total_products: number | null;
  last_scan_score: number | null;
  last_scan_at: string | null;
  last_connected_at: string | null;
  sf_client_id: string | null;
  sf_client_secret: string | null;
  sf_login_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBScan {
  id: string;
  organization_id: string;
  user_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  scan_type: 'full' | 'quick';
  product_type: ProductType;
  overall_score: number | null;
  category_scores: CategoryScores | null;
  summary: string | null;
  total_issues: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
  duration_ms: number | null;
  metadata: Record<string, unknown> | null;
  report_url: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  // Set when the scan was launched by a scheduled-scan cron run, null for
  // manual scans. Drives the per-schedule "last N runs" history view.
  triggered_by_schedule_id?: string | null;
}

export interface DBIssue {
  id: string;
  scan_id: string;
  organization_id: string;
  check_id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  impact: string;
  recommendation: string;
  affected_records: AffectedRecord[];
  ai_fix_suggestion: string | null;
  status: IssueStatus;
  resolved_at: string | null;
  notes: string | null;
  revenue_impact: number | null;
  effort_hours: number | null;
  created_at: string;
}

// ============================================
// ENUMS & CATEGORY TYPES
// ============================================

export type IssueSeverity = 'critical' | 'warning' | 'info';
export type IssueStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored' | 'false_positive' | 'not_relevant';
// CPQ categories
export type CPQCategory =
  | 'price_rules'
  | 'discount_schedules'
  | 'products'
  | 'product_rules'
  | 'cpq_settings'
  | 'subscriptions'
  | 'twin_fields'
  | 'contracted_prices'
  | 'quote_lines'
  | 'summary_variables'
  | 'approval_rules'
  | 'quote_calculator_plugin'
  | 'quote_templates'
  | 'configuration_attributes'
  | 'guided_selling'
  | 'advanced_pricing'
  | 'performance'
  | 'impact_analysis'
  | 'bundles'
  | 'lookup_queries';

// Billing categories (blng__ namespace)
export type BillingCategory =
  | 'billing_rules'
  | 'rev_rec_rules'
  | 'tax_rules'
  | 'finance_books'
  | 'gl_rules'
  | 'legal_entity'
  | 'product_billing_config'
  | 'invoicing';

// ARM (Revenue Cloud / RLM) categories — these target Salesforce
// standard objects, not a managed package
export type ARMCategory =
  | 'arm_product_catalog'
  | 'arm_selling_models'
  | 'arm_price_adjustments'
  | 'arm_attribute_pricing'
  | 'arm_bundles'
  | 'arm_pricing_procedures'
  | 'arm_price_books'
  | 'arm_decision_tables'
  | 'arm_context_service'
  | 'arm_rate_cards'
  | 'arm_attributes'
  | 'arm_assets'
  | 'arm_contracts'
  | 'arm_usage_management'
  | 'arm_orchestration'
  | 'arm_cost_books'
  // v5 additions
  | 'arm_tax'
  | 'arm_billing_policies'
  | 'arm_general_ledger'
  | 'arm_clauses'
  | 'arm_product_qualification'
  | 'arm_ramp_deals';

export type IssueCategory = CPQCategory | BillingCategory | ARMCategory;

// Category scores are stored as a dynamic record since scans can include
// CPQ categories, Billing categories, or both (for cpq_billing scans).
export type CategoryScores = Record<string, number>;

export interface AffectedRecord {
  id: string;
  name: string;
  type: string;
}

// ============================================
// HEALTH CHECK TYPES
// ============================================

export interface HealthCheck {
  id: string;
  name: string;
  category: IssueCategory;
  severity: IssueSeverity;
  description: string;
  run: (data: CPQData) => Promise<Issue[]>;
}

export interface BillingHealthCheck {
  id: string;
  name: string;
  category: BillingCategory;
  severity: IssueSeverity;
  description: string;
  run: (data: BillingData) => Promise<Issue[]>;
}

export interface ARMHealthCheck {
  id: string;
  name: string;
  category: ARMCategory;
  severity: IssueSeverity;
  description: string;
  run: (data: ARMData) => Promise<Issue[]>;
}

export interface Issue {
  check_id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  impact: string;
  recommendation: string;
  affected_records: AffectedRecord[];
  revenue_impact?: number;
  effort_hours?: number;
}

export interface CPQData {
  priceRules: SFPriceRule[];
  discountSchedules: SFDiscountSchedule[];
  products: SFProduct[];
  productOptions: SFProductOption[];
  productRules: SFProductRule[];
  summaryVariables: SFSummaryVariable[];
  approvalRules: SFApprovalRule[];
  customScripts: SFCustomScript[];
  quoteTemplates: SFQuoteTemplate[];
  configurationAttributes: SFConfigurationAttribute[];
  guidedSellingProcesses: SFGuidedSellingProcess[];
  subscriptions: SFSubscription[];
  quoteLines: SFQuoteLine[];
  quotes: SFQuote[];
  pricebookEntries: SFPricebookEntry[];
  contractedPrices: SFContractedPrice[];
  cpqSettings: SFCPQSettings | null;
}

export interface RevenueRiskSummary {
  totalQuoteValue: number;
  totalQuotesAnalyzed: number;
  atRiskValue: number;
  atRiskQuotes: number;
  currency: string;
}

export interface ComplexityBreakdown {
  totalScore: number;
  rating: 'Low' | 'Moderate' | 'High' | 'Very High';
  factors: {
    label: string;
    count: number;
    weight: number;
    contribution: number;
  }[];
}

export interface ScanResult {
  overall_score: number;
  category_scores: CategoryScores;
  issues: Issue[];
  summary: string;
  duration_ms: number;
  revenue_summary?: RevenueRiskSummary;
  complexity?: ComplexityBreakdown;
}

// ============================================
// SALESFORCE OBJECT TYPES
// ============================================

export interface SFPriceRule {
  Id: string;
  Name: string;
  SBQQ__Active__c: boolean;
  SBQQ__EvaluationOrder__c: number | null;
  SBQQ__TargetObject__c: string | null;
  SBQQ__LookupObject__c: string | null;
  SBQQ__PriceConditions__r?: { records: SFPriceCondition[] };
  SBQQ__PriceActions__r?: { records: SFPriceAction[] };
}

export interface SFPriceCondition {
  Id: string;
  SBQQ__Field__c: string | null;
  SBQQ__Operator__c: string | null;
  SBQQ__Value__c: string | null;
  SBQQ__Object__c: string | null;
}

export interface SFPriceAction {
  Id: string;
  SBQQ__Field__c: string | null;
  SBQQ__Value__c: string | null;
  SBQQ__Formula__c: string | null;
  SBQQ__SourceLookupField__c: string | null;
}

export interface SFDiscountSchedule {
  Id: string;
  Name: string;
  SBQQ__Type__c: string | null;
  SBQQ__DiscountUnit__c: string | null;
  SBQQ__DiscountTiers__r?: { records: SFDiscountTier[] };
}

export interface SFDiscountTier {
  Id: string;
  Name: string;
  SBQQ__LowerBound__c: number;
  SBQQ__UpperBound__c: number;
  SBQQ__Discount__c: number;
}

export interface SFProduct {
  Id: string;
  Name: string;
  ProductCode: string | null;
  IsActive: boolean;
  SBQQ__SubscriptionType__c: string | null;
  SBQQ__SubscriptionPricing__c: string | null;
  SBQQ__ChargeType__c: string | null;
  SBQQ__BillingFrequency__c: string | null;
  SBQQ__PricingMethod__c: string | null;
  SBQQ__ConfigurationType__c: string | null;
}

export interface SFProductOption {
  Id: string;
  Name: string;
  SBQQ__ConfiguredSKU__c: string;
  SBQQ__OptionalSKU__c: string;
  SBQQ__ConfiguredSKU__r?: { Name: string; IsActive: boolean };
  SBQQ__OptionalSKU__r?: { Name: string; IsActive: boolean };
  SBQQ__Required__c?: boolean;
  SBQQ__MinQuantity__c?: number | null;
  SBQQ__MaxQuantity__c?: number | null;
  SBQQ__Number__c?: number | null;
  SBQQ__Feature__c?: string | null;
  SBQQ__Feature__r?: { Name: string } | null;
}

export interface SFProductRule {
  Id: string;
  Name: string;
  SBQQ__Active__c: boolean;
  SBQQ__Type__c: string | null;
  SBQQ__EvaluationOrder__c: number | null;
  SBQQ__ConditionsMet__c: string | null;
  SBQQ__LookupObject__c?: string | null;
  SBQQ__LookupProductField__c?: string | null;
  SBQQ__ErrorConditions__r?: { records: SFProductRuleCondition[] };
  SBQQ__Actions__r?: { records: SFProductRuleAction[] };
}

export interface SFProductRuleCondition {
  Id: string;
  SBQQ__TestedField__c: string | null;
  SBQQ__Operator__c: string | null;
  SBQQ__FilterValue__c: string | null;
}

export interface SFProductRuleAction {
  Id: string;
  SBQQ__Type__c: string | null;
  SBQQ__Product__c: string | null;
  SBQQ__Product__r?: { Name: string; IsActive: boolean } | null;
}

export interface SFSummaryVariable {
  Id: string;
  Name: string;
  SBQQ__Active__c?: boolean;
  SBQQ__AggregateField__c: string | null;
  SBQQ__AggregateFunction__c: string | null;
  SBQQ__TargetObject__c: string | null;
  SBQQ__Scope__c: string | null;
  SBQQ__FilterField__c: string | null;
  SBQQ__FilterValue__c: string | null;
  SBQQ__Operator__c: string | null;
  SBQQ__CombineWith__c: string | null;
  SBQQ__SecondOperand__c: string | null;
  SBQQ__CompositeOperator__c: string | null;
  // Relationships — which rules reference this variable
  referencedByPriceRuleCount: number;
  referencedByProductRuleCount: number;
}

export interface SFApprovalRule {
  Id: string;
  Name: string;
  SBQQ__Active__c: boolean;
  SBQQ__ApprovalStep__c: number | null;
  SBQQ__Approver__c: string | null;
  SBQQ__ApproverField__c: string | null;
  SBQQ__ConditionsMet__c: string | null;
  SBQQ__EvaluationOrder__c: number | null;
  SBQQ__ApprovalChain__c: string | null;
  SBQQ__ApprovalConditions__r?: { records: SFApprovalCondition[] };
}

export interface SFApprovalCondition {
  Id: string;
  SBQQ__TestedField__c: string | null;
  SBQQ__Operator__c: string | null;
  SBQQ__Value__c: string | null;
  SBQQ__TestedVariable__c: string | null;
}

export interface SFCustomScript {
  Id: string;
  Name: string;
  SBQQ__Code__c: string | null;
  SBQQ__Type__c?: string | null;
  SBQQ__GroupFields__c: string | null;
  SBQQ__QuoteFields__c: string | null;
  SBQQ__QuoteLineFields__c: string | null;
  SBQQ__TranspiledCode__c: string | null;
}

export interface SFQuoteTemplate {
  Id: string;
  Name: string;
  SBQQ__Default__c: boolean;
  SBQQ__DeploymentStatus__c?: string | null;
  SBQQ__TemplateSections__r?: { records: SFTemplateSection[] };
}

export interface SFTemplateSection {
  Id: string;
  Name: string;
  SBQQ__Content__c: string | null;
}

export interface SFConfigurationAttribute {
  Id: string;
  Name: string;
  SBQQ__Product__c: string | null;
  SBQQ__Product__r?: { Name: string };
  SBQQ__TargetField__c: string | null;
  SBQQ__Required__c: boolean;
  SBQQ__Hidden__c: boolean;
  SBQQ__DefaultField__c: string | null;
  SBQQ__ColumnOrder__c: number | null;
  SBQQ__DisplayOrder__c: number | null;
  SBQQ__Feature__c: string | null;
  SBQQ__AppliedImmediately__c: boolean;
}

export interface SFGuidedSellingProcess {
  Id: string;
  Name: string;
  SBQQ__Active__c: boolean;
  SBQQ__LabelPosition__c: string | null;
  SBQQ__Description__c: string | null;
  inputCount: number;
  outputCount: number;
}

export interface SFSubscription {
  Id: string;
  Name: string;
  SBQQ__Contract__c: string | null;
  SBQQ__NetPrice__c: number | null;
  SBQQ__Quantity__c: number | null;
  SBQQ__ProrateMultiplier__c: number | null;
}

export interface SFQuote {
  Id: string;
  Name: string;
  SBQQ__Type__c: string | null;
  SBQQ__Status__c: string | null;
  SBQQ__Primary__c: boolean;
}

export interface SFQuoteLine {
  Id: string;
  SBQQ__Quote__c: string;
  SBQQ__Product__r?: { Name: string };
  SBQQ__Quantity__c: number | null;
  SBQQ__NetPrice__c: number | null;
  SBQQ__NetTotal__c: number | null;
  SBQQ__ListPrice__c: number | null;
  SBQQ__ProrateMultiplier__c: number | null;
  SBQQ__SubscriptionPricing__c: string | null;
  SBQQ__ChargeType__c: string | null;
  // Twin fields for TF check
  SBQQ__Discount__c: number | null;
  SBQQ__AdditionalDiscount__c: number | null;
  SBQQ__UpliftAmount__c: number | null;
  SBQQ__Uplift__c: number | null;
}

export interface SFPricebookEntry {
  Id: string;
  Product2Id: string;
  Product2: { Name: string };
  Pricebook2Id: string;
  UnitPrice: number;
  IsActive: boolean;
}

export interface SFContractedPrice {
  Id: string;
  Name: string;
  SBQQ__Account__c: string | null;
  SBQQ__Account__r?: { Name: string };
  SBQQ__Product__c: string | null;
  SBQQ__Product__r?: { Name: string; IsActive: boolean };
  SBQQ__Price__c: number | null;
  SBQQ__EffectiveDate__c: string | null;
  SBQQ__ExpirationDate__c: string | null;
  SBQQ__OriginalQuoteLine__c: string | null;
}

export interface SFCPQSettings {
  SBQQ__TriggerDisabled__c?: boolean;
  SBQQ__CalculatorEvaluationSequence__c?: string;
  SBQQ__RenewalModel__c?: string;
  SBQQ__SubscriptionTermUnit__c?: string;
  SBQQ__ContractAutoRenew__c?: boolean;
  SBQQ__EnablePricingGuidance__c?: boolean;
  [key: string]: unknown;
}

// ============================================
// SALESFORCE BILLING OBJECT TYPES (blng__)
// ============================================

export interface SFBillingRule {
  Id: string;
  Name: string;
  blng__Active__c: boolean;
  blng__InitialBillingTrigger__c: string | null;
  blng__PartialPeriodTreatment__c: string | null;
  blng__GenerateInvoices__c: string | null;
  blng__DefaultBillingRule__c?: boolean;
}

export interface SFRevRecRule {
  Id: string;
  Name: string;
  blng__Active__c: boolean;
  blng__CreateRevenueSchedule__c: string | null;
}

export interface SFTaxRule {
  Id: string;
  Name: string;
  blng__Active__c: boolean;
  blng__TaxableYesNo__c: string | null;
}

export interface SFFinanceBook {
  Id: string;
  Name: string;
  blng__Active__c: boolean;
  blng__PeriodType__c: string | null;
  blng__FinancePeriods__r?: { totalSize: number; records: SFFinancePeriod[] };
}

export interface SFFinancePeriod {
  Id: string;
  Name: string;
  blng__FinanceBook__c: string;
  blng__PeriodStartDate__c: string | null;
  blng__PeriodEndDate__c: string | null;
  blng__PeriodStatus__c: string | null;
  blng__PeriodType__c: string | null;
}

export interface SFGLRule {
  Id: string;
  Name: string;
  blng__Active__c: boolean;
  blng__GLTreatments__r?: { totalSize: number; records: SFGLTreatment[] };
}

export interface SFGLTreatment {
  Id: string;
  Name: string;
  blng__Active__c: boolean;
  blng__CreditGLAccount__c: string | null;
  blng__DebitGLAccount__c: string | null;
  blng__GLRule__c: string | null;
  blng__CreditGLAccount__r?: { Name: string; blng__Active__c?: boolean };
  blng__DebitGLAccount__r?: { Name: string; blng__Active__c?: boolean };
}

export interface SFLegalEntity {
  Id: string;
  Name: string;
  blng__Active__c: boolean;
  blng__Street__c: string | null;
  blng__City__c: string | null;
  blng__State__c: string | null;
  blng__PostalCode__c: string | null;
  blng__Country__c: string | null;
}

export interface SFBillingInvoice {
  Id: string;
  Name: string;
  blng__InvoiceStatus__c: string | null;
  blng__TotalAmount__c: number | null;
  blng__Account__c: string | null;
  blng__InvoiceDate__c: string | null;
  blng__DueDate__c: string | null;
  blng__LegalEntity__c: string | null;
  CreatedDate: string;
}

export interface SFCreditNote {
  Id: string;
  Name: string;
  blng__Status__c: string | null;
  blng__TotalAmount__c: number | null;
  blng__Balance__c: number | null;
  blng__CreditNoteDate__c: string | null;
}

export interface SFProductBillingFields {
  Id: string;
  Name: string;
  IsActive: boolean;
  blng__BillingRule__c: string | null;
  blng__RevenueRecognitionRule__c: string | null;
  blng__TaxRule__c: string | null;
  SBQQ__ChargeType__c: string | null;
  SBQQ__BillingType__c: string | null;
  SBQQ__BillingFrequency__c: string | null;
  blng__BillingRule__r?: { Name: string; blng__Active__c?: boolean };
  blng__RevenueRecognitionRule__r?: { Name: string; blng__Active__c?: boolean };
  blng__TaxRule__r?: { Name: string; blng__Active__c?: boolean };
}

export interface BillingData {
  billingRules: SFBillingRule[];
  revRecRules: SFRevRecRule[];
  taxRules: SFTaxRule[];
  financeBooks: SFFinanceBook[];
  financePeriods: SFFinancePeriod[];
  glRules: SFGLRule[];
  glTreatments: SFGLTreatment[];
  legalEntities: SFLegalEntity[];
  invoices: SFBillingInvoice[];
  creditNotes: SFCreditNote[];
  productBillingConfigs: SFProductBillingFields[];
}

// ============================================
// ARM (REVENUE CLOUD / RLM) TYPES
// These map to Salesforce *standard* objects, not a managed package.
// Object names per Revenue Cloud Developer Guide (Summer '26).
// ============================================

export interface RLMProduct {
  Id: string;
  Name: string;
  IsActive: boolean;
  ProductCode?: string | null;
  Family?: string | null;
}

export interface RLMProductSellingModel {
  Id: string;
  Name: string;
  IsActive: boolean;
  // OneTime | TermDefined | Evergreen — surfaced via the SellingModelType field
  SellingModelType: string;
  PricingTermUnit?: string | null;
  PricingTerm?: number | null;
  // Optional billing-frequency relationship (where used)
  SellingFrequencyId?: string | null;
}

export interface RLMProductSellingModelOption {
  Id: string;
  Product2Id: string;
  ProductSellingModelId: string;
  IsActive: boolean;
}

export interface RLMPriceAdjustmentSchedule {
  Id: string;
  Name: string;
  IsActive: boolean;
  AdjustmentMethod?: string | null; // 'Slab', 'Range', 'Stairstep', 'Direct'
  AdjustmentType?: string | null;   // 'Percent', 'Amount'
}

export interface RLMPriceAdjustmentTier {
  Id: string;
  PriceAdjustmentScheduleId: string;
  LowerBound?: number | null;
  UpperBound?: number | null;
  TierUnitPrice?: number | null;
  AdjustmentValue?: number | null;
}

export interface RLMAttributeBasedAdjRule {
  Id: string;
  Name: string;
  IsActive: boolean;
  EffectiveStartDate?: string | null;
  EffectiveEndDate?: string | null;
}

export interface RLMProductRelatedComponent {
  Id: string;
  ParentProductId: string;
  ChildProductId: string;
  IsComponentRequired?: boolean | null;
  Quantity?: number | null;
  MinQuantity?: number | null;
  MaxQuantity?: number | null;
}

export interface RLMPriceBook {
  Id: string;
  Name: string;
  IsActive: boolean;
  IsStandard: boolean;
  CurrencyIsoCode?: string | null;
}

export interface RLMProductCategory {
  Id: string;
  Name: string;
  IsActive?: boolean | null;
  ParentCategoryId?: string | null;
}

export interface RLMProductCategoryProduct {
  Id: string;
  ProductId: string;
  ProductCategoryId: string;
}

// Pricing Procedures live on the standard ExpressionSet sObject in the
// Business Rules Engine. The type discriminator (ExpressionSetType) is
// 'PricingProcedure' for procedures used by Salesforce Pricing — other
// values exist for eligibility rules, advanced decision tables, etc.
//
// We keep the interface name "RLMPricingProcedure" because that's still
// the conceptual entity in the rest of our codebase; only the SOQL FROM
// clause changes.
export interface RLMPricingProcedure {
  Id: string;
  ApiName: string;
  UsageType?: string | null;
  InterfaceSourceType?: string | null;
  ExpressionSetDefinitionId?: string | null;
}

// Decision tables / expression sets — Business Rules Engine surfaces
export interface RLMDecisionTable {
  Id: string;
  MasterLabel: string;
  Status: string; // 'Active' | 'Draft' | etc.
  RowCount?: number | null;
}

export interface RLMContextDefinition {
  Id: string;
  DeveloperName: string;
  IsActive: boolean;
}

// Rate cards — usage-based pricing primitive in Revenue Cloud
export interface RLMRateCard {
  Id: string;
  Name: string;
  IsActive: boolean;
  CurrencyIsoCode?: string | null;
  EffectiveStartDate?: string | null;
  EffectiveEndDate?: string | null;
}

export interface RLMRateCardEntry {
  Id: string;
  RateCardId: string;
  Product2Id?: string | null;
  Price?: number | null;
  CurrencyIsoCode?: string | null;
}

// Attributes — Product Catalog Management primitive
export interface RLMAttributeDefinition {
  Id: string;
  Name: string;
  Code: string;
  DataType: string; // 'Picklist', 'Text', 'Number', 'Boolean', 'Date'
  IsActive?: boolean | null;
  IsRequired?: boolean | null;
  DefaultValue?: string | null;
  AttributeCategoryId?: string | null;
}

export interface RLMAttributeCategory {
  Id: string;
  Name: string;
  IsActive?: boolean | null;
}

export interface RLMAttributePicklistValue {
  Id: string;
  AttributeDefinitionId?: string | null;
  Value?: string | null;
  IsActive?: boolean | null;
}

// ─── v4: Assets ────────────────────────────────────────────────
export interface RLMAsset {
  Id: string;
  Name: string;
  Status?: string | null;
  AccountId?: string | null;
  Product2Id?: string | null;
  Quantity?: number | null;
  UsageEndDate?: string | null;
  CurrentLifecycleEndDate?: string | null;
}

export interface RLMAssetStatePeriod {
  Id: string;
  AssetId: string;
  StartDate?: string | null;
  EndDate?: string | null;
  Quantity?: number | null;
  IsCurrent?: boolean | null;
}

export interface RLMAssetRelationship {
  Id: string;
  AssetId: string;
  RelatedAssetId?: string | null;
  RelationshipType?: string | null;
}

// ─── v4: Contracts ─────────────────────────────────────────────
export interface RLMContract {
  Id: string;
  Status?: string | null;
  StartDate?: string | null;
  EndDate?: string | null;
  AccountId?: string | null;
}

export interface RLMContractItemPrice {
  Id: string;
  ContractId?: string | null;
  Product2Id?: string | null;
  Price?: number | null;
  EffectiveStartDate?: string | null;
  EffectiveEndDate?: string | null;
}

// ─── v4: Usage Management ──────────────────────────────────────
export interface RLMUnitOfMeasureClass {
  Id: string;
  Name?: string | null;
  IsActive?: boolean | null;
  DefaultUomId?: string | null;
}

export interface RLMUsageResource {
  Id: string;
  Name?: string | null;
  Status?: string | null; // 'Draft' | 'Active' | 'Inactive'
  UnitOfMeasureClassId?: string | null;
  Product2Id?: string | null;
  EffectiveEndDate?: string | null;
}

export interface RLMProductUsageGrant {
  Id: string;
  Name?: string | null;
  Status?: string | null;
  Product2Id?: string | null;
  UsageResourceId?: string | null;
  EffectiveStartDate?: string | null;
  EffectiveEndDate?: string | null;
}

// ─── v4: Orchestration (DRO) ───────────────────────────────────
export interface RLMFulfillmentStepDefinition {
  Id: string;
  Name?: string | null;
  Status?: string | null;
  FulfillmentStepDefinitionGroupId?: string | null;
}

export interface RLMFulfillmentStepDefinitionGroup {
  Id: string;
  Name?: string | null;
  Status?: string | null;
}

export interface RLMProductFulfillmentScenario {
  Id: string;
  Name?: string | null;
  Status?: string | null;
}

export interface RLMFulfillmentTaskAssignmentRule {
  Id: string;
  Name?: string | null;
  Status?: string | null;
  // Owner can be a User or a Queue (depends on the rule); we capture the raw lookup
  AssignedToId?: string | null;
  AssignedToType?: string | null;
}

// ─── v4: Cost Books ────────────────────────────────────────────
export interface RLMCostBook {
  Id: string;
  Name: string;
  IsActive?: boolean | null;
  CurrencyIsoCode?: string | null;
  IsStandard?: boolean | null;
}

export interface RLMCostBookEntry {
  Id: string;
  CostBookId: string;
  Product2Id?: string | null;
  Cost?: number | null;
  CurrencyIsoCode?: string | null;
}

// ─── v5 additions: Tax / Billing / GL / Clauses ──────────────
// New object families queried for ARM checks 100-214 mined from the
// Spring '26 Revenue Cloud Developer Guide v66.0.

// PRICING extension — PricebookEntry needs ProductSellingModelId for
// the orphan-PBE check (ARM-132). Standard sObject.
export interface RLMPricebookEntry {
  Id: string;
  Product2Id: string;
  Pricebook2Id: string;
  ProductSellingModelId?: string | null;
  IsActive?: boolean;
  UnitPrice?: number | null;
  CurrencyIsoCode?: string | null;
}

// TAX
export interface RLMTaxTreatment {
  Id: string;
  Name: string;
  Status?: string | null;
  IsTaxable?: boolean | null;
  TaxEngineId?: string | null;
  TaxPolicyId?: string | null;
  ShouldUseTaxTreatmentItems?: boolean | null;
}
export interface RLMTaxEngine {
  Id: string;
  Name: string;
  IsActive?: boolean | null;
  Status?: string | null;
}
export interface RLMTaxPolicy {
  Id: string;
  Name: string;
  Status?: string | null;
}
export interface RLMTaxTreatmentItem {
  Id: string;
  TaxTreatmentId: string;
  Status?: string | null;
}

// BILLING POLICIES & ENTITIES
export interface RLMBillingPolicy {
  Id: string;
  Name: string;
  Status?: string | null;
  BillingTreatmentSelection?: string | null;
  DefaultBillingTreatmentId?: string | null;
}
export interface RLMBillingTreatment {
  Id: string;
  Name: string;
  Status?: string | null;
}
export interface RLMBillingArrangement {
  Id: string;
  Name?: string | null;
  Status?: string | null;
}
export interface RLMBillingArrangementLine {
  Id: string;
  BillingArrangementId: string;
}
export interface RLMBillingMilestonePlan {
  Id: string;
  Name: string;
  Status?: string | null;
  BillingTreatmentId?: string | null;
}
export interface RLMBillingMilestonePlanItem {
  Id: string;
  BillingMilestonePlanId: string;
}
export interface RLMPaymentRetryRuleSet {
  Id: string;
  Name: string;
  Status?: string | null;
  IsOrgDefault?: boolean | null;
}

// GENERAL LEDGER & ACCOUNTING PERIODS
export interface RLMGeneralLedgerAccount {
  Id: string;
  Name: string;
  LegalEntityId?: string | null;
  Status?: string | null;
}
export interface RLMGeneralLedgerAcctAsgntRule {
  Id: string;
  Name: string;
  Status?: string | null;
  CreditGeneralLedgerAccountId?: string | null;
  DebitGeneralLedgerAccountId?: string | null;
  LegalEntityId?: string | null;
}
export interface RLMAccountingPeriod {
  Id: string;
  Name: string;
  Status?: string | null;
  StartDate?: string | null;
  EndDate?: string | null;
}
export interface RLMLegalEntityAccountingPeriod {
  Id: string;
  AccountingPeriodId: string;
  Status?: string | null;
}

// CONTRACT CLAUSES
export interface RLMDocumentClauseSet {
  Id: string;
  Name?: string | null;
  Status?: string | null;
}
export interface RLMDocumentClause {
  Id: string;
  Name?: string | null;
  Status?: string | null;
  DocumentClauseSetId?: string | null;
  ClauseLanguage?: string | null;
  ClauseName?: string | null;
  IsAlternateClause?: boolean | null;
  Content?: string | null;
  LastModifiedDate?: string | null;
  CreatedDate?: string | null;
}

// PRODUCT QUALIFICATION
export interface RLMProductQualification {
  Id: string;
  Name?: string | null;
  ProductId?: string | null;
  RootProductId?: string | null;
  EffectiveFromDate?: string | null;
  EffectiveToDate?: string | null;
  IsQualified?: boolean | null;
}

// RAMP DEALS
export interface RLMProductRampSegment {
  Id: string;
  Name?: string | null;
  ProductId?: string | null;
  ProductSellingModelId?: string | null;
  SegmentType?: string | null;
  TrialDuration?: number | null;
  DurationType?: string | null;
}

// FULFILLMENT extensions
export interface RLMFulfillmentStepDependencyDef {
  Id: string;
  Name?: string | null;
  FulfillmentStepDefinitionId: string;
  DependsOnStepDefinitionId?: string | null;
  DependencyScope?: string | null;
}

export interface ARMData {
  products: RLMProduct[];
  sellingModels: RLMProductSellingModel[];
  sellingModelOptions: RLMProductSellingModelOption[];
  priceAdjustmentSchedules: RLMPriceAdjustmentSchedule[];
  priceAdjustmentTiers: RLMPriceAdjustmentTier[];
  attributeBasedAdjRules: RLMAttributeBasedAdjRule[];
  productRelatedComponents: RLMProductRelatedComponent[];
  priceBooks: RLMPriceBook[];
  productCategories: RLMProductCategory[];
  productCategoryProducts: RLMProductCategoryProduct[];
  pricingProcedures: RLMPricingProcedure[];
  decisionTables: RLMDecisionTable[];
  contextDefinitions: RLMContextDefinition[];
  // v3 additions
  rateCards: RLMRateCard[];
  rateCardEntries: RLMRateCardEntry[];
  attributeDefinitions: RLMAttributeDefinition[];
  attributeCategories: RLMAttributeCategory[];
  attributePicklistValues: RLMAttributePicklistValue[];
  // v4 additions
  assets: RLMAsset[];
  assetStatePeriods: RLMAssetStatePeriod[];
  assetRelationships: RLMAssetRelationship[];
  contracts: RLMContract[];
  contractItemPrices: RLMContractItemPrice[];
  unitOfMeasureClasses: RLMUnitOfMeasureClass[];
  usageResources: RLMUsageResource[];
  productUsageGrants: RLMProductUsageGrant[];
  fulfillmentStepDefinitions: RLMFulfillmentStepDefinition[];
  fulfillmentStepDefinitionGroups: RLMFulfillmentStepDefinitionGroup[];
  productFulfillmentScenarios: RLMProductFulfillmentScenario[];
  fulfillmentTaskAssignmentRules: RLMFulfillmentTaskAssignmentRule[];
  costBooks: RLMCostBook[];
  costBookEntries: RLMCostBookEntry[];
  // v5 additions — Tax / Billing / GL / Clauses / Qualification / Ramp
  pricebookEntries: RLMPricebookEntry[];
  taxTreatments: RLMTaxTreatment[];
  taxEngines: RLMTaxEngine[];
  taxPolicies: RLMTaxPolicy[];
  taxTreatmentItems: RLMTaxTreatmentItem[];
  billingPolicies: RLMBillingPolicy[];
  billingTreatments: RLMBillingTreatment[];
  billingArrangements: RLMBillingArrangement[];
  billingArrangementLines: RLMBillingArrangementLine[];
  billingMilestonePlans: RLMBillingMilestonePlan[];
  billingMilestonePlanItems: RLMBillingMilestonePlanItem[];
  paymentRetryRuleSets: RLMPaymentRetryRuleSet[];
  generalLedgerAccounts: RLMGeneralLedgerAccount[];
  generalLedgerAcctAsgntRules: RLMGeneralLedgerAcctAsgntRule[];
  accountingPeriods: RLMAccountingPeriod[];
  legalEntityAccountingPeriods: RLMLegalEntityAccountingPeriod[];
  documentClauseSets: RLMDocumentClauseSet[];
  documentClauses: RLMDocumentClause[];
  productQualifications: RLMProductQualification[];
  productRampSegments: RLMProductRampSegment[];
  fulfillmentStepDependencyDefs: RLMFulfillmentStepDependencyDef[];
}

// ============================================
// SCHEDULED SCAN TYPES
// ============================================

export interface DBScanSchedule {
  id: string;
  user_id: string;
  organization_id: string;
  schedule_type: 'once' | 'daily' | 'weekly' | 'monthly';
  cron_expression: string;
  timezone: string;
  scheduled_date: string | null;
  day_of_week: number | null;
  day_of_month: number | null;
  time_of_day: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// UI / FRONTEND TYPES
// ============================================

export interface OrgCardData {
  id: string;
  name: string;
  is_sandbox: boolean;
  connection_status: string;
  last_scan_score: number | null;
  last_scan_at: string | null;
  critical_count: number;
  installed_packages?: string[];
  disconnected_at?: string | null;
  // When null, the org was connected via the shared platform External Client
  // App — that app lives in our publisher org and Salesforce blocks its
  // refresh tokens from working cross-org, so connections expire every ~2h
  // and the user has to reconnect daily. When non-null, the customer brought
  // their own ECA installed inside their org, and refresh works permanently.
  // Dashboard surfaces a migration banner for legacy rows.
  sf_client_id?: string | null;
  // Score from the scan immediately prior to last_scan_score. Used by the
  // org card to render a delta indicator ("↑5", "↓3") — the recurring
  // monitoring signal that turns a one-time audit into a habit-forming
  // product. Null when the org has only ever been scanned once.
  previous_scan_score?: number | null;
}

export interface IssueFilters {
  severity: IssueSeverity | 'all';
  category: IssueCategory | 'all';
  status: IssueStatus | 'all';
}

export interface ScanCompare {
  scan_a: DBScan;
  scan_b: DBScan;
  issues_new: DBIssue[];
  issues_resolved: DBIssue[];
  issues_unchanged: DBIssue[];
}
