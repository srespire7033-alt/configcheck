import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/account/export
 * Export all user data as JSON (GDPR Right to Data Portability)
 */
export async function GET(request: NextRequest) {
  const limiter = rateLimit(request, { maxRequests: 3, windowMs: 60_000 });
  if (!limiter.success) return rateLimitResponse(limiter);

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

    // Strip ALL sensitive credentials from organizations before exporting.
    // - access_token / refresh_token: Salesforce session credentials
    // - sf_client_id / sf_client_secret: the customer's OAuth Consumer Key
    //   and Consumer Secret for their External Client App. The secret is a
    //   bearer credential that never expires unless rotated — leaking it
    //   into a downloadable JSON would let anyone holding the file
    //   impersonate the customer's OAuth app indefinitely.
    // - sf_login_url: paired with the above and not user-facing data.
    const sanitizedOrgs = (organizations ?? []).map((org) => {
      const {
        access_token: _at,
        refresh_token: _rt,
        sf_client_id: _ci,
        sf_client_secret: _cs,
        sf_login_url: _lu,
        ...safe
      } = org;
      void _at; void _rt; void _ci; void _cs; void _lu;
      return safe;
    });

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
