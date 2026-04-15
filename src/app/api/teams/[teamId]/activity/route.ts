import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { assertTeamAccess } from '@/lib/team/helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/teams/[teamId]/activity — recent activity feed
 */
export async function GET(request: NextRequest, { params }: { params: { teamId: string } }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await assertTeamAccess(params.teamId, user.id, 'member');

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

    const supabase = createServiceClient();
    const { data } = await supabase
      .from('team_activity_log')
      .select('*, users:user_id(full_name, email, avatar_url)')
      .eq('team_id', params.teamId)
      .order('created_at', { ascending: false })
      .limit(limit);

    return NextResponse.json(data || []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
