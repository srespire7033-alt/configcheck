/**
 * Per-check revenue leakage formulas.
 *
 * Each check_id with a defensible $ impact gets a formula here. ~35 of
 * the 209 checks have direct revenue impact — the rest stay qualitative.
 *
 * Formula structure:
 *
 *   impact = affected_count
 *          × baseline_input   (median deal | annual revenue | etc.)
 *          × leak_rate        (% of value at risk per record)
 *          × recoverability   (% you can actually claw back)
 *          × ltv_multiplier   (industry-driven, SaaS=4, one-time=1)
 *
 * The "recoverability" factor is crucial — it prevents over-promising.
 * "15 quote lines with zero NetPrice" might include legitimate promo
 * deals or trial accounts, so we apply 70% recoverability rather than
 * pretending 100% is recoverable.
 *
 * Industry defaults change LTV (SaaS deals are recurring, manufacturing
 * deals are one-time). Customer can override the industry in Settings.
 *
 * Stays a pure function: takes inputs, returns numbers. No I/O, no
 * Salesforce calls. Easy to test, easy to port to Apex later.
 */

import type { Issue } from '@/types';

export type Industry = 'saas' | 'manufacturing' | 'services' | 'financial' | 'b2c' | 'other';

export interface IndustryProfile {
  // How many years of revenue does a typical customer represent? SaaS
  // customers compound — losing a $50K/yr deal isn't a one-time $50K
  // loss, it's $200K over 4-year typical SaaS lifetime.
  ltv_multiplier: number;
  // For one-time-deal businesses (manufacturing, services) revenue
  // doesn't compound the same way.
  is_recurring: boolean;
  // Default discount-leak rate when approval is bypassed — how much
  // discount actually goes through. SaaS tends to be tighter (10%);
  // manufacturing tends to be looser (20%).
  default_discount_leak_rate: number;
  // What we tell the user when they hover the methodology pane.
  description: string;
}

export const INDUSTRY_DEFAULTS: Record<Industry, IndustryProfile> = {
  saas: {
    ltv_multiplier: 4,
    is_recurring: true,
    default_discount_leak_rate: 0.10,
    description: 'B2B SaaS — recurring revenue, 4-year typical customer lifetime',
  },
  manufacturing: {
    ltv_multiplier: 1,
    is_recurring: false,
    default_discount_leak_rate: 0.20,
    description: 'Manufacturing — one-time deals, longer sales cycles',
  },
  services: {
    ltv_multiplier: 2,
    is_recurring: false,
    default_discount_leak_rate: 0.15,
    description: 'Professional services — project-based with some retainer',
  },
  financial: {
    ltv_multiplier: 5,
    is_recurring: true,
    default_discount_leak_rate: 0.08,
    description: 'Financial services — long-term contracts, regulated pricing',
  },
  b2c: {
    ltv_multiplier: 1.5,
    is_recurring: false,
    default_discount_leak_rate: 0.15,
    description: 'B2C — high volume, lower individual deal size',
  },
  other: {
    ltv_multiplier: 2,
    is_recurring: false,
    default_discount_leak_rate: 0.15,
    description: 'Generic business — mid-range assumptions',
  },
};

export interface FormulaInputs {
  // From SOQL baseline
  median_deal_size: number; // already in customer currency
  annual_revenue: number;
  avg_discount_pct: number; // 0-100
  // From assumptions
  industry: Industry;
  use_median: boolean; // override to use mean — rare
}

export interface FormulaOutput {
  estimated_impact: number; // $ per year forward-looking
  recoverability: number; // 0-1
  inputs_used: Record<string, number | string>;
  explanation: string;
}

/**
 * The formula table. Each check_id maps to a function that takes the
 * issue (which carries affected_count via affected_records.length) plus
 * the org's baseline, and returns the $ impact.
 *
 * If a check_id isn't in this table, it has no $ impact — the issue
 * stays qualitative. That's intentional — over-attributing $ to vague
 * findings destroys trust faster than not attributing.
 */
const FORMULAS: Record<string, (issue: Issue, inputs: FormulaInputs) => FormulaOutput> = {
  // ─── CPQ direct-leakage checks ─────────────────────────────────────
  'QL-001': (issue, { median_deal_size, industry }) => {
    const count = issue.affected_records?.length ?? 0;
    const ltv = INDUSTRY_DEFAULTS[industry].ltv_multiplier;
    const recoverability = 0.7;
    const impact = count * median_deal_size * 1.0 * recoverability * ltv;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability, ltv },
      explanation: `${count} quote line${count === 1 ? '' : 's'} with zero NetPrice × your median deal $${median_deal_size.toLocaleString()} × 70% recoverable × ${ltv}× LTV`,
    };
  },
  'QL-002': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.95;
    const impact = count * median_deal_size * 0.05 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, mismatch_share: 0.05, recoverability },
      explanation: `${count} quotes with NetTotal mismatch — assumes 5% revenue variance × 95% recoverable`,
    };
  },
  'QL-004': (issue, { median_deal_size, industry }) => {
    const count = issue.affected_records?.length ?? 0;
    const profile = INDUSTRY_DEFAULTS[industry];
    const leakRate = profile.default_discount_leak_rate;
    const recoverability = 0.6;
    const impact = count * median_deal_size * leakRate * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, leakRate, recoverability },
      explanation: `${count} over-discounted quote lines × $${median_deal_size.toLocaleString()} × ${(leakRate * 100).toFixed(0)}% discount leak × 60% recoverable`,
    };
  },
  'PR-001': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.5;
    const impact = count * median_deal_size * 0.05 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, variance: 0.05, recoverability },
      explanation: `${count} conflicting price rules — assumes 5% pricing variance × 50% recoverable (some conflicts are intentional)`,
    };
  },
  'PR-002': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.3;
    const impact = count * median_deal_size * 0.02 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability },
      explanation: `${count} dead price rules — small ongoing maintenance overhead`,
    };
  },
  'DS-001': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.7;
    const impact = count * median_deal_size * 0.10 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, variance: 0.10, recoverability },
      explanation: `${count} overlapping discount tiers — assumes 10% discount variance × 70% recoverable`,
    };
  },
  'DS-003': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.8;
    const impact = count * median_deal_size * 0.05 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability },
      explanation: `${count} negative discount values — likely data entry error × 80% recoverable`,
    };
  },
  'AR-001': (issue, { median_deal_size, industry }) => {
    const count = issue.affected_records?.length ?? 0;
    const profile = INDUSTRY_DEFAULTS[industry];
    const recoverability = 0.9;
    const impact = count * median_deal_size * profile.default_discount_leak_rate * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, discount_leak_rate: profile.default_discount_leak_rate, recoverability },
      explanation: `${count} approval rules without approver = bypassed approvals × ${(profile.default_discount_leak_rate * 100).toFixed(0)}% discount leak × 90% recoverable`,
    };
  },
  'BN-001': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.5;
    const impact = count * median_deal_size * 0.05 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability },
      explanation: `${count} empty bundles — blocks attempted quotes × 5% deal exposure × 50% recoverable`,
    };
  },
  'BN-004': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.9;
    const impact = count * median_deal_size * 0.10 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability },
      explanation: `${count} required bundle options without PricebookEntry — hard quote-creation block × 10% deal exposure × 90% recoverable`,
    };
  },
  'PB-001': (issue, { annual_revenue, industry }) => {
    const count = issue.affected_records?.length ?? 0;
    const profile = INDUSTRY_DEFAULTS[industry];
    // Per-product annual revenue, conservatively assume 1% of total
    // revenue per active blocked product
    const perProduct = annual_revenue * 0.01;
    const recoverability = 1.0;
    const impact = count * perProduct * recoverability * profile.ltv_multiplier;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, perProduct, recoverability, ltv: profile.ltv_multiplier },
      explanation: `${count} products without PricebookEntry — assumed 1% of annual revenue per product × 100% recoverable × ${profile.ltv_multiplier}× LTV`,
    };
  },
  'IA-005': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.7;
    const impact = count * median_deal_size * 0.10 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability },
      explanation: `${count} circular rule dependencies — pricing breakdowns × 10% deal exposure × 70% recoverable`,
    };
  },
  // ─── Billing direct-leakage checks ────────────────────────────────
  'FB-001': (issue, { annual_revenue }) => {
    // Blocks ALL invoicing for the period — pro-rated daily impact
    const dailyRevenue = annual_revenue / 365;
    const recoverability = 0.95;
    const impact = dailyRevenue * 7 * recoverability; // assume 1 week delay typical
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { annual_revenue, days_blocked: 7, recoverability },
      explanation: `No open finance period — assumes 7-day invoicing delay × 95% recoverable (deferred revenue)`,
    };
  },
  'FB-006': (issue, { annual_revenue }) => {
    // CRITICAL — blocks invoicing entirely
    const dailyRevenue = annual_revenue / 365;
    const recoverability = 1.0;
    const impact = dailyRevenue * 30 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { annual_revenue, days_blocked: 30, recoverability },
      explanation: `No active finance book — 30-day invoicing block × 100% recoverable`,
    };
  },
  'INV-001': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.95;
    const impact = count * median_deal_size * 1.0 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability },
      explanation: `${count} invoices stuck in Draft >7 days — deferred revenue × 95% recoverable on processing`,
    };
  },
  'INV-002': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.7;
    const impact = count * median_deal_size * 0.5 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability },
      explanation: `${count} zero-amount invoices — likely partial billing × 70% recoverable`,
    };
  },
  'INV-005': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.9;
    const impact = count * median_deal_size * 1.0 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability },
      explanation: `${count} invoices missing Legal Entity — blocks send × 90% recoverable on cleanup`,
    };
  },
  'TR-001': (issue, { annual_revenue }) => {
    const count = issue.affected_records?.length ?? 0;
    // Generic 2.5% tax leakage per active untaxed product
    const recoverability = 0.8;
    const perProduct = annual_revenue * 0.01 * 0.025; // 1% revenue per product × 2.5% tax
    const impact = count * perProduct * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, perProduct, recoverability },
      explanation: `${count} active products without Tax Rule — assumed 2.5% tax leakage × 80% recoverable`,
    };
  },
  'PBC-001': (issue, { annual_revenue, industry }) => {
    const count = issue.affected_records?.length ?? 0;
    const profile = INDUSTRY_DEFAULTS[industry];
    const recoverability = 1.0;
    const perProduct = annual_revenue * 0.01;
    const impact = count * perProduct * recoverability * profile.ltv_multiplier;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, perProduct, recoverability, ltv: profile.ltv_multiplier },
      explanation: `${count} products missing Billing Rule — can't bill × 100% recoverable × ${profile.ltv_multiplier}× LTV`,
    };
  },
  'RR-002': (issue, { annual_revenue }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.95;
    const perRule = annual_revenue * 0.005;
    const impact = count * perRule * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, perRule, recoverability },
      explanation: `${count} rev rec rules not creating schedules — deferred revenue recognition × 95% recoverable`,
    };
  },
  // ─── ARM (Revenue Cloud) direct-leakage checks ────────────────────
  'ARM-001': (issue, { annual_revenue, industry }) => {
    const count = issue.affected_records?.length ?? 0;
    const profile = INDUSTRY_DEFAULTS[industry];
    const recoverability = 0.7;
    const perProduct = annual_revenue * 0.005;
    const impact = count * perProduct * recoverability * profile.ltv_multiplier;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, perProduct, recoverability, ltv: profile.ltv_multiplier },
      explanation: `${count} products without selling model — can't be quoted × 70% recoverable × ${profile.ltv_multiplier}× LTV`,
    };
  },
  'ARM-002b': (issue, { annual_revenue, industry }) => {
    const count = issue.affected_records?.length ?? 0;
    const profile = INDUSTRY_DEFAULTS[industry];
    const recoverability = 0.95;
    const perProduct = annual_revenue * 0.005;
    const impact = count * perProduct * recoverability * profile.ltv_multiplier;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, perProduct, recoverability, ltv: profile.ltv_multiplier },
      explanation: `${count} products with no pricing path — quote-line creation fails × 95% recoverable × ${profile.ltv_multiplier}× LTV`,
    };
  },
  'ARM-021': (issue, { annual_revenue, industry }) => {
    const count = issue.affected_records?.length ?? 0;
    const profile = INDUSTRY_DEFAULTS[industry];
    const recoverability = 0.9;
    const perRateCard = annual_revenue * 0.02;
    const impact = count * perRateCard * recoverability * profile.ltv_multiplier;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, perRateCard, recoverability, ltv: profile.ltv_multiplier },
      explanation: `${count} rate cards with no entries — blocks subscription revenue × 90% recoverable × ${profile.ltv_multiplier}× LTV`,
    };
  },
  'ARM-022': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.8;
    const impact = count * median_deal_size * 0.1 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability },
      explanation: `${count} rate card entries with no price — billing gaps × 10% × 80% recoverable`,
    };
  },
  'ARM-028': (issue, { annual_revenue }) => {
    // THE BIG ONE — inactive Standard Pricebook
    const recoverability = 0.95;
    const impact = annual_revenue * 0.05 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { annual_revenue, exposure: 0.05, recoverability },
      explanation: `Standard Pricebook inactive — broad pricing flow disruption × 5% revenue exposure × 95% recoverable`,
    };
  },
  'ARM-034': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.85;
    const impact = count * median_deal_size * 0.1 * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability },
      explanation: `${count} assets with multiple "current" state periods — billing ambiguity × 10% × 85% recoverable`,
    };
  },
  'ARM-039': (issue, { median_deal_size }) => {
    const count = issue.affected_records?.length ?? 0;
    const recoverability = 0.95;
    const impact = count * median_deal_size * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability },
      explanation: `${count} contracts with reversed start/end dates — billing won't run × 95% recoverable`,
    };
  },
  'ARM-110': (issue, { median_deal_size, industry }) => {
    const count = issue.affected_records?.length ?? 0;
    const profile = INDUSTRY_DEFAULTS[industry];
    const recoverability = 0.8;
    const impact = count * median_deal_size * profile.default_discount_leak_rate * recoverability;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, median_deal_size, recoverability, discount_leak_rate: profile.default_discount_leak_rate },
      explanation: `${count} expired qualifications still marked qualified — over-discounting × 80% recoverable`,
    };
  },
  'ARM-132': (issue, { annual_revenue, industry }) => {
    const count = issue.affected_records?.length ?? 0;
    const profile = INDUSTRY_DEFAULTS[industry];
    const recoverability = 0.7;
    const perEntry = annual_revenue * 0.005;
    const impact = count * perEntry * recoverability * profile.ltv_multiplier;
    return {
      estimated_impact: Math.round(impact),
      recoverability,
      inputs_used: { count, perEntry, recoverability, ltv: profile.ltv_multiplier },
      explanation: `${count} pricebook entries without selling model — broken pricing × 70% recoverable × ${profile.ltv_multiplier}× LTV`,
    };
  },
};

/**
 * Public lookup. Returns null if the check has no revenue formula.
 */
export function formulaFor(checkId: string): typeof FORMULAS[string] | null {
  return FORMULAS[checkId] ?? null;
}

/**
 * Returns the set of check IDs that have $ formulas. Used for analytics
 * and the methodology page so we can show "X of 209 checks compute
 * revenue impact."
 */
export function checksWithFormulas(): string[] {
  return Object.keys(FORMULAS);
}
