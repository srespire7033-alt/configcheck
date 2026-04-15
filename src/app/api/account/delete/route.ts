import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/account/delete
 * Permanently delete user account and all associated data (GDPR Right to Erasure)
 */
export async function POST(request: NextRequest) {
  const limiter = rateLimit(request, { maxRequests: 10, windowMs: 60_000 });
  if (!limiter.success) return rateLimitResponse(limiter);

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (body.confirmation !== 'DELETE MY ACCOUNT') {
      return NextResponse.json(
        { error: 'Invalid confirmation. Please send { "confirmation": "DELETE MY ACCOUNT" }' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Fetch user's organization IDs for cascading deletes
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id')
      .eq('user_id', user.id);

    const orgIds = orgs?.map((org) => org.id) ?? [];

    // Delete in FK dependency order (children first)

    // 1. Delete issues (depends on scans and organizations)
    if (orgIds.length > 0) {
      const { error: issuesError } = await supabase
        .from('issues')
        .delete()
        .in('organization_id', orgIds);

      if (issuesError) {
        console.error('Failed to delete issues:', issuesError);
        throw new Error('Failed to delete issues');
      }
    }

    // 2. Delete scans (depends on organizations and users)
    const { error: scansError } = await supabase
      .from('scans')
      .delete()
      .eq('user_id', user.id);

    if (scansError) {
      console.error('Failed to delete scans:', scansError);
      throw new Error('Failed to delete scans');
    }

    // 3. Delete scan_schedules (depends on organizations and users)
    const { error: schedulesError } = await supabase
      .from('scan_schedules')
      .delete()
      .eq('user_id', user.id);

    if (schedulesError) {
      console.error('Failed to delete scan schedules:', schedulesError);
      throw new Error('Failed to delete scan schedules');
    }

    // 4. Delete usage_logs (depends on users and organizations)
    const { error: logsError } = await supabase
      .from('usage_logs')
      .delete()
      .eq('user_id', user.id);

    if (logsError) {
      console.error('Failed to delete usage logs:', logsError);
      throw new Error('Failed to delete usage logs');
    }

    // 5. Delete organizations (depends on users)
    const { error: orgsError } = await supabase
      .from('organizations')
      .delete()
      .eq('user_id', user.id);

    if (orgsError) {
      console.error('Failed to delete organizations:', orgsError);
      throw new Error('Failed to delete organizations');
    }

    // 6. Delete user record from public.users
    const { error: userError } = await supabase
      .from('users')
      .delete()
      .eq('id', user.id);

    if (userError) {
      console.error('Failed to delete user record:', userError);
      throw new Error('Failed to delete user record');
    }

    // 7. Delete auth user (Supabase auth.users)
    const { error: authError } = await supabase.auth.admin.deleteUser(user.id);

    if (authError) {
      console.error('Failed to delete auth user:', authError);
      throw new Error('Failed to delete auth user');
    }

    return NextResponse.json({ success: true, message: 'Account and all associated data have been permanently deleted' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Account deletion failed:', message);
    return NextResponse.json({ error: 'Account deletion failed. Please contact support.' }, { status: 500 });
  }
}
