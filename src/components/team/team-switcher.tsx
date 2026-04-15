'use client';

import { useState, useEffect, useRef } from 'react';
import { Users, ChevronDown, Check, Plus, User } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Team {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export function TeamSwitcher() {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const [teamsRes, meRes] = await Promise.all([
          fetch('/api/teams'),
          fetch('/api/auth/me'),
        ]);
        if (teamsRes.ok) {
          const data = await teamsRes.json();
          setTeams(data.teams || []);
        }
        if (meRes.ok) {
          const data = await meRes.json();
          setActiveTeamId(data.active_team_id || null);
        }
      } catch {
        // silently fail
      }
    }
    load();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function switchTeam(teamId: string | null) {
    if (switching) return;
    setSwitching(true);
    setOpen(false);
    try {
      const res = await fetch('/api/auth/switch-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      // silently fail
    } finally {
      setSwitching(false);
    }
  }

  const activeTeam = teams.find((t) => t.id === activeTeamId);
  const label = activeTeam ? activeTeam.name : 'Personal';

  const roleBadgeColor: Record<string, string> = {
    owner: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    admin: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    viewer: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={switching}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors border border-gray-200 dark:border-gray-700"
      >
        {activeTeam ? (
          <Users className="h-3.5 w-3.5 text-blue-500" />
        ) : (
          <User className="h-3.5 w-3.5 text-gray-400" />
        )}
        <span className="max-w-[120px] truncate hidden sm:inline">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-64 bg-white dark:bg-[#111827] rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1.5 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Personal */}
          <button
            onClick={() => switchTeam(null)}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
              <User className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
            </div>
            <span className="flex-1 font-medium text-gray-900 dark:text-white">Personal</span>
            {!activeTeamId && <Check className="h-4 w-4 text-blue-500" />}
          </button>

          {teams.length > 0 && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-700/60 my-1" />
              {teams.map((team) => (
                <button
                  key={team.id}
                  onClick={() => switchTeam(team.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <Users className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-gray-900 dark:text-white truncate block">{team.name}</span>
                  </div>
                  <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${roleBadgeColor[team.role] || roleBadgeColor.viewer}`}>
                    {team.role}
                  </span>
                  {activeTeamId === team.id && <Check className="h-4 w-4 text-blue-500 flex-shrink-0" />}
                </button>
              ))}
            </>
          )}

          <div className="border-t border-gray-100 dark:border-gray-700/60 my-1" />
          <button
            onClick={() => { setOpen(false); router.push('/team/new'); }}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-blue-600 dark:text-blue-400"
          >
            <div className="w-7 h-7 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
              <Plus className="h-3.5 w-3.5" />
            </div>
            <span className="font-medium">Create Team</span>
          </button>
        </div>
      )}
    </div>
  );
}
