import { createServiceClient } from '@/lib/db/client';

export type TeamRole = 'owner' | 'admin' | 'viewer';

export interface TeamMembership {
  teamId: string;
  teamName: string;
  teamSlug: string;
  role: TeamRole;
}

/**
 * Get the user's role in a team. Returns null if not a member.
 */
export async function getTeamRole(teamId: string, userId: string): Promise<TeamRole | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .single();

  return (data?.role as TeamRole) ?? null;
}

/**
 * Check if a user is a member of a team.
 */
export async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const role = await getTeamRole(teamId, userId);
  return role !== null;
}

/**
 * Check if a user is an admin or owner of a team.
 */
export async function isTeamAdmin(teamId: string, userId: string): Promise<boolean> {
  const role = await getTeamRole(teamId, userId);
  return role === 'owner' || role === 'admin';
}

/**
 * Assert the user has the required role. Throws if not.
 */
export async function assertTeamAccess(
  teamId: string,
  userId: string,
  requiredRole: 'member' | 'admin' | 'owner'
): Promise<TeamRole> {
  const role = await getTeamRole(teamId, userId);

  if (!role) {
    throw new Error('Not a team member');
  }

  if (requiredRole === 'owner' && role !== 'owner') {
    throw new Error('Owner access required');
  }

  if (requiredRole === 'admin' && role === 'viewer') {
    throw new Error('Admin access required');
  }

  return role;
}

/**
 * Get all teams a user belongs to.
 */
export async function getUserTeams(userId: string): Promise<TeamMembership[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('team_members')
    .select('role, teams:team_id(id, name, slug)')
    .eq('user_id', userId);

  if (!data) return [];

  return data.map((row: Record<string, unknown>) => {
    const team = row.teams as unknown as Record<string, unknown>;
    return {
      teamId: team.id as string,
      teamName: team.name as string,
      teamSlug: team.slug as string,
      role: row.role as TeamRole,
    };
  });
}

/**
 * Get the user's active team context (from users.active_team_id).
 * Returns null if the user is in personal/solo mode.
 */
export async function getUserActiveTeam(userId: string): Promise<TeamMembership | null> {
  const supabase = createServiceClient();

  const { data: user } = await supabase
    .from('users')
    .select('active_team_id')
    .eq('id', userId)
    .single();

  if (!user?.active_team_id) return null;

  const { data: membership } = await supabase
    .from('team_members')
    .select('role, teams:team_id(id, name, slug)')
    .eq('team_id', user.active_team_id)
    .eq('user_id', userId)
    .single();

  if (!membership) return null;

  const team = membership.teams as unknown as Record<string, unknown>;
  return {
    teamId: team.id as string,
    teamName: team.name as string,
    teamSlug: team.slug as string,
    role: membership.role as TeamRole,
  };
}

/**
 * Log a team activity event.
 */
export async function logTeamActivity(
  teamId: string,
  userId: string,
  action: string,
  resourceType?: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from('team_activity_log').insert({
    team_id: teamId,
    user_id: userId,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    metadata: metadata ?? {},
  });
}

/**
 * Check if a user has access to an organization (either owns it or is a team member).
 */
export async function hasOrgAccess(orgId: string, userId: string): Promise<{ hasAccess: boolean; role: TeamRole | 'owner'; isTeamOrg: boolean }> {
  const supabase = createServiceClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('user_id, team_id')
    .eq('id', orgId)
    .single();

  if (!org) return { hasAccess: false, role: 'viewer', isTeamOrg: false };

  // Direct owner
  if (org.user_id === userId) {
    return { hasAccess: true, role: 'owner', isTeamOrg: !!org.team_id };
  }

  // Team member
  if (org.team_id) {
    const role = await getTeamRole(org.team_id, userId);
    if (role) return { hasAccess: true, role, isTeamOrg: true };
  }

  return { hasAccess: false, role: 'viewer', isTeamOrg: false };
}
