import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { assertTeamAccess, logTeamActivity } from '@/lib/team/helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/teams/[teamId]/invitations — list pending invitations
 */
export async function GET(request: NextRequest, { params }: { params: { teamId: string } }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await assertTeamAccess(params.teamId, user.id, 'admin');

    const supabase = createServiceClient();
    const { data } = await supabase
      .from('team_invitations')
      .select('id, email, role, status, expires_at, created_at, invited_by, users:invited_by(full_name)')
      .eq('team_id', params.teamId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    return NextResponse.json(data || []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 403 });
  }
}

/**
 * POST /api/teams/[teamId]/invitations — send invitation
 * Body: { email: string, role: 'admin' | 'viewer' }
 */
export async function POST(request: NextRequest, { params }: { params: { teamId: string } }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await assertTeamAccess(params.teamId, user.id, 'admin');

    const { email, role } = await request.json();

    if (!email || !role || !['admin', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Valid email and role (admin/viewer) required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Check if already a member
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      const { data: existingMember } = await supabase
        .from('team_members')
        .select('id')
        .eq('team_id', params.teamId)
        .eq('user_id', existingUser.id)
        .single();

      if (existingMember) {
        return NextResponse.json({ error: 'This user is already a team member' }, { status: 409 });
      }
    }

    // Check if pending invitation exists
    const { data: existingInvite } = await supabase
      .from('team_invitations')
      .select('id')
      .eq('team_id', params.teamId)
      .eq('email', email.toLowerCase())
      .eq('status', 'pending')
      .single();

    if (existingInvite) {
      return NextResponse.json({ error: 'A pending invitation already exists for this email' }, { status: 409 });
    }

    // Create invitation
    const { data: invitation, error } = await supabase
      .from('team_invitations')
      .insert({
        team_id: params.teamId,
        email: email.toLowerCase(),
        role,
        invited_by: user.id,
      })
      .select()
      .single();

    if (error || !invitation) {
      return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 });
    }

    // TODO: Send invitation email with link to /invite/{token}
    // For now, log the token for manual testing
    console.log(`[INVITE] Team invitation created: ${process.env.NEXT_PUBLIC_APP_URL}/invite/${invitation.token}`);

    await logTeamActivity(params.teamId, user.id, 'member_invited', 'invitation', invitation.id, { email, role });

    return NextResponse.json({ success: true, invitationId: invitation.id }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 403 });
  }
}

/**
 * DELETE /api/teams/[teamId]/invitations?id=x — revoke invitation
 */
export async function DELETE(request: NextRequest, { params }: { params: { teamId: string } }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await assertTeamAccess(params.teamId, user.id, 'admin');

    const url = new URL(request.url);
    const invitationId = url.searchParams.get('id');
    if (!invitationId) return NextResponse.json({ error: 'Invitation ID required' }, { status: 400 });

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('team_invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId)
      .eq('team_id', params.teamId);

    if (error) return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
