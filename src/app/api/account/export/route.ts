import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/account/export
 * Export all user data as JSON (GDPR Right to Data Portability)
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Fetch user profile
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Fetch organizations (exclude sensitive Salesforce tokens)
    const { data: organizations } = await supabase
      .from('organizations')
      .select('*')
      .eq('user_id', user.id);

    const orgIds = organizations?.map((org) => org.id) ?? [];

    // Strip sensitive tokens from organizations
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sanitizedOrgs = (organizations ?? []).map(({ access_token, refresh_token, ...rest }) => rest);

    // Fetch scans
    const { data: scans } = await supabase
      .from('scans')
      .select('*')
      .eq('user_id', user.id);

    // Fetch issues for user's organizations
    let issues: Record<string, unknown>[] = [];
    if (orgIds.length > 0) {
      const { data: issueData } = await supabase
        .from('issues')
        .select('*')
        .in('organization_id', orgIds);
      issues = issueData ?? [];
    }

    // Fetch usage logs
    const { data: usageLogs } = await supabase
      .from('usage_logs')
      .select('*')
      .eq('user_id', user.id);

    // Fetch scan schedules
    const { data: scanSchedules } = await supabase
      .from('scan_schedules')
      .select('*')
      .eq('user_id', user.id);

    const exportData = {
      exportDate: new Date().toISOString(),
      user: userData,
      organizations: sanitizedOrgs,
      scans: scans ?? [],
      issues,
      usageLogs: usageLogs ?? [],
      scanSchedules: scanSchedules ?? [],
    };

    return NextResponse.json(exportData);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Data export failed:', message);
    return NextResponse.json({ error: 'Data export failed' }, { status: 500 });
  }
}
