import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/usage
 * Returns usage stats for the current user: total scans, scans this month,
 * AI calls, and PDF reports generated.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Get first day of current month in ISO
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Fetch all usage logs for this user
  const [totalRes, monthRes, byTypeRes] = await Promise.all([
    // Total scans ever
    supabase
      .from('usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('event_type', 'scan'),
    // Scans this month
    supabase
      .from('usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('event_type', 'scan')
      .gte('created_at', monthStart),
    // All events this month grouped by type
    supabase
      .from('usage_logs')
      .select('event_type, created_at')
      .eq('user_id', user.id)
      .gte('created_at', monthStart)
      .order('created_at', { ascending: false }),
  ]);

  // Count by type
  const eventCounts: Record<string, number> = {};
  (byTypeRes.data || []).forEach((log) => {
    eventCounts[log.event_type] = (eventCounts[log.event_type] || 0) + 1;
  });

  // Build daily scan chart data for current month
  const dailyScans: Record<string, number> = {};
  (byTypeRes.data || [])
    .filter((l) => l.event_type === 'scan')
    .forEach((log) => {
      const day = log.created_at.split('T')[0];
      dailyScans[day] = (dailyScans[day] || 0) + 1;
    });

  return NextResponse.json({
    total_scans: totalRes.count || 0,
    scans_this_month: monthRes.count || 0,
    ai_calls_this_month: (eventCounts['ai_remediation'] || 0) + (eventCounts['ai_scan_diff'] || 0) + (eventCounts['ai_fix_suggestion'] || 0),
    pdf_reports_this_month: eventCounts['pdf_report'] || 0,
    daily_scans: dailyScans,
    event_counts: eventCounts,
  });
}

/**
 * POST /api/usage
 * Log a usage event (for client-triggered events like PDF downloads, AI calls)
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { event_type, organization_id, metadata } = body;

  const validTypes = ['pdf_report', 'ai_remediation', 'ai_scan_diff', 'ai_fix_suggestion'];
  if (!validTypes.includes(event_type)) {
    return NextResponse.json({ error: 'Invalid event_type' }, { status: 400 });
  }

  const supabase = createServiceClient();
  await supabase.from('usage_logs').insert({
    user_id: user.id,
    event_type,
    organization_id: organization_id || null,
    metadata: metadata || {},
  });

  return NextResponse.json({ success: true });
}
