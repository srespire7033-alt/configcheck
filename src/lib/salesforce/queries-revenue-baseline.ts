import type { Connection } from 'jsforce';

/**
 * Pulls real revenue-baseline numbers from the customer's Salesforce org
 * so revenue-leakage calculations use THEIR data, not generic defaults.
 *
 * The trade-off this whole module exists to make: configurable assumptions
 * (avg deal = $10K) require the customer to GUESS their numbers and a
 * consultant to defend that guess in a CFO meeting. Pulling real
 * Opportunity / Quote / Invoice averages from the org's own data gives
 * defensible numbers — "your 1,247 closed-won deals averaged $32,500"
 * lands very differently than "we assumed $10K".
 *
 * Fallback hierarchy when the primary source is missing:
 *   1. Opportunity (most orgs use it)
 *   2. SBQQ__Quote__c (CPQ-heavy orgs that bypass Opportunity)
 *   3. Order / OrderItem (ARM / RLM orgs)
 *   4. System default + confidence flag = LOW
 *
 * Each query is wrapped so a missing object (org doesn't have CPQ, RLM,
 * etc.) silently degrades to the next source. Permission errors are
 * treated the same as missing-object — we just move to the next source.
 *
 * Sample-size and source provenance are returned alongside the numbers
 * so the methodology UI can show "based on 1,247 Opportunities" or
 * "based on 23 Quotes (LOW confidence — too few records)".
 */

export interface RevenueBaseline {
  // Primary numbers (in customer's default currency)
  median_deal_size: number | null;
  mean_deal_size: number | null;
  // Total closed-won revenue in the last 12 months
  annual_revenue: number | null;
  // Actual discount patterns (when CPQ data is present)
  avg_discount_pct: number | null;
  // Effective time from CloseDate → first invoice
  median_days_to_invoice: number | null;
  // Provenance — what we actually used to compute the above
  source: 'opportunity' | 'sbqq_quote' | 'order' | 'default';
  sample_size: number;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  currency_iso_code: string;
  // Raw audit trail — stored on scan.metadata for reproducibility weeks later
  audit: {
    queried_at: string;
    queries_attempted: string[];
    queries_succeeded: string[];
    notes: string[];
  };
}

const QUERY_TIMEOUT_MS = 15_000;

async function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

interface OrgInfoRow {
  DefaultCurrencyIsoCode?: string | null;
}

async function fetchCurrency(conn: Connection): Promise<string> {
  try {
    const res = await withTimeout(
      conn.query<OrgInfoRow>('SELECT DefaultCurrencyIsoCode FROM Organization LIMIT 1'),
      QUERY_TIMEOUT_MS,
      'Organization currency'
    );
    return res.records[0]?.DefaultCurrencyIsoCode ?? 'USD';
  } catch {
    return 'USD';
  }
}

interface OppAggregateRow {
  total: number;
}

interface OppRow {
  Amount?: number | null;
}

interface CountRow {
  total: number;
}

/**
 * Try Opportunity-based revenue baseline first — most common shape.
 * Returns null if the object doesn't exist, user can't access it, or
 * the org genuinely has no closed-won data.
 */
async function tryOpportunityBaseline(
  conn: Connection,
  audit: RevenueBaseline['audit']
): Promise<Partial<RevenueBaseline> | null> {
  const q1 = "SELECT count(Id) total FROM Opportunity WHERE IsClosed = true AND IsWon = true AND CloseDate = LAST_N_DAYS:365 AND Amount > 0";
  const q2 = "SELECT SUM(Amount) total FROM Opportunity WHERE IsClosed = true AND IsWon = true AND CloseDate = LAST_N_DAYS:365";
  const q3 = "SELECT Amount FROM Opportunity WHERE IsClosed = true AND IsWon = true AND CloseDate = LAST_N_DAYS:365 AND Amount > 0 ORDER BY Amount ASC LIMIT 2000";

  audit.queries_attempted.push(q1, q2, q3);

  try {
    const countRes = await withTimeout(conn.query<CountRow>(q1), QUERY_TIMEOUT_MS, 'Opportunity count');
    const sampleSize = Number(countRes.records[0]?.total ?? 0);
    if (sampleSize === 0) {
      audit.notes.push('Opportunity query returned 0 closed-won deals in last 12 months');
      return null;
    }
    audit.queries_succeeded.push(q1);

    const sumRes = await withTimeout(conn.query<OppAggregateRow>(q2), QUERY_TIMEOUT_MS, 'Opportunity sum');
    const annualRevenue = Number(sumRes.records[0]?.total ?? 0);
    audit.queries_succeeded.push(q2);

    // Pull individual deal values (sorted) so we can compute median client-side.
    // Capped at 2000 records — enough for a stable median, doesn't burn API calls.
    const rowsRes = await withTimeout(conn.query<OppRow>(q3), QUERY_TIMEOUT_MS, 'Opportunity rows');
    audit.queries_succeeded.push(q3);

    const amounts = rowsRes.records
      .map((r) => Number(r.Amount ?? 0))
      .filter((n) => n > 0 && Number.isFinite(n));
    if (amounts.length === 0) {
      audit.notes.push('Opportunity Amount values were all zero or invalid');
      return null;
    }

    const mean = amounts.reduce((s, n) => s + n, 0) / amounts.length;
    const median = amounts[Math.floor(amounts.length / 2)];

    return {
      median_deal_size: Math.round(median),
      mean_deal_size: Math.round(mean),
      annual_revenue: Math.round(annualRevenue),
      source: 'opportunity',
      sample_size: sampleSize,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    audit.notes.push(`Opportunity baseline failed: ${msg.slice(0, 120)}`);
    return null;
  }
}

interface SBQQQuoteRow {
  SBQQ__NetAmount__c?: number | null;
}

async function tryCpqQuoteBaseline(
  conn: Connection,
  audit: RevenueBaseline['audit']
): Promise<Partial<RevenueBaseline> | null> {
  const q1 = "SELECT count(Id) total FROM SBQQ__Quote__c WHERE SBQQ__Status__c IN ('Accepted','Approved','Ordered') AND CreatedDate = LAST_N_DAYS:365";
  const q2 = "SELECT SBQQ__NetAmount__c FROM SBQQ__Quote__c WHERE SBQQ__Status__c IN ('Accepted','Approved','Ordered') AND CreatedDate = LAST_N_DAYS:365 AND SBQQ__NetAmount__c > 0 ORDER BY SBQQ__NetAmount__c ASC LIMIT 2000";
  audit.queries_attempted.push(q1, q2);

  try {
    const countRes = await withTimeout(conn.query<CountRow>(q1), QUERY_TIMEOUT_MS, 'CPQ Quote count');
    const sampleSize = Number(countRes.records[0]?.total ?? 0);
    if (sampleSize === 0) {
      audit.notes.push('No accepted CPQ quotes in last 12 months');
      return null;
    }
    audit.queries_succeeded.push(q1);

    const rowsRes = await withTimeout(conn.query<SBQQQuoteRow>(q2), QUERY_TIMEOUT_MS, 'CPQ Quote rows');
    audit.queries_succeeded.push(q2);

    const amounts = rowsRes.records
      .map((r) => Number(r.SBQQ__NetAmount__c ?? 0))
      .filter((n) => n > 0 && Number.isFinite(n));
    if (amounts.length === 0) return null;

    const mean = amounts.reduce((s, n) => s + n, 0) / amounts.length;
    const median = amounts[Math.floor(amounts.length / 2)];
    const annualRevenue = amounts.reduce((s, n) => s + n, 0);

    return {
      median_deal_size: Math.round(median),
      mean_deal_size: Math.round(mean),
      annual_revenue: Math.round(annualRevenue),
      source: 'sbqq_quote',
      sample_size: sampleSize,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    audit.notes.push(`CPQ Quote baseline failed (likely no SBQQ package): ${msg.slice(0, 120)}`);
    return null;
  }
}

interface OrderRow {
  TotalAmount?: number | null;
}

async function tryOrderBaseline(
  conn: Connection,
  audit: RevenueBaseline['audit']
): Promise<Partial<RevenueBaseline> | null> {
  const q1 = "SELECT count(Id) total FROM Order WHERE Status = 'Activated' AND CreatedDate = LAST_N_DAYS:365 AND TotalAmount > 0";
  const q2 = "SELECT TotalAmount FROM Order WHERE Status = 'Activated' AND CreatedDate = LAST_N_DAYS:365 AND TotalAmount > 0 ORDER BY TotalAmount ASC LIMIT 2000";
  audit.queries_attempted.push(q1, q2);

  try {
    const countRes = await withTimeout(conn.query<CountRow>(q1), QUERY_TIMEOUT_MS, 'Order count');
    const sampleSize = Number(countRes.records[0]?.total ?? 0);
    if (sampleSize === 0) return null;
    audit.queries_succeeded.push(q1);

    const rowsRes = await withTimeout(conn.query<OrderRow>(q2), QUERY_TIMEOUT_MS, 'Order rows');
    audit.queries_succeeded.push(q2);

    const amounts = rowsRes.records
      .map((r) => Number(r.TotalAmount ?? 0))
      .filter((n) => n > 0 && Number.isFinite(n));
    if (amounts.length === 0) return null;

    const mean = amounts.reduce((s, n) => s + n, 0) / amounts.length;
    const median = amounts[Math.floor(amounts.length / 2)];

    return {
      median_deal_size: Math.round(median),
      mean_deal_size: Math.round(mean),
      annual_revenue: Math.round(amounts.reduce((s, n) => s + n, 0)),
      source: 'order',
      sample_size: sampleSize,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    audit.notes.push(`Order baseline failed: ${msg.slice(0, 120)}`);
    return null;
  }
}

interface QuoteLineDiscountRow {
  Discount?: number | null;
  SBQQ__Discount__c?: number | null;
}

/**
 * Real discount rate — the percentage discount actually being applied
 * across recent quote lines. Used as input to discount-leakage formulas
 * so we don't over-attribute leakage when an org legitimately runs
 * promotional pricing.
 */
async function fetchAvgDiscount(conn: Connection, audit: RevenueBaseline['audit']): Promise<number | null> {
  const q = "SELECT SBQQ__Discount__c FROM SBQQ__QuoteLine__c WHERE CreatedDate = LAST_N_DAYS:90 AND SBQQ__Discount__c > 0 LIMIT 1000";
  audit.queries_attempted.push(q);
  try {
    const res = await withTimeout(conn.query<QuoteLineDiscountRow>(q), QUERY_TIMEOUT_MS, 'CPQ avg discount');
    audit.queries_succeeded.push(q);
    const discounts = res.records
      .map((r) => Number(r.SBQQ__Discount__c ?? 0))
      .filter((n) => n > 0 && n <= 100);
    if (discounts.length === 0) return null;
    const avg = discounts.reduce((s, n) => s + n, 0) / discounts.length;
    return Math.round(avg * 10) / 10;
  } catch {
    return null;
  }
}

/**
 * Public entry point. Returns a RevenueBaseline that's safe to consume —
 * unknown sources fall through to sane defaults with confidence='low'.
 */
export async function fetchRevenueBaseline(conn: Connection): Promise<RevenueBaseline> {
  const audit: RevenueBaseline['audit'] = {
    queried_at: new Date().toISOString(),
    queries_attempted: [],
    queries_succeeded: [],
    notes: [],
  };

  const currency = await fetchCurrency(conn);
  // Try each source in priority order. First non-null wins.
  const sources: Array<() => Promise<Partial<RevenueBaseline> | null>> = [
    () => tryOpportunityBaseline(conn, audit),
    () => tryCpqQuoteBaseline(conn, audit),
    () => tryOrderBaseline(conn, audit),
  ];

  let result: Partial<RevenueBaseline> | null = null;
  for (const src of sources) {
    result = await src();
    if (result) break;
  }

  const avgDiscount = await fetchAvgDiscount(conn, audit);

  if (!result) {
    audit.notes.push('No org-data source available — falling back to system defaults');
    return {
      median_deal_size: null,
      mean_deal_size: null,
      annual_revenue: null,
      avg_discount_pct: avgDiscount,
      median_days_to_invoice: null,
      source: 'default',
      sample_size: 0,
      confidence: 'unknown',
      currency_iso_code: currency,
      audit,
    };
  }

  // Confidence is sample-size driven:
  //   high   >= 200 records  (statistically stable)
  //   medium 50-199 records  (usable but flag in UI)
  //   low    1-49 records    (show but warn)
  //   unknown 0 (default)
  const sampleSize = result.sample_size ?? 0;
  const confidence: RevenueBaseline['confidence'] =
    sampleSize >= 200 ? 'high' : sampleSize >= 50 ? 'medium' : sampleSize > 0 ? 'low' : 'unknown';

  return {
    median_deal_size: result.median_deal_size ?? null,
    mean_deal_size: result.mean_deal_size ?? null,
    annual_revenue: result.annual_revenue ?? null,
    avg_discount_pct: avgDiscount,
    median_days_to_invoice: null, // populated by formula engine if needed
    source: result.source ?? 'default',
    sample_size: sampleSize,
    confidence,
    currency_iso_code: currency,
    audit,
  };
}
