import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portfolio-runs/[id]
 *
 * Returns the run record + per-scan status so the progress page can
 * render bars and decide when to redirect. Also reconciles the run's
 * own status: if every referenced scan has reached a terminal state,
 * we flip the run to 'completed' / 'partial' / 'failed' here so the
 * client doesn't need to do that math.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createServiceClient();
    const { data: run, error } = await supabase
      .from('portfolio_runs')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();

    if (error || !run) {
      return NextResponse.json({ error: 'Portfolio run not found' }, { status: 404 });
    }

    // Fetch the status of each referenced scan. nulls in scan_ids would
    // mean "kickoff failed for this slot" — we report them as failed.
    const scanIds = (run.scan_ids as (string | null)[]).filter((id): id is string => !!id);
    const { data: scans } = await supabase
      .from('scans')
      .select('id, organization_id, status, overall_score, total_issues, critical_count, warning_count, completed_at, error_message')
      .in('id', scanIds);

    const scanById = new Map<string, NonNullable<typeof scans>[number]>();
    for (const s of scans ?? []) scanById.set(s.id as string, s);

    // Per-slot status aligned with organization_ids.
    const orgIds = run.organization_ids as string[];
    const slots = (run.scan_ids as (string | null)[]).map((scanId, i) => {
      const orgId = orgIds[i];
      if (!scanId) {
        return { org_id: orgId, scan_id: null, status: 'kickoff_failed' as const };
      }
      const s = scanById.get(scanId);
      if (!s) return { org_id: orgId, scan_id: scanId, status: 'unknown' as const };
      return {
        org_id: orgId,
        scan_id: scanId,
        status: s.status as string,
        overall_score: s.overall_score,
        total_issues: s.total_issues,
        critical_count: s.critical_count,
        warning_count: s.warning_count,
        completed_at: s.completed_at,
        error_message: s.error_message,
      };
    });

    // Reconcile run status from the slots. Once all slots are terminal,
    // the run is done. We persist the transition so analytics and the
    // notification job can find completed runs efficiently.
    const terminalStatuses = new Set(['completed', 'failed', 'kickoff_failed']);
    const allTerminal = slots.every((s) => terminalStatuses.has(s.status));
    if (allTerminal && (run.status === 'running' || run.status === 'pending')) {
      const anyFailed = slots.some((s) => s.status !== 'completed');
      const allFailed = slots.every((s) => s.status !== 'completed');
      const newStatus = allFailed ? 'failed' : anyFailed ? 'partial' : 'completed';
      await supabase
        .from('portfolio_runs')
        .update({ status: newStatus, completed_at: new Date().toISOString() })
        .eq('id', run.id);
      run.status = newStatus;
      run.completed_at = new Date().toISOString();
    }

    return NextResponse.json(
      { run, slots },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[portfolio-runs GET] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
