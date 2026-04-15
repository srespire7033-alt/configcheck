'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, UserPlus, Shield, Building2, Mail, X, Clock, Plus } from 'lucide-react';
import { MemberList } from '@/components/team/member-list';
import { InviteModal } from '@/components/team/invite-modal';
import { ActivityFeed } from '@/components/team/activity-feed';
import { LoadingScreen } from '@/components/ui/loading-screen';

interface TeamData {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

interface Member {
  id: string;
  role: string;
  joined_at: string;
  user_id: string;
  users: { id: string; email: string; full_name: string; avatar_url: string | null };
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

export default function TeamPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<TeamData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState('viewer');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function loadData() {
    try {
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) return;
      const me = await meRes.json();
      setCurrentUserId(me.id);
      setActiveTeamId(me.active_team_id || null);

      if (!me.active_team_id) {
        setLoading(false);
        return;
      }

      const [teamRes, membersRes, invitesRes] = await Promise.all([
        fetch(`/api/teams/${me.active_team_id}`),
        fetch(`/api/teams/${me.active_team_id}/members`),
        fetch(`/api/teams/${me.active_team_id}/invitations`),
      ]);

      if (teamRes.ok) {
        const data = await teamRes.json();
        setTeam(data.team || data);
      }
      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.members || []);
        const myMembership = (data.members || []).find((m: Member) => m.user_id === me.id);
        if (myMembership) setCurrentUserRole(myMembership.role);
      }
      if (invitesRes.ok) {
        const data = await invitesRes.json();
        setInvitations((data.invitations || []).filter((i: Invitation) => i.status === 'pending'));
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function revokeInvitation(invitationId: string) {
    setRevokingId(invitationId);
    try {
      const res = await fetch(`/api/teams/${activeTeamId}/invitations?invitationId=${invitationId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
      }
    } catch {
      // silently fail
    } finally {
      setRevokingId(null);
    }
  }

  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin';

  if (loading) return <LoadingScreen />;

  // No active team - show CTA
  if (!activeTeamId || !team) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111827] shadow-sm overflow-hidden">
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-teal-500 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-6">
              <Users className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              No Team Selected
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-8 max-w-sm">
              Create a team to collaborate with your colleagues on Salesforce config audits, or switch to an existing team from the header.
            </p>
            <button
              onClick={() => router.push('/team/new')}
              className="flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm shadow-blue-200 dark:shadow-blue-900/30 transition-all"
            >
              <Plus className="h-4 w-4" />
              Create a Team
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-teal-500 flex items-center justify-center shadow-sm">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            {team.name}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[52px]">
            {members.length} member{members.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm shadow-blue-200 dark:shadow-blue-900/30 transition-all self-start"
          >
            <UserPlus className="h-4 w-4" />
            Invite Member
          </button>
        )}
      </div>

      {/* Two column layout */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left column - Members */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Members */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111827] shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700/80">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Shield className="h-4 w-4 text-gray-400" />
                Members
              </h3>
            </div>
            <div className="p-4">
              <MemberList
                members={members}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                teamId={team.id}
                onMemberUpdated={loadData}
              />
            </div>
          </div>

          {/* Pending invitations */}
          {canManage && invitations.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111827] shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700/80">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Mail className="h-4 w-4 text-gray-400" />
                  Pending Invitations
                  <span className="ml-auto text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
                    {invitations.length}
                  </span>
                </h3>
              </div>
              <div className="p-4 space-y-2">
                {invitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-100 dark:border-gray-700/60 bg-white dark:bg-[#111827]"
                  >
                    <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                      <Mail className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{inv.email}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Invited {new Date(inv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        <span className="mx-1">·</span>
                        <span className="capitalize">{inv.role}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => revokeInvitation(inv.id)}
                      disabled={revokingId === inv.id}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      title="Revoke invitation"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column - Activity */}
        <div className="lg:w-[380px] flex-shrink-0">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111827] shadow-sm lg:sticky lg:top-20">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700/80">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-400" />
                Recent Activity
              </h3>
            </div>
            <div className="p-4 max-h-[600px] overflow-y-auto">
              <ActivityFeed teamId={team.id} />
            </div>
          </div>
        </div>
      </div>

      {/* Invite modal */}
      <InviteModal
        teamId={team.id}
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onInvited={loadData}
      />
    </div>
  );
}
