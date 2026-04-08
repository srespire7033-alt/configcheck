// ============================================
// DATABASE TYPES
// ============================================

export interface DBUser {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  report_branding_color: string | null;
  timezone: string;
  avatar_url: string | null;
  plan: 'free' | 'solo' | 'practice' | 'partner';
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
  total_quote_lines: number | null;
  total_price_rules: number | null;
  total_products: number | null;
  last_scan_score: number | null;
  last_scan_at: string | null;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBScan {
  id: string;
  organization_id: string;
  user_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  scan_type: 'full' | 'quick';
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
export type IssueCategory =
  | 'price_rules'
  | 'discount_schedules'
  | 'products'
  | 'product_rules'
  | 'cpq_settings'
  | 'subscriptions'
  | 'twin_fields'
  | 'contracted_prices'
  | 'quote_lines';

export interface CategoryScores {
  price_rules: number;
  discount_schedules: number;
  products: number;
  product_rules: number;
  cpq_settings: number;
  subscriptions: number;
  quote_lines: number;
}

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
  subscriptions: SFSubscription[];
  quoteLines: SFQuoteLine[];
  quotes: SFQuote[];
  pricebookEntries: SFPricebookEntry[];
  cpqSettings: SFCPQSettings | null;
}

export interface ScanResult {
  overall_score: number;
  category_scores: CategoryScores;
  issues: Issue[];
  summary: string;
  duration_ms: number;
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
  SBQQ__Conditions__r?: { records: SFPriceCondition[] };
  SBQQ__Actions__r?: { records: SFPriceAction[] };
}

export interface SFPriceCondition {
  Id: string;
  SBQQ__Field__c: string | null;
  SBQQ__Operator__c: string | null;
  SBQQ__Value__c: string | null;
  SBQQ__TestedObject__c: string | null;
}

export interface SFPriceAction {
  Id: string;
  SBQQ__TargetField__c: string | null;
  SBQQ__Value__c: string | null;
  SBQQ__Formula__c: string | null;
  SBQQ__SourceLookupField__c: string | null;
}

export interface SFDiscountSchedule {
  Id: string;
  Name: string;
  SBQQ__Type__c: string | null;
  SBQQ__DiscountUnit__c: string | null;
  SBQQ__Tiers__r?: { records: SFDiscountTier[] };
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
  SBQQ__ErrorConditionsMet__c: string | null;
  SBQQ__Conditions__r?: { records: SFProductRuleCondition[] };
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
}

export interface SFPricebookEntry {
  Id: string;
  Product2Id: string;
  Product2: { Name: string };
  Pricebook2Id: string;
  UnitPrice: number;
  IsActive: boolean;
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
