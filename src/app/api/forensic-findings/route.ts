import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/forensic-findings?forensicScanId=xxx
 *   → list all findings from a forensic scan, sorted by gap_usd desc
 *
 * GET /api/forensic-findings?findingId=xxx
 *   → fetch one finding + its attribution trace + any recovery actions.
 *     Used by the finding detail page.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();
  const findingId = request.nextUrl.searchParams.get('findingId');
  const forensicScanId = request.nextUrl.searchParams.get('forensicScanId');

  if (findingId) {
    const [findingRes, traceRes, recoveryRes] = await Promise.all([
      supabase
        .from('forensic_findings')
        .select('*')
        .eq('id', findingId)
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('attribution_traces')
        .select('*')
        .eq('finding_id', findingId)
        .eq('user_id', user.id)
        .order('confidence', { ascending: false }),
      supabase
        .from('recovery_actions')
        .select('*')
        .eq('finding_id', findingId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
    ]);
    if (findingRes.error || !findingRes.data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(
      {
        finding: findingRes.data,
        traces: traceRes.data ?? [],
        recovery_actions: recoveryRes.data ?? [],
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (forensicScanId) {
    // includeHidden=true lets the UI surface dismissed findings on
    // demand (e.g. for a 'show hidden' toggle on the queue). Default
    // is to filter them out so the dashboard counts/$ stay clean.
    const includeHidden = request.nextUrl.searchParams.get('includeHidden') === 'true';
    let q = supabase
      .from('forensic_findings')
      .select('id, detector_id, severity, gap_usd, entitled_usd, realized_usd, currency_iso_code, title, status, detected_at, source_record_refs, hidden_at')
      .eq('forensic_scan_id', forensicScanId)
      .eq('user_id', user.id)
      .order('gap_usd', { ascending: false })
      .limit(200);
    if (!includeHidden) q = q.is('hidden_at', null);
    const { data } = await q;
    return NextResponse.json(data ?? [], { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({ error: 'findingId or forensicScanId required' }, { status: 400 });
}
