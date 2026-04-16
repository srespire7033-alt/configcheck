import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/orgs or /api/orgs?orgId=xxx
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = request.nextUrl.searchParams.get('orgId');
  const supabase = createServiceClient();


  if (orgId) {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  }

  // List all orgs for the authenticated user
  const { data, error, count } = await supabase
    .from('organizations')
    .select('id, name, is_sandbox, connection_status, last_scan_score, last_scan_at, cpq_package_version, installed_packages', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  console.log('Orgs query — user:', user.id, 'count:', count, 'rows:', (data || []).length, 'error:', error);
  if (data) {
    for (const o of data) {
      console.log('  org:', o.id, o.name);
    }
  }

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }

  // Fetch latest scan completed_at for each org (single query, bulletproof timestamp source)
  const orgIds = (data || []).map((o) => o.id);
  let latestScanMap: Record<string, string> = {};

  if (orgIds.length > 0) {
    const { data: scans } = await supabase
      .from('scans')
      .select('organization_id, completed_at, created_at')
      .in('organization_id', orgIds)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });

    if (scans) {
      // Keep only the latest scan per org
      for (const scan of scans) {
        if (!latestScanMap[scan.organization_id]) {
          latestScanMap[scan.organization_id] = scan.completed_at || scan.created_at;
        }
      }
    }
  }

  // Map to OrgCardData format — use scan timestamp as the source of truth
  const orgs = (data || []).map((org) => ({
    ...org,
    last_scan_at: latestScanMap[org.id] || org.last_scan_at,
    critical_count: 0, // Would need a join/subquery in production
  }));

  return NextResponse.json(orgs, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
