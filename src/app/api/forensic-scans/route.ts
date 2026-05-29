import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/forensic-scans?organizationId=xxx
 *   → list forensic scans for an org (latest first, capped at 20)
 *
 * GET /api/forensic-scans?scanId=xxx
 *   → fetch one forensic scan + its rolled-up totals. Used by the
 *     leakage card to know whether to show verified $ alongside the
 *     existing estimated $.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();
  const scanId = request.nextUrl.searchParams.get('scanId');
  const orgId = request.nextUrl.searchParams.get('organizationId');
  const parentScanId = request.nextUrl.searchParams.get('parentScanId');

  if (scanId) {
    const { data, error } = await supabase
      .from('forensic_scans')
      .select('*')
      .eq('id', scanId)
      .eq('user_id', user.id)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (parentScanId) {
    // Used by the org detail page to find the forensic scan attached to
    // the displayed config scan. Returns at most one.
    const { data } = await supabase
      .from('forensic_scans')
      .select('*')
      .eq('parent_scan_id', parentScanId)
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (orgId) {
    const { data } = await supabase
      .from('forensic_scans')
      .select('*')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(20);
    return NextResponse.json(data ?? [], { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({ error: 'scanId, parentScanId, or organizationId required' }, { status: 400 });
}
