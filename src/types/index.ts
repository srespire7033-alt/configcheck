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
export type IssueStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored';
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
  | 'impact_analysis';

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

export type IssueCategory = CPQCategory | BillingCategory;

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
}

export interface SFProductOption {
  Id: string;
  Name: string;
  SBQQ__ConfiguredSKU__c: string;
  SBQQ__OptionalSKU__c: string;
  SBQQ__ConfiguredSKU__r?: { Name: string; IsActive: boolean };
  SBQQ__OptionalSKU__r?: { Name: string; IsActive: boolean };
}

export interface SFProductRule {
  Id: string;
  Name: string;
  SBQQ__Active__c: boolean;
  SBQQ__Type__c: string | null;
  SBQQ__EvaluationOrder__c: number | null;
  SBQQ__ConditionsMet__c: string | null;
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
  SBQQ__Status__c?: string | null;
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
  blng__RevenueRecognitionTreatment__c: string | null;
  blng__RevenueScheduleType__c: string | null;
  blng__RevenueRecognitionType__c: string | null;
  blng__CreateRevenueSchedule__c: string | null;
}

export interface SFTaxRule {
  Id: string;
  Name: string;
  blng__Active__c: boolean;
  blng__TaxableYN__c: string | null;
  blng__TaxPercentage__c: number | null;
  blng__TaxIntegration__c: string | null;
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
