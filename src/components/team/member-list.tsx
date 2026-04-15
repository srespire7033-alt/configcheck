'use client';

import { useState } from 'react';
import { Shield, ShieldCheck, Eye, MoreVertical, UserMinus, ArrowUpDown } from 'lucide-react';

interface Member {
  id: string;
  role: string;
  joined_at: string;
  user_id: string;
  users: { id: string; email: string; full_name: string; avatar_url: string | null };
}

interface MemberListProps {
  members: Member[];
  currentUserId: string;
  currentUserRole: string;
  teamId: string;
  onMemberUpdated: () => void;
}

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  owner: { label: 'Owner', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: ShieldCheck },
  admin: { label: 'Admin', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Shield },
  viewer: { label: 'Viewer', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400', icon: Eye },
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function MemberList({ members, currentUserId, currentUserRole, teamId, onMemberUpdated }: MemberListProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin';

  async function handleRoleChange(memberId: string, userId: string, newRole: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (res.ok) {
        onMemberUpdated();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to change role');
      }
    } catch {
      alert('Failed to change role');
    } finally {
      setLoading(false);
      setChangingRole(null);
      setOpenMenuId(null);
    }
  }

  async function handleRemove(userId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/members?userId=${userId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        onMemberUpdated();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to remove member');
      }
    } catch {
      alert('Failed to remove member');
    } finally {
      setLoading(false);
      setConfirmRemove(null);
      setOpenMenuId(null);
    }
  }

  async function handleLeave() {
    setLoading(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/members?userId=${currentUserId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        window.location.href = '/dashboard';
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to leave team');
      }
    } catch {
      alert('Failed to leave team');
    } finally {
      setLoading(false);
      setConfirmLeave(false);
    }
  }

  return (
    <div className="space-y-2">
      {members.map((member) => {
        const roleConfig = ROLE_CONFIG[member.role] || ROLE_CONFIG.viewer;
        const RoleIcon = roleConfig.icon;
        const isSelf = member.user_id === currentUserId;
        const isOwner = member.role === 'owner';
        const showMenu = canManage && !isSelf && !isOwner;

        return (
          <div
            key={member.id}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-100 dark:border-gray-700/60 bg-white dark:bg-[#111827] hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          >
            {/* Avatar */}
            {member.users.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={member.users.avatar_url}
                alt={member.users.full_name}
                className="w-9 h-9 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-teal-500 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-white">
                  {getInitials(member.users.full_name || member.users.email)}
                </span>
              </div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {member.users.full_name || 'Unnamed'}
                </span>
                {isSelf && (
                  <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                    You
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{member.users.email}</p>
            </div>

            {/* Role badge */}
            <div className={`flex items-center gap-1 text-[11px] font-semibold uppercase px-2 py-1 rounded-md ${roleConfig.color}`}>
              <RoleIcon className="h-3 w-3" />
              {roleConfig.label}
            </div>

            {/* Joined */}
            <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block w-16 text-right">
              {timeAgo(member.joined_at)}
            </span>

            {/* Action menu */}
            {showMenu ? (
              <div className="relative">
                <button
                  onClick={() => setOpenMenuId(openMenuId === member.id ? null : member.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>

                {openMenuId === member.id && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-[#111827] rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                    {changingRole === member.id ? (
                      <div className="px-3 py-2 space-y-1">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Change role to:</p>
                        {['admin', 'viewer'].filter((r) => r !== member.role).map((role) => (
                          <button
                            key={role}
                            onClick={() => handleRoleChange(member.id, member.user_id, role)}
                            disabled={loading}
                            className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 capitalize disabled:opacity-50"
                          >
                            {role}
                          </button>
                        ))}
                        <button
                          onClick={() => setChangingRole(null)}
                          className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : confirmRemove === member.id ? (
                      <div className="px-3 py-2 space-y-2">
                        <p className="text-xs text-gray-600 dark:text-gray-400">Remove this member?</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleRemove(member.user_id)}
                            disabled={loading}
                            className="flex-1 px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                          >
                            {loading ? 'Removing...' : 'Remove'}
                          </button>
                          <button
                            onClick={() => setConfirmRemove(null)}
                            className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setChangingRole(member.id)}
                          className="w-full flex items-center gap-2 px-3.5 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                        >
                          <ArrowUpDown className="h-3.5 w-3.5" />
                          Change Role
                        </button>
                        <button
                          onClick={() => setConfirmRemove(member.id)}
                          className="w-full flex items-center gap-2 px-3.5 py-2 text-sm text-left hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                          Remove Member
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-8" /> /* spacer for alignment */
            )}
          </div>
        );
      })}

      {/* Leave Team button for non-owners */}
      {currentUserRole !== 'owner' && (
        <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
          {confirmLeave ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">Are you sure you want to leave this team?</p>
              <button
                onClick={handleLeave}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? 'Leaving...' : 'Yes, Leave'}
              </button>
              <button
                onClick={() => setConfirmLeave(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmLeave(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <UserMinus className="h-4 w-4" />
              Leave Team
            </button>
          )}
        </div>
      )}
    </div>
  );
}
