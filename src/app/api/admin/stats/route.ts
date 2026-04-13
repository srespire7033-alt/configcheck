import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { isAdmin } from '@/lib/auth/is-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/stats
 * Returns platform-wide stats for admin users.
 * Requires authenticated user with admin email.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createServiceClient();

  const [
    usersRes,
    orgsRes,
    scansCountRes,
    issuesCountRes,
    usageLogsRes,
    orgsByUserRes,
    scansByUserRes,
  ] = await Promise.all([
    supabase.from('users').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('organizations').select('id', { count: 'exact', head: true }),
    supabase.from('scans').select('id', { count: 'exact', head: true }),
    supabase.from('issues').select('id', { count: 'exact', head: true }),
    supabase.from('usage_logs').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('organizations').select('id, user_id'),
    supabase.from('scans').select('id, user_id'),
  ]);

  const users = usersRes.data || [];
  const usageLogs = usageLogsRes.data || [];
  const orgs = orgsByUserRes.data || [];
  const scans = scansByUserRes.data || [];

  // Build per-user org and scan counts
  const orgCountByUser: Record<string, number> = {};
  orgs.forEach((o) => {
    orgCountByUser[o.user_id] = (orgCountByUser[o.user_id] || 0) + 1;
  });

  const scanCountByUser: Record<string, number> = {};
  scans.forEach((s) => {
    scanCountByUser[s.user_id] = (scanCountByUser[s.user_id] || 0) + 1;
  });

  // Plan distribution
  const planDist: Record<string, number> = { free: 0, solo: 0, practice: 0, partner: 0 };
  users.forEach((u) => {
    const plan = u.plan || 'free';
    planDist[plan] = (planDist[plan] || 0) + 1;
  });

  // Count AI calls and PDF reports from usage logs
  const aiEventTypes = ['ai_remediation', 'ai_scan_diff', 'ai_fix_suggestion'];
  let totalAiCalls = 0;
  let totalPdfReports = 0;
  usageLogs.forEach((log) => {
    if (aiEventTypes.includes(log.event_type)) totalAiCalls++;
    if (log.event_type === 'pdf_report') totalPdfReports++;
  });

  // Build user email lookup for activity feed
  const userEmailMap: Record<string, string> = {};
  users.forEach((u) => {
    userEmailMap[u.id] = u.email;
  });

  // Users with counts
  const usersWithStats = users.map((u) => ({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    company_name: u.company_name,
    plan: u.plan || 'free',
    orgs_count: orgCountByUser[u.id] || 0,
    scans_count: scanCountByUser[u.id] || 0,
    created_at: u.created_at,
  }));

  // Recent activity with user email
  const recentActivity = usageLogs.slice(0, 20).map((log) => ({
    id: log.id,
    user_email: userEmailMap[log.user_id] || 'Unknown',
    event_type: log.event_type,
    metadata: log.metadata,
    created_at: log.created_at,
  }));

  // New users this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const newUsersThisMonth = users.filter((u) => u.created_at >= monthStart).length;

  return NextResponse.json({
    summary: {
      total_users: users.length,
      new_users_this_month: newUsersThisMonth,
      total_orgs: orgsRes.count || 0,
      total_scans: scansCountRes.count || 0,
      total_issues: issuesCountRes.count || 0,
      total_ai_calls: totalAiCalls,
      total_pdf_reports: totalPdfReports,
    },
    plan_distribution: planDist,
    users: usersWithStats,
    recent_activity: recentActivity,
  });
}
