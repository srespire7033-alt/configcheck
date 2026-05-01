import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/orgs or /api/orgs?orgId=xxx
 */
/**
 * DELETE /api/orgs?orgId=xxx — Soft-disconnect (preserves scan history).
 * Pass &mode=forget to hard-delete permanently (history wiped via cascade).
 */
export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = request.nextUrl.searchParams.get('orgId');
  const mode = request.nextUrl.searchParams.get('mode'); // 'forget' = hard delete
  if (!orgId) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Verify user owns this org
  const { data: org, error: fetchError } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .eq('user_id', user.id)
    .single();

  if (fetchError || !org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  if (mode === 'forget') {
    // Hard delete — cascade wipes all scans, issues, schedules.
    const { error: deleteError } = await supabase
      .from('organizations')
      .delete()
      .eq('id', orgId)
      .eq('user_id', user.id);
    if (deleteError) {
      console.error('Failed to forget org:', deleteError);
      return NextResponse.json({ error: 'Failed to permanently delete organization' }, { status: 500 });
    }
    return NextResponse.json({ success: true, name: org.name, mode: 'forget' });
  }

  // Soft disconnect — drop credentials but preserve scans/issues/schedules.
  // Reconnecting via OAuth with the same Salesforce org id will clear
  // disconnected_at and repopulate tokens.
  const { error: updateError } = await supabase
    .from('organizations')
    .update({
      disconnected_at: new Date().toISOString(),
      access_token: null,
      refresh_token: null,
      connection_status: 'expired',
    })
    .eq('id', orgId)
    .eq('user_id', user.id);

  if (updateError) {
    console.error('Failed to disconnect org:', updateError);
    return NextResponse.json({ error: 'Failed to disconnect organization' }, { status: 500 });
  }

  return NextResponse.json({ success: true, name: org.name, mode: 'disconnect' });
}

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

  // List orgs for the authenticated user. By default returns active
  // (non-disconnected) orgs; pass ?status=disconnected to fetch the
  // archive of orgs the user has soft-disconnected (scan history kept).
  const status = request.nextUrl.searchParams.get('status');
  const queryBuilder = supabase
    .from('organizations')
    .select('*')
    .eq('user_id', user.id);
  if (status === 'disconnected') {
    queryBuilder.not('disconnected_at', 'is', null);
  } else {
    queryBuilder.is('disconnected_at', null);
  }
  const { data, error } = await queryBuilder.order('created_at', { ascending: false });

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
