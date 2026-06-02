/**
 * GET /api/orgs/[orgId]/category-risk?category=governance|pipeline
 *
 * Aggregates forensic findings for a single category. Used by the
 * Governance Risk and Pipeline Risk cards on the org page.
 *
 * Returns per-detector breakdown + top N findings.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { DETECTOR_CATEGORY, getDetectorCategory } from '@/lib/forensics/types';

export const dynamic = 'force-dynamic';

export interface CategoryRiskResponse {
  category: 'governance' | 'pipeline';
  total_findings: number;
  total_at_risk_usd: number;
  by_detector: Array<{
    detector_id: string;
    label: string;
    finding_count: number;
    total_usd: number;
  }>;
  top_findings: Array<{
    id: string;
    detector_id: string;
    title: string;
    gap_usd: number;
    severity: string;
    created_at: string;
  }>;
  /**
   * Debug field — what this build thinks belongs in this category.
   * If empty, the DETECTOR_CATEGORY map on the running build doesn't
   * have entries for this category yet (most likely cause: deploy lag).
   */
  _debug_detector_ids_in_category?: string[];
}

const DETECTOR_LABELS: Record<string, string> = {
  'OPP-FOR-001': 'Closed-Won, no Quote',
  'CON-FOR-001': 'Contract activated, all subs expired',
  'REN-003': 'Quote expired, no renewal action',
};

export async function GET(req: NextRequest, { params }: { params: { orgId: string } }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const categoryParam = req.nextUrl.searchParams.get('category');
  if (categoryParam !== 'governance' && categoryParam !== 'pipeline') {
    return NextResponse.json(
      { error: "category must be 'governance' or 'pipeline'" },
      { status: 400 }
    );
  }
  const category: 'governance' | 'pipeline' = categoryParam;

  const supabase = createServiceClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('id, user_id')
    .eq('id', params.orgId)
    .single();
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 });
  if (org.user_id !== user.id) {
    return NextResponse.json({ error: 'No access to this org' }, { status: 403 });
  }

  // Detector IDs in this category — match against DETECTOR_CATEGORY map.
  const detectorIdsInCategory = Object.keys(DETECTOR_CATEGORY).filter(
    (id) => DETECTOR_CATEGORY[id] === category
  );
  if (detectorIdsInCategory.length === 0) {
    return NextResponse.json<CategoryRiskResponse>({
      category,
      total_findings: 0,
      total_at_risk_usd: 0,
      by_detector: [],
      top_findings: [],
      _debug_detector_ids_in_category: [],
    });
  }

  // Pull findings for this org + these detectors.
  const { data: rows } = await supabase
    .from('forensic_findings')
    .select('id, detector_id, title, gap_usd, severity, created_at')
    .eq('organization_id', params.orgId)
    .eq('user_id', user.id)
    .in('detector_id', detectorIdsInCategory);

  // ── DEBUG: count without each filter to find which one's killing it ──
  const { count: orgOnlyCount } = await supabase
    .from('forensic_findings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', params.orgId)
    .in('detector_id', detectorIdsInCategory);
  const { count: detectorOnlyCount } = await supabase
    .from('forensic_findings')
    .select('id', { count: 'exact', head: true })
    .in('detector_id', detectorIdsInCategory);
  const { count: bothCount } = await supabase
    .from('forensic_findings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', params.orgId)
    .eq('user_id', user.id)
    .in('detector_id', detectorIdsInCategory);
  console.log(
    `[category-risk] DEBUG counts — user.id=${user.id.slice(0, 8)}, org.user_id=${org.user_id?.slice(0, 8)}, ` +
    `detector_only=${detectorOnlyCount}, org_only=${orgOnlyCount}, both_filters=${bothCount}, rows=${rows?.length ?? 0}`
  );

  const findings = (rows ?? []) as Array<{
    id: string;
    detector_id: string;
    title: string;
    gap_usd: number | string;
    severity: string;
    created_at: string;
  }>;

  // Aggregate per detector.
  const byDetector = new Map<string, { count: number; total: number }>();
  let total = 0;
  for (const f of findings) {
    let agg = byDetector.get(f.detector_id);
    if (!agg) {
      agg = { count: 0, total: 0 };
      byDetector.set(f.detector_id, agg);
    }
    agg.count += 1;
    agg.total += Number(f.gap_usd ?? 0);
    total += Number(f.gap_usd ?? 0);
  }

  const resp: CategoryRiskResponse & {
    _debug_user_id_short?: string;
    _debug_org_user_id_short?: string;
    _debug_count_detector_only?: number | null;
    _debug_count_org_only?: number | null;
    _debug_count_both_filters?: number | null;
  } = {
    category,
    total_findings: findings.length,
    total_at_risk_usd: round2(total),
    _debug_detector_ids_in_category: detectorIdsInCategory,
    _debug_user_id_short: user.id.slice(0, 8),
    _debug_org_user_id_short: org.user_id?.slice(0, 8) ?? null,
    _debug_count_detector_only: detectorOnlyCount ?? null,
    _debug_count_org_only: orgOnlyCount ?? null,
    _debug_count_both_filters: bothCount ?? null,
    by_detector: Array.from(byDetector.entries()).map(([id, a]) => ({
      detector_id: id,
      label: DETECTOR_LABELS[id] ?? id,
      finding_count: a.count,
      total_usd: round2(a.total),
    })),
    top_findings: findings
      .slice()
      .sort((a, b) => Number(b.gap_usd ?? 0) - Number(a.gap_usd ?? 0))
      .slice(0, 10)
      .map((f) => ({
        id: f.id,
        detector_id: f.detector_id,
        title: f.title,
        gap_usd: Number(f.gap_usd ?? 0),
        severity: f.severity,
        created_at: f.created_at,
      })),
  };

  // Defensive: confirm the category map matches our compile-time
  // expectation. If a detector got mis-categorized via API URL the
  // findings will be empty — silently. This log helps diagnose.
  if (findings.length === 0) {
    console.log(
      `[category-risk] No findings in '${category}' for org ${params.orgId}. Detectors in this category: ${detectorIdsInCategory.join(', ')}. ` +
      `(If a detector exists in DB but isn't classified here, check DETECTOR_CATEGORY in lib/forensics/types.ts. ${getDetectorCategory.name} default is revenue_leakage.)`
    );
  }

  return NextResponse.json(resp, { headers: { 'Cache-Control': 'no-store' } });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
