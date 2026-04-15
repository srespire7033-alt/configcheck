import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { isTeamMember } from '@/lib/team/helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/switch-team — switch active team context
 * Body: { teamId: string | null }
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { teamId } = await request.json();

    // If switching to a team, verify membership
    if (teamId) {
      const isMember = await isTeamMember(teamId, user.id);
      if (!isMember) {
        return NextResponse.json({ error: 'Not a member of this team' }, { status: 403 });
      }
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('users')
      .update({ active_team_id: teamId })
      .eq('id', user.id);

    if (error) return NextResponse.json({ error: 'Failed to switch team' }, { status: 500 });

    return NextResponse.json({ success: true, activeTeamId: teamId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
