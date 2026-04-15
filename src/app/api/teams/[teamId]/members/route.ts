import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { assertTeamAccess, logTeamActivity } from '@/lib/team/helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/teams/[teamId]/members — list members
 */
export async function GET(request: NextRequest, { params }: { params: { teamId: string } }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await assertTeamAccess(params.teamId, user.id, 'member');

    const supabase = createServiceClient();
    const { data: members } = await supabase
      .from('team_members')
      .select('id, role, joined_at, user_id, users:user_id(id, email, full_name, avatar_url)')
      .eq('team_id', params.teamId)
      .order('joined_at', { ascending: true });

    return NextResponse.json(members || []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 403 });
  }
}

/**
 * PUT /api/teams/[teamId]/members — update member role
 * Body: { userId: string, role: 'admin' | 'viewer' }
 */
export async function PUT(request: NextRequest, { params }: { params: { teamId: string } }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const callerRole = await assertTeamAccess(params.teamId, user.id, 'admin');
    const { userId, role } = await request.json();

    if (!userId || !role || !['admin', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid userId or role' }, { status: 400 });
    }

    // Cannot change owner's role
    const supabase = createServiceClient();
    const { data: target } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', params.teamId)
      .eq('user_id', userId)
      .single();

    if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    if (target.role === 'owner') return NextResponse.json({ error: 'Cannot change owner role' }, { status: 403 });

    // Only owner can promote to admin
    if (role === 'admin' && callerRole !== 'owner') {
      return NextResponse.json({ error: 'Only the owner can promote to admin' }, { status: 403 });
    }

    const { error } = await supabase
      .from('team_members')
      .update({ role })
      .eq('team_id', params.teamId)
      .eq('user_id', userId);

    if (error) return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });

    await logTeamActivity(params.teamId, user.id, 'member_role_changed', 'member', userId, { newRole: role });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 403 });
  }
}

/**
 * DELETE /api/teams/[teamId]/members?userId=x — remove member
 */
export async function DELETE(request: NextRequest, { params }: { params: { teamId: string } }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const url = new URL(request.url);
    const targetUserId = url.searchParams.get('userId');

    if (!targetUserId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const supabase = createServiceClient();

    // Self-leave: any member can leave
    if (targetUserId === user.id) {
      const { data: self } = await supabase
        .from('team_members')
        .select('role')
        .eq('team_id', params.teamId)
        .eq('user_id', user.id)
        .single();

      if (!self) return NextResponse.json({ error: 'Not a member' }, { status: 404 });
      if (self.role === 'owner') return NextResponse.json({ error: 'Owner cannot leave. Transfer ownership first.' }, { status: 403 });
    } else {
      // Removing someone else: admin required
      await assertTeamAccess(params.teamId, user.id, 'admin');

      // Cannot remove the owner
      const { data: target } = await supabase
        .from('team_members')
        .select('role')
        .eq('team_id', params.teamId)
        .eq('user_id', targetUserId)
        .single();

      if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      if (target.role === 'owner') return NextResponse.json({ error: 'Cannot remove the owner' }, { status: 403 });
    }

    // Remove member
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', params.teamId)
      .eq('user_id', targetUserId);

    if (error) return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });

    // Clear their active_team_id if it was this team
    await supabase
      .from('users')
      .update({ active_team_id: null })
      .eq('id', targetUserId)
      .eq('active_team_id', params.teamId);

    await logTeamActivity(params.teamId, user.id, targetUserId === user.id ? 'member_left' : 'member_removed', 'member', targetUserId);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
