import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { assertTeamAccess, logTeamActivity } from '@/lib/team/helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/teams/[teamId] — get team details
 */
export async function GET(request: NextRequest, { params }: { params: { teamId: string } }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await assertTeamAccess(params.teamId, user.id, 'member');

    const supabase = createServiceClient();
    const { data: team } = await supabase
      .from('teams')
      .select('*')
      .eq('id', params.teamId)
      .single();

    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    // Get member count
    const { count } = await supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', params.teamId);

    // Get org count
    const { count: orgCount } = await supabase
      .from('organizations')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', params.teamId);

    return NextResponse.json({ ...team, member_count: count || 0, org_count: orgCount || 0 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('Not a team member') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * PUT /api/teams/[teamId] — update team (owner/admin only)
 */
export async function PUT(request: NextRequest, { params }: { params: { teamId: string } }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await assertTeamAccess(params.teamId, user.id, 'admin');

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    const allowedFields = ['name', 'logo_url'];
    for (const field of allowedFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('teams')
      .update(updates)
      .eq('id', params.teamId);

    if (error) return NextResponse.json({ error: 'Failed to update team' }, { status: 500 });

    await logTeamActivity(params.teamId, user.id, 'team_updated', 'team', params.teamId, updates);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 403 });
  }
}

/**
 * DELETE /api/teams/[teamId] — delete team (owner only)
 */
export async function DELETE(request: NextRequest, { params }: { params: { teamId: string } }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await assertTeamAccess(params.teamId, user.id, 'owner');

    const supabase = createServiceClient();

    // Unassign orgs from team (don't delete them)
    await supabase
      .from('organizations')
      .update({ team_id: null })
      .eq('team_id', params.teamId);

    // Clear active_team_id for all members
    const { data: members } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', params.teamId);

    if (members) {
      for (const member of members) {
        await supabase
          .from('users')
          .update({ active_team_id: null })
          .eq('id', member.user_id)
          .eq('active_team_id', params.teamId);
      }
    }

    // Delete team (cascades to members, invitations, activity)
    const { error } = await supabase
      .from('teams')
      .delete()
      .eq('id', params.teamId);

    if (error) return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
