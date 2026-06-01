/**
 * GET /api/orgs/[orgId]/forensic-diff?from=<scanId>&to=<scanId>
 *
 * Compares two forensic_scans. Default: latest two completed scans
 * for this org. Returns the bucketed diff + headline net delta.
 *
 * When fewer than 2 forensic scans exist, returns 204 — the UI hides
 * the "Since last scan" card in that case.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { computeDiff, type DiffFinding, type ForensicDiff } from '@/lib/forensics/diff';

export const dynamic = 'force-dynamic';

export interface ForensicDiffResponse extends ForensicDiff {
  from_scan: { id: string; completed_at: string | null; finding_count: number };
  to_scan: { id: string; completed_at: string | null; finding_count: number };
}

interface ForensicScanRow {
  id: string;
  completed_at: string | null;
  finding_count: number | null;
  status: string;
}

interface FindingRow {
  id: string;
  forensic_scan_id: string;
  detector_id: string;
  title: string;
  gap_usd: number | string;
  recoverability_score: number | string;
  source_record_refs: unknown;
}

export async function GET(_req: NextRequest, { params }: { params: { orgId: string } }) {
  const user = await getAuthUser(_req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();

  // Verify org access.
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', params.orgId)
    .eq('user_id', user.id)
    .single();
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 });

  // Resolve which scans to compare.
  const fromIdParam = _req.nextUrl.searchParams.get('from');
  const toIdParam = _req.nextUrl.searchParams.get('to');

  let fromScan: ForensicScanRow | null = null;
  let toScan: ForensicScanRow | null = null;

  if (fromIdParam && toIdParam) {
    const [{ data: fr }, { data: tr }] = await Promise.all([
      supabase.from('forensic_scans').select('id, completed_at, finding_count, status').eq('id', fromIdParam).single(),
      supabase.from('forensic_scans').select('id, completed_at, finding_count, status').eq('id', toIdParam).single(),
    ]);
    fromScan = fr as ForensicScanRow | null;
    toScan = tr as ForensicScanRow | null;
  } else {
    // Default: latest two completed scans for this org.
    const { data: scans } = await supabase
      .from('forensic_scans')
      .select('id, completed_at, finding_count, status')
      .eq('organization_id', params.orgId)
      .in('status', ['completed', 'partial'])
      .order('completed_at', { ascending: false })
      .limit(2);
    const arr = (scans ?? []) as ForensicScanRow[];
    if (arr.length < 2) {
      // Single-scan or no-scan case — no diff to compute.
      return NextResponse.json(null, { status: 204 });
    }
    toScan = arr[0];
    fromScan = arr[1];
  }

  if (!fromScan || !toScan) {
    return NextResponse.json({ error: 'Could not resolve scans to diff' }, { status: 404 });
  }

  // Pull findings from both scans. RLS bypassed via service client; we
  // already verified org access.
  const { data: rows } = await supabase
    .from('forensic_findings')
    .select('id, forensic_scan_id, detector_id, title, gap_usd, recoverability_score, source_record_refs')
    .in('forensic_scan_id', [fromScan.id, toScan.id]);

  const fromFindings: DiffFinding[] = [];
  const toFindings: DiffFinding[] = [];
  for (const r of (rows ?? []) as FindingRow[]) {
    const refs = (r.source_record_refs as { primary_record?: { id?: string } } | null) ?? {};
    const pid = refs.primary_record?.id ?? null;
    const f: DiffFinding = {
      id: r.id,
      detector_id: r.detector_id,
      title: r.title,
      gap_usd: Number(r.gap_usd ?? 0),
      recoverability_score: Number(r.recoverability_score ?? 0),
      primary_record_id: pid,
    };
    if (r.forensic_scan_id === fromScan.id) fromFindings.push(f);
    else if (r.forensic_scan_id === toScan.id) toFindings.push(f);
  }

  const diff = computeDiff(fromFindings, toFindings);

  const resp: ForensicDiffResponse = {
    ...diff,
    from_scan: {
      id: fromScan.id,
      completed_at: fromScan.completed_at,
      finding_count: fromScan.finding_count ?? fromFindings.length,
    },
    to_scan: {
      id: toScan.id,
      completed_at: toScan.completed_at,
      finding_count: toScan.finding_count ?? toFindings.length,
    },
  };
  return NextResponse.json(resp, { headers: { 'Cache-Control': 'no-store' } });
}
