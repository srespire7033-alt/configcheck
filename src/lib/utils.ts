import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 5-band score colour scheme — must match HealthScore donut bands so the
 * org card score and the detail page score are visually consistent. The
 * old 3-band scheme (80+ green / 60-79 yellow / <60 red) made a 77 look
 * "yellow" on the card while HealthScore showed it as lime-green inside
 * the page — caught by user comparison.
 *
 * Band thresholds match HealthScore.getBand:
 *   90+  Healthy (A)        → green
 *   75-89 Passable (B)      → lime
 *   60-74 Needs work (C)    → amber
 *   40-59 Poor (D)          → orange
 *   <40   Critical (F)      → red
 */
export function getScoreColor(score: number): string {
  // Brightness levels match HealthScore.getBand exactly so org card and
  // org-detail header show the same shade for the same score (the 600
  // shade of lime renders near-black at small font sizes).
  if (score >= 90) return 'text-green-600';   // #16a34a
  if (score >= 75) return 'text-lime-500';    // #84cc16 — matches getBand
  if (score >= 60) return 'text-amber-500';   // #f59e0b — matches getBand
  if (score >= 40) return 'text-orange-500';  // #f97316 — matches getBand
  return 'text-red-600';                      // #dc2626 — matches getBand
}

export function getScoreBgColor(score: number): string {
  if (score >= 90) return 'bg-green-100 border-green-300';
  if (score >= 75) return 'bg-lime-100 border-lime-300';
  if (score >= 60) return 'bg-amber-100 border-amber-300';
  if (score >= 40) return 'bg-orange-100 border-orange-300';
  return 'bg-red-100 border-red-300';
}

export function getScoreBarColor(score: number): string {
  if (score >= 90) return 'bg-green-500';
  if (score >= 75) return 'bg-lime-500';
  if (score >= 60) return 'bg-amber-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

export function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'bg-red-100 text-red-800 border-red-300';
    case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'info': return 'bg-blue-100 text-blue-800 border-blue-300';
    default: return 'bg-gray-100 text-gray-800 border-gray-300';
  }
}

export function getSeverityBorderColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'border-l-red-500';
    case 'warning': return 'border-l-yellow-500';
    case 'info': return 'border-l-blue-500';
    default: return 'border-l-gray-500';
  }
}

export function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    price_rules: 'Price Rules',
    discount_schedules: 'Discount Schedules',
    products: 'Products & Bundles',
    product_rules: 'Product Rules',
    cpq_settings: 'CPQ Settings',
    subscriptions: 'Subscriptions',
    twin_fields: 'Twin Fields',
    contracted_prices: 'Contracted Prices',
    quote_lines: 'Quote Lines',
    summary_variables: 'Summary Variables',
    approval_rules: 'Approval Rules',
    quote_calculator_plugin: 'QCP (Custom Scripts)',
    quote_templates: 'Quote Templates',
    configuration_attributes: 'Config Attributes',
    guided_selling: 'Guided Selling',
    advanced_pricing: 'Advanced Pricing',
    performance: 'Performance',
    impact_analysis: 'Impact Analysis',
    bundles: 'Bundle Integrity',
    lookup_queries: 'Lookup Queries',
    // Billing categories
    billing_rules: 'Billing Rules',
    rev_rec_rules: 'Revenue Recognition',
    tax_rules: 'Tax Rules',
    finance_books: 'Finance Books',
    gl_rules: 'GL Rules',
    legal_entity: 'Legal Entity',
    product_billing_config: 'Product Billing Config',
    invoicing: 'Invoicing',
    // ARM (Revenue Cloud / RLM) categories
    arm_product_catalog: 'Product Catalog (ARM)',
    arm_selling_models: 'Selling Models (ARM)',
    arm_price_adjustments: 'Price Adjustments (ARM)',
    arm_attribute_pricing: 'Attribute Pricing (ARM)',
    arm_bundles: 'Bundles (ARM)',
    arm_pricing_procedures: 'Pricing Procedures (ARM)',
    arm_price_books: 'Price Books (ARM)',
    arm_decision_tables: 'Decision Tables (ARM)',
    arm_context_service: 'Context Service (ARM)',
    arm_rate_cards: 'Rate Cards (ARM)',
    arm_attributes: 'Attributes (ARM)',
    arm_assets: 'Assets (ARM)',
    arm_contracts: 'Contracts (ARM)',
    arm_usage_management: 'Usage Management (ARM)',
    arm_orchestration: 'Orchestration (ARM)',
    arm_cost_books: 'Cost Books (ARM)',
    arm_tax: 'Tax (ARM)',
    arm_billing_policies: 'Billing Policies (ARM)',
    arm_general_ledger: 'General Ledger (ARM)',
    arm_clauses: 'Contract Clauses (ARM)',
    arm_product_qualification: 'Product Qualification (ARM)',
    arm_ramp_deals: 'Ramp Deals (ARM)',
  };
  return labels[category] || category;
}

/**
 * Short version of getCategoryLabel for cramped UIs (the per-category
 * cards on the org-detail page especially). Drops articles, conjunctions,
 * and the "(ARM)" suffix where the badge colour already conveys product.
 * Use this only where space is genuinely tight; modals, reports, and
 * exports should keep the full label from getCategoryLabel().
 */
export function getShortCategoryLabel(category: string): string {
  const short: Record<string, string> = {
    // CPQ shortenings (only where the full label was truncating)
    discount_schedules: 'Discounts',
    products: 'Products',
    contracted_prices: 'Contracted',
    summary_variables: 'Summary Vars',
    approval_rules: 'Approvals',
    quote_calculator_plugin: 'QCP',
    quote_templates: 'Templates',
    configuration_attributes: 'Config Attrs',
    advanced_pricing: 'Adv. Pricing',
    impact_analysis: 'Impact',
    bundles: 'Bundles',
    lookup_queries: 'Lookups',
    // Billing
    rev_rec_rules: 'Rev Rec',
    finance_books: 'Finance Books',
    legal_entity: 'Legal Entity',
    product_billing_config: 'Billing Config',
    // ARM — drop the "(ARM)" suffix in the cramped card view
    arm_product_catalog: 'Catalog',
    arm_selling_models: 'Selling Models',
    arm_price_adjustments: 'Price Adj.',
    arm_attribute_pricing: 'Attr. Pricing',
    arm_bundles: 'Bundles',
    arm_pricing_procedures: 'Pricing Proc.',
    arm_price_books: 'Price Books',
    arm_decision_tables: 'Decision Tables',
    arm_context_service: 'Context Svc.',
    arm_rate_cards: 'Rate Cards',
    arm_attributes: 'Attributes',
    arm_assets: 'Assets',
    arm_contracts: 'Contracts',
    arm_usage_management: 'Usage Mgmt.',
    arm_orchestration: 'Orchestration',
    arm_cost_books: 'Cost Books',
    arm_tax: 'Tax',
    arm_billing_policies: 'Billing Pol.',
    arm_general_ledger: 'GL',
    arm_clauses: 'Clauses',
    arm_product_qualification: 'Qualification',
    arm_ramp_deals: 'Ramp Deals',
  };
  return short[category] || getCategoryLabel(category);
}

export function getProductTypeLabel(productType: string): string {
  const labels: Record<string, string> = {
    cpq: 'CPQ',
    cpq_billing: 'CPQ + Billing',
    arm: 'ARM',
  };
  return labels[productType] || productType;
}
