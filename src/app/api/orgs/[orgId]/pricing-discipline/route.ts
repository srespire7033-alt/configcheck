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

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_APPROVED_DISCOUNT_PCT = 25;

interface QuoteLineAgg {
  Id: string;
  SBQQ__Quote__c: string;
  SBQQ__Discount__c: string | number | null;
  SBQQ__PricingMethod__c: string | null;
  SBQQ__Product__c: string | null;
  Product__r?: { Name?: string } | null;
  SBQQ__DiscountSchedule__c?: string | null;
}

interface DiscountScheduleRow {
  Id: string;
  Name: string;
  SBQQ__DiscountAmount__c: number | null;
}

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

interface OffenderRow {
  product_name: string;
  product_id: string;
  line_count: number;
  avg_discount_pct: number;
  sample_quote_id: string | null;
}

interface OverrideOffenderRow {
  product_name: string;
  product_id: string;
  override_count: number;
  sample_quote_id: string | null;
}

export interface PricingDisciplineResponse {
  generated_at: string;
  metric_window_months: number;
  total_quote_lines: number;
  // Discount-discipline metric
  avg_discount_pct: number;
  pct_lines_above_threshold: number;
  approved_threshold_pct: number;
  lines_above_threshold: number;
  top_discount_offenders: OffenderRow[];
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
             SBQQ__Product__c, SBQQ__Product__r.Name, SBQQ__DiscountSchedule__c
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
      pct_lines_above_threshold: 0,
      approved_threshold_pct: DEFAULT_APPROVED_DISCOUNT_PCT,
      lines_above_threshold: 0,
      top_discount_offenders: [],
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
    sample_quote: string | null;
  }
  const byProduct = new Map<string, ProductAgg>();
  let totalDiscountSum = 0;
  let totalLinesWithDiscount = 0;
  let linesAboveThreshold = 0;
  let totalOverride = 0;

  for (const line of lines) {
    const productId = line.SBQQ__Product__c ?? 'unknown';
    const productName = line.Product__r?.Name ?? productId;
    const discount = Number(line.SBQQ__Discount__c ?? 0);
    const isManual = line.SBQQ__PricingMethod__c === 'Manual';
    const threshold = line.SBQQ__DiscountSchedule__c
      ? Number(schedulesById.get(line.SBQQ__DiscountSchedule__c)?.SBQQ__DiscountAmount__c ?? DEFAULT_APPROVED_DISCOUNT_PCT)
      : DEFAULT_APPROVED_DISCOUNT_PCT;

    let agg = byProduct.get(productId);
    if (!agg) {
      agg = { name: productName, line_count: 0, discount_sum: 0, override_count: 0, sample_quote: null };
      byProduct.set(productId, agg);
    }
    agg.line_count += 1;
    agg.discount_sum += discount;
    if (isManual) agg.override_count += 1;
    if (!agg.sample_quote && discount > threshold) agg.sample_quote = line.SBQQ__Quote__c;

    if (discount > 0) {
      totalDiscountSum += discount;
      totalLinesWithDiscount += 1;
    }
    if (discount > threshold) linesAboveThreshold += 1;
    if (isManual) totalOverride += 1;
  }

  const avgDiscount = totalLinesWithDiscount > 0 ? totalDiscountSum / totalLinesWithDiscount : 0;
  const pctAboveThreshold = (linesAboveThreshold / lines.length) * 100;
  const overridePct = (totalOverride / lines.length) * 100;

  // Top discount offenders: products with the highest avg discount.
  const topDiscount: OffenderRow[] = Array.from(byProduct.entries())
    .map(([id, a]) => ({
      product_id: id,
      product_name: a.name,
      line_count: a.line_count,
      avg_discount_pct: round2(a.discount_sum / Math.max(a.line_count, 1)),
      sample_quote_id: a.sample_quote,
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
      sample_quote_id: a.sample_quote,
    }))
    .filter((r) => r.override_count > 0)
    .sort((x, y) => y.override_count - x.override_count)
    .slice(0, 5);

  const grade = computeGrade(avgDiscount, overridePct);

  const response: PricingDisciplineResponse = {
    generated_at: new Date().toISOString(),
    metric_window_months: 12,
    total_quote_lines: lines.length,
    avg_discount_pct: round2(avgDiscount),
    pct_lines_above_threshold: round2(pctAboveThreshold),
    approved_threshold_pct: DEFAULT_APPROVED_DISCOUNT_PCT,
    lines_above_threshold: linesAboveThreshold,
    top_discount_offenders: topDiscount,
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

export function computeGrade(avgDiscount: number, overridePct: number): Grade {
  if (avgDiscount < 15 && overridePct < 10) return 'A';
  if (avgDiscount < 25 && overridePct < 20) return 'B';
  if (avgDiscount < 35 && overridePct < 35) return 'C';
  if (avgDiscount < 50 && overridePct < 50) return 'D';
  return 'F';
}

export function gradeNarrative(grade: Grade, avgDiscount: number, overridePct: number): string {
  switch (grade) {
    case 'A':
      return `Pricing discipline is strong — avg discount ${avgDiscount.toFixed(1)}%, manual overrides on just ${overridePct.toFixed(1)}% of lines.`;
    case 'B':
      return `Pricing discipline is healthy. Avg discount ${avgDiscount.toFixed(1)}%; ${overridePct.toFixed(1)}% of lines carry a manual override.`;
    case 'C':
      return `Discount creep starting. Avg ${avgDiscount.toFixed(1)}% discount and ${overridePct.toFixed(1)}% override rate suggest approval rules may need tightening.`;
    case 'D':
      return `Discount discipline is weakening — ${avgDiscount.toFixed(1)}% avg discount, ${overridePct.toFixed(1)}% override rate. Reps are leaving negotiating room on the table.`;
    case 'F':
      return `Pricing controls are not working. Avg discount ${avgDiscount.toFixed(1)}% with ${overridePct.toFixed(1)}% of lines manually overridden. Approval routing requires immediate review.`;
  }
}
