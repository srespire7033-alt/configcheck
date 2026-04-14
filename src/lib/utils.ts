import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

export function getScoreBgColor(score: number): string {
  if (score >= 80) return 'bg-green-100 border-green-300';
  if (score >= 60) return 'bg-yellow-100 border-yellow-300';
  return 'bg-red-100 border-red-300';
}

export function getScoreBarColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
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
  return `${Math.floor(seconds / 86400)}d ago`;
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
    // Billing categories
    billing_rules: 'Billing Rules',
    rev_rec_rules: 'Revenue Recognition',
    tax_rules: 'Tax Rules',
    finance_books: 'Finance Books',
    gl_rules: 'GL Rules',
    legal_entity: 'Legal Entity',
    product_billing_config: 'Product Billing Config',
    invoicing: 'Invoicing',
  };
  return labels[category] || category;
}

export function getProductTypeLabel(productType: string): string {
  const labels: Record<string, string> = {
    cpq: 'CPQ',
    cpq_billing: 'CPQ + Billing',
    arm: 'ARM',
  };
  return labels[productType] || productType;
}
