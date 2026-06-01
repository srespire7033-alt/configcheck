import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/recovery-actions?organizationId=xxx&status=pending|approved|committed|rejected
 *
 * Returns recovery_actions joined with their finding for the recovery
 * dashboard. Filterable by status. Bounded to the user's own actions
 * via RLS; org filter applies via the joined finding.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const orgId = request.nextUrl.searchParams.get('organizationId');
  const statusFilter = request.nextUrl.searchParams.get('status');
  if (!orgId) return NextResponse.json({ error: 'organizationId required' }, { status: 400 });

  const supabase = createServiceClient();

  // Get findings for this org first, then their recovery actions.
  // Avoids ambiguity around RLS on the join.
  const { data: findings } = await supabase
    .from('forensic_findings')
    .select('id, detector_id, gap_usd, currency_iso_code, title, source_record_refs')
    .eq('organization_id', orgId)
    .eq('user_id', user.id);

  const findingIds = (findings ?? []).map((f) => f.id as string);
  if (findingIds.length === 0) {
    return NextResponse.json(
      { actions: [], counts: { pending: 0, approved: 0, committed: 0, rejected: 0 }, totals: {} },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let query = supabase
    .from('recovery_actions')
    .select('*')
    .in('finding_id', findingIds)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (statusFilter) query = query.eq('approval_status', statusFilter);

  const { data: actions, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load actions' }, { status: 500 });

  // Stitch finding details onto each action for the dashboard.
  type FindingShape = NonNullable<typeof findings>[number];
  const findingById = new Map<string, FindingShape>();
  for (const f of findings ?? []) findingById.set(f.id as string, f);

  const enrichedActions = (actions ?? []).map((a) => {
    const f = findingById.get(a.finding_id as string);
    return {
      ...a,
      finding: f
        ? {
            id: f.id,
            detector_id: f.detector_id,
            gap_usd: Number(f.gap_usd ?? 0),
            currency_iso_code: f.currency_iso_code,
            title: f.title,
            primary_record: (f.source_record_refs as { primary_record?: { name?: string } } | null)?.primary_record ?? null,
          }
        : null,
    };
  });

  // Aggregate counts across ALL statuses (independent of the filter) so
  // the dashboard tabs always show the right badge counts.
  const { data: allActionsForCounts } = await supabase
    .from('recovery_actions')
    .select('approval_status, projected_reclaim_usd')
    .in('finding_id', findingIds)
    .eq('user_id', user.id);
  const counts = { pending: 0, approved: 0, committed: 0, rejected: 0 };
  const totals: Record<string, number> = { pending: 0, approved: 0, committed: 0, rejected: 0 };
  for (const a of allActionsForCounts ?? []) {
    const s = a.approval_status as keyof typeof counts;
    if (counts[s] != null) {
      counts[s] += 1;
      totals[s] += Number(a.projected_reclaim_usd ?? 0);
    }
  }

  return NextResponse.json(
    {
      actions: enrichedActions,
      counts,
      totals,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
