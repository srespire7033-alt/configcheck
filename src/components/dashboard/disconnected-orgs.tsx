'use client';

import { useState, useEffect } from 'react';
import { Archive, RotateCw, Trash2, ChevronRight, Cloud } from 'lucide-react';
import { formatTimeAgo, getScoreColor } from '@/lib/utils';
import type { OrgCardData } from '@/types';

interface Props {
  onReconnect: () => void;
  onForget: () => void;
}

export function DisconnectedOrgs({ onReconnect, onForget }: Props) {
  const [orgs, setOrgs] = useState<OrgCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [forgetingId, setForgetingId] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState<OrgCardData | null>(null);

  useEffect(() => {
    fetchDisconnected();
  }, []);

  async function fetchDisconnected() {
    try {
      const res = await fetch('/api/orgs?status=disconnected', { cache: 'no-store' });
      if (res.ok) {
        const data: OrgCardData[] = await res.json();
        setOrgs(data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleReconnect() {
    // Same OAuth flow as a fresh connect — the callback will detect the
    // matching salesforce_org_id and restore this org's history.
    const res = await fetch('/api/salesforce/auth-url');
    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    }
    onReconnect();
  }

  async function handleForget(orgId: string) {
    setForgetingId(orgId);
    try {
      const res = await fetch(`/api/orgs?orgId=${orgId}&mode=forget`, { method: 'DELETE' });
      if (res.ok) {
        setOrgs((prev) => prev.filter((o) => o.id !== orgId));
        setConfirmForget(null);
        onForget();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to permanently delete org');
      }
    } finally {
      setForgetingId(null);
    }
  }

  if (loading || orgs.length === 0) return null;

  return (
    <>
      <details className="mt-10 group">
        <summary className="cursor-pointer flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors select-none">
          <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" />
          <Archive className="w-4 h-4" />
          <span className="font-medium">Disconnected orgs</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
            {orgs.length}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">— history kept, reconnect to resume</span>
        </summary>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orgs.map((org) => (
            <div
              key={org.id}
              className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 flex flex-col"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-2 bg-gray-200 dark:bg-gray-800 rounded-lg flex-shrink-0">
                    <Cloud className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-700 dark:text-gray-200 truncate">{org.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      Disconnected {org.disconnected_at ? formatTimeAgo(org.disconnected_at) : 'recently'}
                    </p>
                  </div>
                </div>
                {org.last_scan_score !== null && (
                  <div className="text-right flex-shrink-0">
                    <div className={`text-xl font-bold ${getScoreColor(org.last_scan_score)}`}>
                      {org.last_scan_score}
                    </div>
                    <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">/100</div>
                  </div>
                )}
              </div>

              {org.last_scan_at && (
                <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">
                  Last scan: {formatTimeAgo(org.last_scan_at)}
                </p>
              )}

              <div className="flex items-center gap-2 mt-auto">
                <button
                  onClick={handleReconnect}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  Reconnect
                </button>
                <button
                  onClick={() => setConfirmForget(org)}
                  className="px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-gray-200 dark:border-gray-700 hover:border-red-300 dark:hover:border-red-800 rounded-lg transition-colors"
                  title="Permanently delete this org and all its scan history"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </details>

      {confirmForget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => !forgetingId && setConfirmForget(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xl max-w-sm w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-red-100 dark:bg-red-900/30 rounded-xl">
                <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Forget Permanently?</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              This will permanently delete <strong className="text-gray-900 dark:text-white">{confirmForget.name}</strong> and all its scans, issues, and schedules.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-6">
              This cannot be undone. Reconnecting the same Salesforce org afterwards will start fresh with no history.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setConfirmForget(null)}
                disabled={!!forgetingId}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleForget(confirmForget.id)}
                disabled={!!forgetingId}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50"
              >
                {forgetingId === confirmForget.id ? 'Deleting...' : 'Forget Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
