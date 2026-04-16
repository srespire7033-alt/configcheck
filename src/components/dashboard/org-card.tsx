'use client';

import { useState, useRef, useEffect } from 'react';
import { Cloud, RefreshCw, ArrowRight, AlertTriangle, MoreVertical, Unplug } from 'lucide-react';
import type { OrgCardData } from '@/types';
import { getScoreColor, formatTimeAgo } from '@/lib/utils';

interface OrgCardProps {
  org: OrgCardData;
  onView: () => void;
  onScan: () => void;
  onDisconnect: () => void;
  scanning?: boolean;
}

export function OrgCard({ org, onView, onScan, onDisconnect, scanning = false }: OrgCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/orgs?orgId=${org.id}`, { method: 'DELETE' });
      if (res.ok) {
        onDisconnect();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to disconnect org');
      }
    } catch {
      alert('Failed to disconnect org. Please try again.');
    } finally {
      setDisconnecting(false);
      setConfirmOpen(false);
      setMenuOpen(false);
    }
  }

  return (
    <>
      <div className="group bg-white dark:bg-[#111827] rounded-2xl border border-gray-200 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-lg hover:shadow-blue-50 dark:hover:shadow-blue-900/20 transition-all duration-300 overflow-hidden">
        {/* Header */}
        <div className="p-5 pb-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-xl">
                <Cloud className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">{org.name}</h3>
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium mt-0.5 ${
                  org.is_sandbox ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    org.is_sandbox ? 'bg-amber-500' : 'bg-emerald-500'
                  }`} />
                  {org.is_sandbox ? 'Sandbox' : 'Production'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Score */}
              {org.last_scan_score !== null && (
                <div className="text-right">
                  <div className={`text-2xl font-bold ${getScoreColor(org.last_scan_score)}`}>
                    {org.last_scan_score}
                  </div>
                  <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">/100</div>
                </div>
              )}

              {/* Three-dot menu */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 py-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setConfirmOpen(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Unplug className="h-4 w-4" />
                      Disconnect Org
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats */}
          {org.last_scan_at ? (
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 mb-4">
              <span>Last scan: {formatTimeAgo(org.last_scan_at)}</span>
              {org.critical_count > 0 && (
                <span className="flex items-center gap-1 text-red-600 font-medium">
                  <AlertTriangle className="h-3 w-3" />
                  {org.critical_count} critical
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">No scans yet</p>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 pb-4 flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onScan(); }}
            disabled={scanning}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all disabled:opacity-50 shadow-sm shadow-blue-600/20"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Run Scan'}
          </button>
          {org.last_scan_score !== null && (
            <button
              onClick={onView}
              className="flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 dark:text-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-xl transition-colors"
            >
              View
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => !disconnecting && setConfirmOpen(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xl max-w-sm w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-red-100 dark:bg-red-900/30 rounded-xl">
                <Unplug className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Disconnect Org</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Are you sure you want to disconnect <strong className="text-gray-900 dark:text-white">{org.name}</strong>?
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-6">
              This will permanently delete all scans, issues, and schedules for this org. You can reconnect the org later.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={disconnecting}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50"
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
