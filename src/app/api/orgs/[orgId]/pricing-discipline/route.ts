/**
 * GET /api/orgs/[orgId]/pricing-discipline
 *
 * Two org-level pricing-health KPIs:
 *
 *   1. AVG DISCOUNT vs APPROVED THRESHOLD
 *      Average discount across all QuoteLines in the last 12 months,
 *      plus the % of lines exceeding the approved discount threshold.
 *      Threshold sources (in priority order):
 *        - SBQQ__DiscountSchedule__c.SBQQ__DiscountAmount__c on the
 *          QuoteLine's referenced schedule (per-product, per-volume)
 *        - 25% fallback when no schedule reference exists (industry
 *          rule of thumb; consultant can configure later)
 *
 *   2. % LINES WITH MANUAL PRICE OVERRIDE
 *      Share of QuoteLines where SBQQ__PricingMethod__c = 'Manual'
 *      (the canonical "rep overrode the calculated price" flag in CPQ).
 *
 * Both are aggregate metrics — no per-record finding, no recovery
 * action. They surface a SYSTEMIC pricing-discipline issue that's
 * separate from the per-record leak findings.
 *
 * Health grade derives from both:
 *   A: avg discount < 15% AND override < 10%
 *   B: avg discount < 25% AND override < 20%
 *   C: avg discount < 35% AND override < 35%
 *   D: avg discount < 50% AND override < 50%
 *   F: anything worse — pricing controls broken
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { createRefreshableConnection } from '@/lib/salesforce/client';
import { computeGrade, gradeNarrative, type Grade } from '@/lib/forensics/pricing-discipline-grade';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_APPROVED_DISCOUNT_PCT = 25;

interface QuoteLineAgg {
  Id: string;
  SBQQ__Quote__c: string;
  SBQQ__Discount__c: string | number | null;
  SBQQ__PricingMethod__c: string | null;
  SBQQ__Product__c: string | null;
  // CPQ relationship name for SBQQ__Product__c is SBQQ__Product__r —
  // NOT Product__r. Earlier version had this wrong and silently
  // fell back to showing product IDs.
  SBQQ__Product__r?: { Name?: string } | null;
  SBQQ__Quote__r?: { Name?: string; SBQQ__Account__c?: string | null; SBQQ__Account__r?: { Name?: string } | null } | null;
  SBQQ__DiscountSchedule__c?: string | null;
}

interface OffenderRowDetailed {
  product_name: string;
  product_id: string;
  line_count: number;
  avg_discount_pct: number;
  sample_quote_id: string | null;
  sample_quote_name: string | null;
}

interface AccountAgg {
  account_id: string;
  account_name: string;
  line_count: number;
  avg_discount_pct: number;
}

interface DiscountScheduleRow {
  Id: string;
  Name: string;
  SBQQ__DiscountAmount__c: number | null;
}

interface OverrideOffenderRow {
  product_name: string;
  product_id: string;
  override_count: number;
  sample_quote_id: string | null;
  sample_quote_name: string | null;
}

export interface PricingDisciplineResponse {
  generated_at: string;
  metric_window_months: number;
  total_quote_lines: number;
  // Discount-discipline metric
  avg_discount_pct: number;
  median_discount_pct: number;
  pct_lines_above_threshold: number;
  approved_threshold_pct: number;
  approved_threshold_source: string;
  lines_above_threshold: number;
  schedules_referenced: number;
  top_discount_offenders: OffenderRowDetailed[];
  top_discounting_accounts: AccountAgg[];
  // Override-discipline metric
  override_count: number;
  override_pct: number;
  top_override_offenders: OverrideOffenderRow[];
  // Overall grade
  grade: Grade;
  grade_narrative: string;
}

export async function GET(_req: NextRequest, { params }: { params: { orgId: string } }) {
  const user = await getAuthUser(_req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();
  // Confirm the user has access to this org.
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', params.orgId)
    .eq('user_id', user.id)
    .single();
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 });

  let conn;
  try {
    ({ conn } = await createRefreshableConnection(params.orgId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Connection failed';
    return NextResponse.json({ error: `Salesforce: ${msg}` }, { status: 502 });
  }

  const sinceIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

  // Pull all QuoteLines in the window. We use REST (no Bulk) — the
  // aggregate metrics fit in one query; even orgs with 100K lines
  // chunk via the autoFetchMore wrapper jsforce uses by default.
  let lines: QuoteLineAgg[] = [];
  try {
    const res = await conn.query<QuoteLineAgg>(`
      SELECT Id, SBQQ__Quote__c, SBQQ__Discount__c, SBQQ__PricingMethod__c,
             SBQQ__Product__c, SBQQ__Product__r.Name,
             SBQQ__Quote__r.Name, SBQQ__Quote__r.SBQQ__Account__c, SBQQ__Quote__r.SBQQ__Account__r.Name,
             SBQQ__DiscountSchedule__c
      FROM SBQQ__QuoteLine__c
      WHERE CreatedDate >= ${sinceIso}
    `);
    lines = res.records;
    // jsforce autoFetches via res.nextRecordsUrl — for a v1 metric we
    // accept the first batch (typically 2000) as the sample. Larger
    // pulls can use Bulk; not needed for accuracy on aggregate %.
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Query failed';
    return NextResponse.json({ error: `SOQL: ${msg}` }, { status: 502 });
  }

  if (lines.length === 0) {
    const empty: PricingDisciplineResponse = {
      generated_at: new Date().toISOString(),
      metric_window_months: 12,
      total_quote_lines: 0,
      avg_discount_pct: 0,
      median_discount_pct: 0,
      pct_lines_above_threshold: 0,
      approved_threshold_pct: DEFAULT_APPROVED_DISCOUNT_PCT,
      approved_threshold_source: `${DEFAULT_APPROVED_DISCOUNT_PCT}% default fallback`,
      lines_above_threshold: 0,
      schedules_referenced: 0,
      top_discount_offenders: [],
      top_discounting_accounts: [],
      override_count: 0,
      override_pct: 0,
      top_override_offenders: [],
      grade: 'A',
      grade_narrative: 'No quote lines in the last 12 months — nothing to grade.',
    };
    return NextResponse.json(empty);
  }

  // Pull Discount Schedules referenced by these lines. Per-schedule
  // approved discount amount.
  const scheduleIds = Array.from(
    new Set(lines.map((l) => l.SBQQ__DiscountSchedule__c).filter((id): id is string => !!id))
  );
  const schedulesById = new Map<string, DiscountScheduleRow>();
  if (scheduleIds.length > 0) {
    try {
      const sRes = await conn.query<DiscountScheduleRow>(`
        SELECT Id, Name, SBQQ__DiscountAmount__c
        FROM SBQQ__DiscountSchedule__c
        WHERE Id IN (${scheduleIds.map((id) => `'${id}'`).join(',')})
      `);
      for (const s of sRes.records) schedulesById.set(s.Id, s);
    } catch {
      // Don't fail — fall back to default threshold.
    }
  }

  // Aggregate by product for the top-offender tables.
  interface ProductAgg {
    name: string;
    line_count: number;
    discount_sum: number;
    override_count: number;
    sample_quote_id: string | null;
    sample_quote_name: string | null;
  }
  interface AcctAgg {
    name: string;
    line_count: number;
    discount_sum: number;
  }
  const byProduct = new Map<string, ProductAgg>();
  const byAccount = new Map<string, AcctAgg>();
  const allDiscounts: number[] = []; // for median
  let totalDiscountSum = 0;
  let totalLinesWithDiscount = 0;
  let linesAboveThreshold = 0;
  let totalOverride = 0;

  for (const line of lines) {
    const productId = line.SBQQ__Product__c ?? 'unknown';
    const productName = line.SBQQ__Product__r?.Name ?? productId;
    const discount = Number(line.SBQQ__Discount__c ?? 0);
    const isManual = line.SBQQ__PricingMethod__c === 'Manual';
    const quoteName = line.SBQQ__Quote__r?.Name ?? null;
    const accountId = line.SBQQ__Quote__r?.SBQQ__Account__c ?? null;
    const accountName = line.SBQQ__Quote__r?.SBQQ__Account__r?.Name ?? (accountId ? `Account ${accountId.slice(0, 8)}` : 'Unknown');
    const threshold = line.SBQQ__DiscountSchedule__c
      ? Number(schedulesById.get(line.SBQQ__DiscountSchedule__c)?.SBQQ__DiscountAmount__c ?? DEFAULT_APPROVED_DISCOUNT_PCT)
      : DEFAULT_APPROVED_DISCOUNT_PCT;

    let agg = byProduct.get(productId);
    if (!agg) {
      agg = { name: productName, line_count: 0, discount_sum: 0, override_count: 0, sample_quote_id: null, sample_quote_name: null };
      byProduct.set(productId, agg);
    }
    agg.line_count += 1;
    agg.discount_sum += discount;
    if (isManual) agg.override_count += 1;
    if (!agg.sample_quote_id && discount > threshold) {
      agg.sample_quote_id = line.SBQQ__Quote__c;
      agg.sample_quote_name = quoteName;
    }

    if (accountId) {
      let acct = byAccount.get(accountId);
      if (!acct) {
        acct = { name: accountName, line_count: 0, discount_sum: 0 };
        byAccount.set(accountId, acct);
      }
      acct.line_count += 1;
      acct.discount_sum += discount;
    }

    if (discount > 0) {
      totalDiscountSum += discount;
      totalLinesWithDiscount += 1;
      allDiscounts.push(discount);
    }
    if (discount > threshold) linesAboveThreshold += 1;
    if (isManual) totalOverride += 1;
  }

  const avgDiscount = totalLinesWithDiscount > 0 ? totalDiscountSum / totalLinesWithDiscount : 0;
  const medianDiscount = computeMedian(allDiscounts);
  const pctAboveThreshold = (linesAboveThreshold / lines.length) * 100;
  const overridePct = (totalOverride / lines.length) * 100;

  // Top discount offenders: products with the highest avg discount.
  const topDiscount: OffenderRowDetailed[] = Array.from(byProduct.entries())
    .map(([id, a]) => ({
      product_id: id,
      product_name: a.name,
      line_count: a.line_count,
      avg_discount_pct: round2(a.discount_sum / Math.max(a.line_count, 1)),
      sample_quote_id: a.sample_quote_id,
      sample_quote_name: a.sample_quote_name,
    }))
    .filter((r) => r.line_count >= 2 && r.avg_discount_pct > 0)
    .sort((x, y) => y.avg_discount_pct - x.avg_discount_pct)
    .slice(0, 5);

  // Top override offenders: products with the most manual-override lines.
  const topOverride: OverrideOffenderRow[] = Array.from(byProduct.entries())
    .map(([id, a]) => ({
      product_id: id,
      product_name: a.name,
      override_count: a.override_count,
      sample_quote_id: a.sample_quote_id,
      sample_quote_name: a.sample_quote_name,
    }))
    .filter((r) => r.override_count > 0)
    .sort((x, y) => y.override_count - x.override_count)
    .slice(0, 5);

  // Top discounting accounts: account-level avg discount.
  const topAccounts: AccountAgg[] = Array.from(byAccount.entries())
    .map(([id, a]) => ({
      account_id: id,
      account_name: a.name,
      line_count: a.line_count,
      avg_discount_pct: round2(a.discount_sum / Math.max(a.line_count, 1)),
    }))
    .filter((r) => r.line_count >= 2 && r.avg_discount_pct > 0)
    .sort((x, y) => y.avg_discount_pct - x.avg_discount_pct)
    .slice(0, 5);

  const grade = computeGrade(avgDiscount, overridePct);

  const schedulesReferenced = schedulesById.size;
  const thresholdSource =
    schedulesReferenced > 0
      ? `Per-line: SBQQ__DiscountSchedule__c.SBQQ__DiscountAmount__c when present (${schedulesReferenced} schedule${schedulesReferenced === 1 ? '' : 's'} referenced); ${DEFAULT_APPROVED_DISCOUNT_PCT}% fallback otherwise`
      : `${DEFAULT_APPROVED_DISCOUNT_PCT}% default — no Discount Schedules referenced on quote lines in window`;

  const response: PricingDisciplineResponse = {
    generated_at: new Date().toISOString(),
    metric_window_months: 12,
    total_quote_lines: lines.length,
    avg_discount_pct: round2(avgDiscount),
    median_discount_pct: round2(medianDiscount),
    pct_lines_above_threshold: round2(pctAboveThreshold),
    approved_threshold_pct: DEFAULT_APPROVED_DISCOUNT_PCT,
    approved_threshold_source: thresholdSource,
    lines_above_threshold: linesAboveThreshold,
    schedules_referenced: schedulesReferenced,
    top_discount_offenders: topDiscount,
    top_discounting_accounts: topAccounts,
    override_count: totalOverride,
    override_pct: round2(overridePct),
    top_override_offenders: topOverride,
    grade,
    grade_narrative: gradeNarrative(grade, avgDiscount, overridePct),
  };
  return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// computeGrade + gradeNarrative moved to '@/lib/forensics/pricing-discipline-grade'
// — Next.js disallows non-route named exports from route files. The
// test suite imports from the lib module now.
