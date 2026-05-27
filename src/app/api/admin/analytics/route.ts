import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { isAdmin } from '@/lib/auth/is-admin';
import { AnalyticsEvent } from '@/lib/analytics/events';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/analytics?days=7
 *
 * Aggregates the analytics_events table into the four shapes the
 * /admin/analytics page needs:
 *   - kpis           — headline counters
 *   - funnel         — activation drop-off (modal → submit → connect → scan)
 *   - events_by_day  — daily counts per event_name for the line chart
 *   - top_events     — event leaderboard for the period
 *
 * All aggregation runs SQL-side so we don't pull every row into Node.
 * Admin-gated by isAdmin(email) — same pattern as /api/admin/stats.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const daysParam = parseInt(request.nextUrl.searchParams.get('days') || '7', 10);
  // Clamp: keeps the dashboard fast and prevents accidental "give me a year of data" queries.
  const days = Math.min(Math.max(daysParam, 1), 90);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const supabase = createServiceClient();

  // Pull all events in the window in one query. With <1M events/period this
  // stays well under the postgres timeout; if it ever stops scaling we move
  // the aggregations into a SQL function or a materialized view.
  const { data: rows, error } = await supabase
    .from('analytics_events')
    .select('event_name, user_id, anonymous_id, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[admin/analytics] query failed:', error);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }

  const events = rows ?? [];

  // ── KPIs ────────────────────────────────────────────────────────────
  // Distinct users counted both ways: signed-in (user_id) and anonymous
  // (anonymous_id). Some visitors may show up in both buckets if they
  // signed up partway through the window.
  const userSet = new Set<string>();
  const anonSet = new Set<string>();
  const byEvent = new Map<string, number>();
  for (const row of events) {
    if (row.user_id) userSet.add(row.user_id);
    if (row.anonymous_id) anonSet.add(row.anonymous_id);
    byEvent.set(row.event_name, (byEvent.get(row.event_name) ?? 0) + 1);
  }
  const kpis = {
    total_events: events.length,
    distinct_users: userSet.size,
    distinct_anonymous: anonSet.size,
    scans_completed: byEvent.get(AnalyticsEvent.SCAN_COMPLETED) ?? 0,
    scans_failed: byEvent.get(AnalyticsEvent.SCAN_FAILED) ?? 0,
    pdfs_downloaded: byEvent.get(AnalyticsEvent.PDF_REPORT_DOWNLOADED) ?? 0,
    ai_calls: (byEvent.get(AnalyticsEvent.AI_EXPLAIN_USED) ?? 0)
            + (byEvent.get(AnalyticsEvent.AI_FIX_USED) ?? 0),
    orgs_disconnected: byEvent.get(AnalyticsEvent.ORG_DISCONNECTED) ?? 0,
  };

  // ── Funnel: distinct users at each activation stage ────────────────
  // We count "users" by user_id when present, else anonymous_id. Same
  // visitor across stages is therefore counted once regardless of whether
  // they were signed in.
  function distinctActorsFor(eventName: string): number {
    const actors = new Set<string>();
    for (const r of events) {
      if (r.event_name !== eventName) continue;
      const key = r.user_id || r.anonymous_id;
      if (key) actors.add(key);
    }
    return actors.size;
  }
  const funnel = [
    { stage: 'Opened connect modal', count: distinctActorsFor(AnalyticsEvent.CONNECT_ORG_MODAL_OPENED) },
    { stage: 'Submitted ECA creds', count: distinctActorsFor(AnalyticsEvent.ECA_CREDENTIALS_SUBMITTED) },
    { stage: 'OAuth completed', count: distinctActorsFor(AnalyticsEvent.OAUTH_CALLBACK_SUCCESS) },
    { stage: 'First scan finished', count: distinctActorsFor(AnalyticsEvent.SCAN_COMPLETED) },
    { stage: 'Downloaded PDF', count: distinctActorsFor(AnalyticsEvent.PDF_REPORT_DOWNLOADED) },
  ];

  // ── Events by day ──────────────────────────────────────────────────
  // Output shape: [{ day: 'YYYY-MM-DD', scan_completed: 3, ai_fix_used: 1, ... }]
  // — exactly what Recharts wants for a multi-series line.
  const dayMap = new Map<string, Record<string, number>>();
  for (const row of events) {
    const day = (row.created_at as string).slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, {});
    const bucket = dayMap.get(day)!;
    bucket[row.event_name] = (bucket[row.event_name] ?? 0) + 1;
  }
  const events_by_day = Array.from(dayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, counts]) => ({ day, ...counts }));

  // ── Top events leaderboard ─────────────────────────────────────────
  const top_events = Array.from(byEvent.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([event_name, count]) => ({ event_name, count }));

  return NextResponse.json(
    { window_days: days, kpis, funnel, events_by_day, top_events },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
