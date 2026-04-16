'use client';

import { useState, useEffect } from 'react';
import { Users, Scan, Cloud, FileText, Shield, UserPlus, UserMinus, LogOut } from 'lucide-react';
import { formatTimeAgo } from '@/lib/utils';

interface ActivityItem {
  id: string;
  action: string;
  details: Record<string, string> | null;
  created_at: string;
  user_id: string;
  users?: { full_name: string; email: string; avatar_url: string | null } | null;
}

interface ActivityFeedProps {
  teamId: string;
}

const ACTION_CONFIG: Record<string, { icon: React.ElementType; color: string; bgColor: string }> = {
  team_created: { icon: Users, color: 'text-blue-500', bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  member_invited: { icon: UserPlus, color: 'text-amber-500', bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  member_joined: { icon: UserPlus, color: 'text-green-500', bgColor: 'bg-green-100 dark:bg-green-900/30' },
  member_removed: { icon: UserMinus, color: 'text-red-500', bgColor: 'bg-red-100 dark:bg-red-900/30' },
  member_left: { icon: LogOut, color: 'text-orange-500', bgColor: 'bg-orange-100 dark:bg-orange-900/30' },
  scan_started: { icon: Scan, color: 'text-teal-500', bgColor: 'bg-teal-100 dark:bg-teal-900/30' },
  org_connected: { icon: Cloud, color: 'text-purple-500', bgColor: 'bg-purple-100 dark:bg-purple-900/30' },
  member_role_changed: { icon: Shield, color: 'text-indigo-500', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
};

function formatActionText(action: string, details: Record<string, string> | null): string {
  switch (action) {
    case 'team_created':
      return 'created the team';
    case 'member_invited':
      return `invited ${details?.email || 'a member'}`;
    case 'member_joined':
      return 'joined the team';
    case 'member_removed':
      return `removed ${details?.member_name || 'a member'}`;
    case 'member_left':
      return 'left the team';
    case 'scan_started':
      return `started a scan${details?.org_name ? ` on ${details.org_name}` : ''}`;
    case 'org_connected':
      return `connected ${details?.org_name || 'an org'}`;
    case 'member_role_changed':
      return `changed ${details?.member_name || 'a member'}'s role to ${details?.new_role || 'unknown'}`;
    default:
      return action.replace(/_/g, ' ');
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function ActivityFeed({ teamId }: ActivityFeedProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      try {
        const res = await fetch(`/api/teams/${teamId}/activity?limit=30`);
        if (res.ok) {
          const data = await res.json();
          setActivities(data.activities || []);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchActivity();
  }, [teamId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-blue-200 dark:border-blue-800 border-t-blue-600 dark:border-t-blue-400 animate-spin" />
        <p className="text-xs text-gray-400">Loading activity...</p>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
          <FileText className="h-5 w-5 text-gray-400" />
        </div>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No activity yet</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Team actions will appear here</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-[19px] top-3 bottom-3 w-px bg-gray-200 dark:bg-gray-700" />

      <div className="space-y-0">
        {activities.map((activity) => {
          const config = ACTION_CONFIG[activity.action] || ACTION_CONFIG.team_created;
          const Icon = config.icon;
          const userName = activity.users?.full_name || activity.users?.email || 'Unknown';

          return (
            <div key={activity.id} className="relative flex gap-3 py-3 pl-0">
              {/* Icon */}
              <div className={`relative z-10 w-10 h-10 rounded-full ${config.bgColor} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`h-4 w-4 ${config.color}`} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-1">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium text-gray-900 dark:text-white">{userName}</span>
                  {' '}
                  {formatActionText(activity.action, activity.details)}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {formatTimeAgo(activity.created_at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
