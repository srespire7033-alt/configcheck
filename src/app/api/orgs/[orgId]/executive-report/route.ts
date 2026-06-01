/**
 * GET /api/orgs/[orgId]/executive-report
 *
 * Aggregates the org's latest scan + forensic findings + pricing
 * discipline + attribution traces into a 5-page Executive PDF, streamed
 * as application/pdf.
 *
 * Implementation notes:
 *   - All data sources are existing DB tables + the pricing-discipline
 *     endpoint's compute logic (re-used inline to avoid a sub-fetch).
 *   - @react-pdf/renderer's renderToBuffer compiles the React PDF
 *     document to a Buffer in memory. Smaller than a Chromium PDF
 *     dump and works in serverless without binaries.
 *   - Roadmap is derived deterministically from the detector
 *     breakdown: highest-impact detectors first, weeks assigned by
 *     position (Week 1 = top 1, Week 2-3 = next 2, etc).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { renderToBuffer } from '@react-pdf/renderer';
import { ExecutiveReport, type ExecutiveReportData } from '@/components/reports/executive-report';
import { ROOT_CAUSE_LABELS, type RootCauseClass } from '@/lib/forensics/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DETECTOR_LABELS: Record<string, string> = {
  'REN-001': 'Renewal uplift suppressed',
  'REN-002': 'Renewal priced below current list',
  'DSC-FOR-001': 'Promo discount roll-off failure',
  'QL-FOR-001': 'Bundle required option charged at $0',
  'ORD-FOR-001': 'Order activated, no billing schedule',
  'ORD-FOR-002': 'Quote vs Order variance (new business)',
  'ORD-FOR-003': 'Quote vs Order variance (amendment)',
};

const DETECTOR_ACTIONS: Record<string, string> = {
  'REN-001': 'Reprice renewal QuoteLines to include the contracted uplift via Data Loader patch on SBQQ__NetPrice__c.',
  'REN-002': 'Reprice below-list renewal lines to current Pricebook UnitPrice; tighten approval rules for sub-list overrides.',
  'DSC-FOR-001': 'Remove expired/open-ended discount on flagged QuoteLines; add a ValidationRule preventing post-EndDate application.',
  'QL-FOR-001': 'Restore required-option pricing on bundle lines; lock SBQQ__OptionPriceEditable on those products.',
  'ORD-FOR-001': 'Generate missing Billing Schedules for activated Orders via Salesforce Billing schedule generator.',
  'ORD-FOR-002': 'Patch OrderItem UnitPrices to match Quote Net Amount; investigate Q→O field mapping for drift root cause.',
  'ORD-FOR-003': 'Repair amendment variance — either patch OrderItem UnitPrice (pre-invoice) or issue Credit/Debit Memo (post-invoice).',
};

export async function GET(_req: NextRequest, { params }: { params: { orgId: string } }) {
  const user = await getAuthUser(_req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();

  // ─── 1. Pull org metadata ─────────────────────────────────────────
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, instance_url, product_type')
    .eq('id', params.orgId)
    .eq('user_id', user.id)
    .single();
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 });

  // ─── 2. Latest config-scan for the Revenue Leakage estimated data ──
  const { data: latestScan } = await supabase
    .from('scans')
    .select('id, status, started_at, completed_at, metadata')
    .eq('organization_id', params.orgId)
    .eq('user_id', user.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();
  const scanMeta = (latestScan?.metadata as Record<string, unknown> | null) ?? {};
  const leakage = (scanMeta.revenue_leakage as { estimated_annual_leakage?: number; percent_of_revenue?: number | null } | undefined) ?? {};

  // ─── 3. Forensic findings for verified $ + per-detector breakdown ──
  const { data: findings } = await supabase
    .from('forensic_findings')
    .select('id, detector_id, gap_usd, recoverability_score, title')
    .eq('organization_id', params.orgId)
    .eq('user_id', user.id);
  const findingsArr = (findings ?? []) as Array<{ id: string; detector_id: string; gap_usd: number; recoverability_score: number; title: string }>;

  // Aggregate by detector
  const detectorAgg = new Map<string, { count: number; gap: number; recovSum: number }>();
  for (const f of findingsArr) {
    let agg = detectorAgg.get(f.detector_id);
    if (!agg) {
      agg = { count: 0, gap: 0, recovSum: 0 };
      detectorAgg.set(f.detector_id, agg);
    }
    agg.count += 1;
    agg.gap += Number(f.gap_usd ?? 0);
    agg.recovSum += Number(f.recoverability_score ?? 0);
  }
  const detectors = Array.from(detectorAgg.entries())
    .map(([id, a]) => ({
      id,
      label: DETECTOR_LABELS[id] ?? id,
      finding_count: a.count,
      gap_usd: a.gap,
      avg_recoverability: a.count > 0 ? a.recovSum / a.count : 0,
    }))
    .sort((x, y) => y.gap_usd - x.gap_usd);
  const verifiedTotal = detectors.reduce((s, d) => s + d.gap_usd, 0);

  // ─── 4. Attribution-class breakdown ───────────────────────────────
  const { data: traces } = await supabase
    .from('attribution_traces')
    .select('root_cause_class, finding_id')
    .eq('user_id', user.id);
  const tracesArr = (traces ?? []) as Array<{ root_cause_class: RootCauseClass; finding_id: string }>;
  // Index findings by id for $ lookup
  const findingById = new Map<string, number>();
  for (const f of findingsArr) findingById.set(f.id, Number(f.gap_usd ?? 0));
  const classAgg = new Map<RootCauseClass, { count: number; gap: number }>();
  for (const t of tracesArr) {
    const fGap = findingById.get(t.finding_id);
    if (fGap == null) continue; // trace's finding not in our list
    let agg = classAgg.get(t.root_cause_class);
    if (!agg) {
      agg = { count: 0, gap: 0 };
      classAgg.set(t.root_cause_class, agg);
    }
    agg.count += 1;
    agg.gap += fGap;
  }
  const attributionTotal = Array.from(classAgg.values()).reduce((s, a) => s + a.gap, 0);
  const attribution = (['A', 'B', 'C', 'D', 'E'] as RootCauseClass[])
    .map((letter) => {
      const a = classAgg.get(letter) ?? { count: 0, gap: 0 };
      return {
        class_letter: letter,
        class_label: ROOT_CAUSE_LABELS[letter],
        finding_count: a.count,
        gap_usd: a.gap,
        pct_of_total: attributionTotal > 0 ? (a.gap / attributionTotal) * 100 : 0,
      };
    })
    .filter((a) => a.finding_count > 0)
    .sort((x, y) => y.gap_usd - x.gap_usd);

  // ─── 5. Top findings ──────────────────────────────────────────────
  const topFindings = findingsArr
    .slice()
    .sort((x, y) => Number(y.gap_usd) - Number(x.gap_usd))
    .slice(0, 10)
    .map((f) => ({
      detector_id: f.detector_id,
      title: f.title,
      gap_usd: Number(f.gap_usd ?? 0),
      recoverability: Number(f.recoverability_score ?? 0),
    }));

  // ─── 6. Pricing discipline ────────────────────────────────────────
  // Re-fetch via internal call — avoids duplicating the SOQL aggregate.
  // Use the same auth context by forwarding the cookie.
  type PricingDisciplineResp = {
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    avg_discount_pct: number;
    override_pct: number;
    approved_threshold_pct: number;
    total_quote_lines: number;
    top_discount_offenders: Array<{ product_name: string; line_count: number; avg_discount_pct: number }>;
  };
  let pricing: PricingDisciplineResp = {
    grade: 'A',
    avg_discount_pct: 0,
    override_pct: 0,
    approved_threshold_pct: 25,
    total_quote_lines: 0,
    top_discount_offenders: [],
  };
  try {
    const proto = _req.headers.get('x-forwarded-proto') ?? 'http';
    const host = _req.headers.get('host') ?? 'localhost:3000';
    const cookie = _req.headers.get('cookie') ?? '';
    const pdRes = await fetch(`${proto}://${host}/api/orgs/${params.orgId}/pricing-discipline`, {
      headers: { cookie },
    });
    if (pdRes.ok) pricing = (await pdRes.json()) as PricingDisciplineResp;
  } catch {
    // soft-fail — pricing block stays at defaults
  }

  // ─── 7. Recovery roadmap (derived) ────────────────────────────────
  // Sequence detectors by $ × recoverability, assign weeks.
  const roadmap = detectors
    .map((d) => ({
      detector_id: d.id,
      action: DETECTOR_ACTIONS[d.id] ?? 'Review affected records and patch per detector guidance.',
      impact_usd: d.gap_usd * d.avg_recoverability,
      raw_priority: d.gap_usd * d.avg_recoverability,
    }))
    .filter((r) => r.impact_usd > 0)
    .sort((x, y) => y.raw_priority - x.raw_priority)
    .slice(0, 5)
    .map((r, i) => ({
      week: i === 0 ? 'Week 1' : i <= 2 ? `Week ${1 + i}` : `Week ${1 + i}-${2 + i}`,
      detector_id: r.detector_id,
      action: r.action,
      impact_usd: r.impact_usd,
    }));

  // ─── 8. Build the data + render PDF ────────────────────────────────
  const data: ExecutiveReportData = {
    org: {
      name: org.name,
      instance_url: org.instance_url,
      product_type: org.product_type ?? 'cpq',
    },
    report_date: new Date().toISOString(),
    period_months: 12,
    estimated_annual_leakage_usd: Number(leakage.estimated_annual_leakage ?? verifiedTotal),
    verified_leakage_usd: verifiedTotal,
    percent_of_revenue: leakage.percent_of_revenue ?? null,
    detectors,
    attribution,
    top_findings: topFindings,
    pricing_discipline: {
      grade: pricing.grade,
      avg_discount_pct: pricing.avg_discount_pct,
      override_pct: pricing.override_pct,
      threshold_pct: pricing.approved_threshold_pct,
      lines_scanned: pricing.total_quote_lines,
      top_offenders: pricing.top_discount_offenders.slice(0, 5).map((o) => ({
        product_name: o.product_name,
        line_count: o.line_count,
        avg_discount_pct: o.avg_discount_pct,
      })),
    },
    roadmap,
  };

  // renderToBuffer wants the Document element directly. Calling the
  // component function returns it — bypasses the React wrapper layer
  // that @react-pdf/renderer's types reject.
  const buffer = await renderToBuffer(ExecutiveReport({ data }));
  const safeName = org.name.replace(/[^a-zA-Z0-9-]/g, '_');
  const filename = `OrgPrism-Executive-Report-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
