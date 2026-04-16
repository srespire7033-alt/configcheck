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
  const supabase = createServiceClient({ noCache: true });


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
  // NOTE: Using select('*') to avoid PostgREST stale-data caching on specific columns
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }

  // Fetch latest scan data for each org from scans table (source of truth)
  const orgIds = (data || []).map((o) => o.id);
  const latestScanMap: Record<string, { score: number; timestamp: string }> = {};

  if (orgIds.length > 0) {
    const { data: scans } = await supabase
      .from('scans')
      .select('organization_id, overall_score, completed_at, created_at')
      .in('organization_id', orgIds)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });

    if (scans) {
      for (const scan of scans) {
        if (!latestScanMap[scan.organization_id]) {
          latestScanMap[scan.organization_id] = {
            score: scan.overall_score,
            timestamp: scan.completed_at || scan.created_at,
          };
        }
      }
    }
  }

  // Map to OrgCardData format — use scans table as source of truth for score + timestamp
  const orgs = (data || []).map((org) => {
    const latestScan = latestScanMap[org.id];
    return {
      ...org,
      last_scan_score: latestScan?.score ?? org.last_scan_score,
      last_scan_at: latestScan?.timestamp ?? org.last_scan_at,
      critical_count: 0,
    };
  });

  return NextResponse.json(orgs, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
