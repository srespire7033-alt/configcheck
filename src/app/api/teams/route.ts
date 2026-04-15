import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { getUserTeams, logTeamActivity } from '@/lib/team/helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/teams — list teams the user belongs to
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const teams = await getUserTeams(user.id);
    return NextResponse.json(teams);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 });
  }
}

/**
 * POST /api/teams — create a new team
 * Body: { name: string, slug?: string }
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { name, slug: rawSlug } = await request.json();

    if (!name || name.trim().length < 2) {
      return NextResponse.json({ error: 'Team name must be at least 2 characters' }, { status: 400 });
    }

    // Generate slug from name if not provided
    const slug = (rawSlug || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);

    if (!slug) {
      return NextResponse.json({ error: 'Invalid team name for URL' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Check slug uniqueness
    const { data: existing } = await supabase
      .from('teams')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existing) {
      return NextResponse.json({ error: 'Team URL slug is already taken' }, { status: 409 });
    }

    // Create team
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({
        name: name.trim(),
        slug,
        owner_id: user.id,
      })
      .select()
      .single();

    if (teamError || !team) {
      return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
    }

    // Add creator as owner member
    await supabase.from('team_members').insert({
      team_id: team.id,
      user_id: user.id,
      role: 'owner',
      invited_by: user.id,
    });

    // Set as active team
    await supabase
      .from('users')
      .update({ active_team_id: team.id })
      .eq('id', user.id);

    // Log activity
    await logTeamActivity(team.id, user.id, 'team_created', 'team', team.id, { name: team.name });

    return NextResponse.json(team, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
