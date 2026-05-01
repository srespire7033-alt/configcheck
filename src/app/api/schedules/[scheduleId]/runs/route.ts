import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/schedules/[scheduleId]/runs?limit=5
 *
 * Returns the most recent scans triggered by the given schedule, newest
 * first. Used by the Schedule list to power the "last 5 runs" expansion
 * — gives users visibility into whether the scheduler is healthy without
 * having to dig through scan history and guess which scans were
 * scheduled vs. manual.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { scheduleId: string } }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') || '5', 10);
  const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 5 : limitRaw), 50);

  const supabase = createServiceClient();

  // Verify the schedule belongs to this user before returning rows.
  const { data: schedule, error: schedErr } = await supabase
    .from('scan_schedules')
    .select('id, user_id')
    .eq('id', params.scheduleId)
    .eq('user_id', user.id)
    .single();

  if (schedErr || !schedule) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  // Fetch the recent scans tagged with this schedule. Limited fields —
  // the runs log only needs status / counts / timing, not full issue data.
  const { data, error } = await supabase
    .from('scans')
    .select(
      'id, status, overall_score, total_issues, critical_count, warning_count, info_count, duration_ms, error_message, started_at, completed_at, created_at'
    )
    .eq('triggered_by_schedule_id', params.scheduleId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || [], {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
