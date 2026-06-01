import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { aggregateAttribution, type FindingWithTrace } from '@/lib/forensics/attribution-map';

export const dynamic = 'force-dynamic';

/**
 * GET /api/forensics/attribution-map?organizationId=xxx
 *   → Aggregates the LATEST completed forensic scan's findings by
 *     root config object. Returns the consultant-deliverable hero
 *     view: ranked-by-$ list of root causes, each with its rolled-up
 *     finding count + dollar weight.
 *
 * GET /api/forensics/attribution-map?forensicScanId=xxx
 *   → Same shape, but for a specific forensic scan (useful for
 *     comparing scans over time).
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const orgId = request.nextUrl.searchParams.get('organizationId');
  const explicitScanId = request.nextUrl.searchParams.get('forensicScanId');

  if (!orgId && !explicitScanId) {
    return NextResponse.json({ error: 'organizationId or forensicScanId required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Resolve which forensic scan to aggregate.
  let scanId = explicitScanId;
  if (!scanId && orgId) {
    const { data: latest } = await supabase
      .from('forensic_scans')
      .select('id, organization_id')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) {
      // No completed forensic scan yet — return an empty map cleanly.
      return NextResponse.json(
        { scan_id: null, rows: [], total_gap_usd: 0, total_findings: 0 },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    scanId = latest.id;
  }

  // Pull every finding + its primary attribution trace for the scan.
  // We do two queries (findings, traces) and stitch in JS — Supabase's
  // join syntax is awkward for FK-only joins and we want full control
  // over null-handling.
  const [findingsRes, tracesRes] = await Promise.all([
    supabase
      .from('forensic_findings')
      .select('id, detector_id, gap_usd, currency_iso_code')
      .eq('forensic_scan_id', scanId)
      .eq('user_id', user.id),
    supabase
      .from('attribution_traces')
      .select('finding_id, root_cause_class, root_config_type, root_config_id, root_config_name, reason_code, confidence, ai_explanation, ai_suggested_fix')
      .in(
        'finding_id',
        ((
          await supabase
            .from('forensic_findings')
            .select('id')
            .eq('forensic_scan_id', scanId)
            .eq('user_id', user.id)
        ).data ?? []).map((r: { id: string }) => r.id)
      ),
  ]);

  const findings = findingsRes.data ?? [];
  const traces = tracesRes.data ?? [];

  // Build join. Findings without a trace get dropped — they aren't
  // attributable so they don't belong on the attribution map. They
  // still show up in the per-detector grouping on the leakage card.
  const traceByFindingId = new Map<string, NonNullable<typeof traces>[number]>();
  for (const t of traces) traceByFindingId.set(t.finding_id as string, t);

  const joined: FindingWithTrace[] = [];
  let unattributedCount = 0;
  let unattributedGap = 0;
  for (const f of findings) {
    const t = traceByFindingId.get(f.id as string);
    if (!t) {
      unattributedCount += 1;
      unattributedGap += Number(f.gap_usd ?? 0);
      continue;
    }
    joined.push({
      finding_id: f.id as string,
      detector_id: f.detector_id as string,
      gap_usd: Number(f.gap_usd ?? 0),
      currency_iso_code: (f.currency_iso_code as string) ?? 'USD',
      root_cause_class: t.root_cause_class as FindingWithTrace['root_cause_class'],
      root_config_type: t.root_config_type as string,
      root_config_id: (t.root_config_id as string | null) ?? null,
      root_config_name: t.root_config_name as string,
      reason_code: t.reason_code as string,
      confidence: Number(t.confidence ?? 0),
      ai_explanation: (t.ai_explanation as string | null) ?? null,
      ai_suggested_fix: (t.ai_suggested_fix as string | null) ?? null,
    });
  }

  const rows = aggregateAttribution(joined);
  const totalGap = rows.reduce((sum, r) => sum + r.total_gap_usd, 0);

  return NextResponse.json(
    {
      scan_id: scanId,
      rows,
      total_gap_usd: Math.round(totalGap * 100) / 100,
      total_findings: joined.length,
      unattributed_findings: {
        count: unattributedCount,
        total_gap_usd: Math.round(unattributedGap * 100) / 100,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
