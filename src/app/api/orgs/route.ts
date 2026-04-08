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
    return NextResponse.json(data);
  }

  // List all orgs for the authenticated user
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, is_sandbox, connection_status, last_scan_score, last_scan_at, cpq_package_version')
    .eq('user_id', user.id)
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
