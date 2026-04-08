import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';

/**
 * GET /api/orgs or /api/orgs?orgId=xxx
 */
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId');
  const supabase = createServiceClient();

  if (orgId) {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  }

  // List all orgs for the user
  // TODO: filter by user_id from session once auth is wired up
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, is_sandbox, connection_status, last_scan_score, last_scan_at, cpq_package_version')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }

  // Map to OrgCardData format
  const orgs = (data || []).map((org) => ({
    ...org,
    critical_count: 0, // Would need a join/subquery in production
  }));

  return NextResponse.json(orgs);
}
