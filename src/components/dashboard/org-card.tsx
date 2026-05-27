'use client';

import { useState, useRef, useEffect } from 'react';
import { Cloud, RefreshCw, ArrowRight, AlertTriangle, MoreVertical, Unplug, Clock } from 'lucide-react';
import type { OrgCardData } from '@/types';
import { getScoreColor, formatTimeAgo } from '@/lib/utils';

interface OrgCardProps {
  org: OrgCardData;
  onView: () => void;
  onScan: () => void;
  onDisconnect: () => void;
  scanning?: boolean;
  // Bulk-select integration. When `selectable` is true, a checkbox renders
  // at the top-right of the card. `selected` controls its state; `onToggleSelect`
  // fires on click. Cards stay fully interactive (Run Scan, Open, etc.) even
  // when checkbox is visible — selection is orthogonal to the row's actions.
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function OrgCard({ org, onView, onScan, onDisconnect, scanning = false, selectable = false, selected = false, onToggleSelect }: OrgCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // Phase index for scan-in-progress UI. Time-based estimate, advances
  // through five phases over ~30 seconds. Resets when the scan ends.
  const [scanPhase, setScanPhase] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Drive the scan progress phases while scanning is active.
  useEffect(() => {
    if (!scanning) {
      setScanPhase(0);
      return;
    }
    setScanPhase(0);
    // Step through phases 0→1→2→3→4 over ~30 seconds. Last phase is
    // "Generating AI summary…" which is the slowest, so we leave it as
    // the resting state if the scan runs long.
    const stepMs = [2500, 4500, 6000, 8000];
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;
    for (let i = 0; i < stepMs.length; i++) {
      elapsed += stepMs[i];
      timeouts.push(setTimeout(() => setScanPhase(i + 1), elapsed));
    }
    return () => {
      for (const t of timeouts) clearTimeout(t);
    };
  }, [scanning]);

  // Friendly phase labels — time-based heuristic only, no backend signal.
  const SCAN_PHASES = [
    'Connecting to Salesforce…',
    'Detecting installed packages…',
    'Fetching configuration data…',
    'Running 176 health checks…',
    'Generating AI summary…',
  ];

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

  // Map detected packages to a brand color stripe at the top of the card.
  // Visual product-type signal — ARM gets orange, CPQ+Billing gets the
  // sky→indigo gradient (the two blue brand faces), single products get
  // their respective single color. Empty stays muted gray so a brand-new
  // connection doesn't shout while detection is still running.
  const pkgs = org.installed_packages || [];
  const hasCPQ = pkgs.includes('cpq');
  const hasBilling = pkgs.includes('billing');
  const hasARM = pkgs.includes('arm');
  let stripeClass = 'bg-gray-200 dark:bg-gray-700';
  if (hasARM && !hasCPQ && !hasBilling) {
    stripeClass = 'bg-brand-orange';
  } else if (hasCPQ && hasBilling) {
    stripeClass = 'bg-gradient-to-r from-brand-sky to-brand-indigo';
  } else if (hasCPQ) {
    stripeClass = 'bg-brand-sky';
  } else if (hasBilling) {
    stripeClass = 'bg-brand-indigo';
  } else if (hasARM) {
    // ARM combined with CPQ or Billing — full 4-color sweep (rare but
    // signals "everything is here").
    stripeClass = 'bg-gradient-to-r from-brand-purple via-brand-orange to-brand-indigo';
  }

  return (
    <>
      <div className="group bg-white dark:bg-[#111827] rounded-2xl border border-gray-200 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-lg hover:shadow-blue-50 dark:hover:shadow-blue-900/20 transition-all duration-300 overflow-hidden">
        {/* Brand product-type accent strip at top of card. The
            `overflow-hidden` on the parent rounds the strip's left/right
            ends to match the card's 2xl radius. */}
        <div className={`h-1 ${stripeClass}`} />
        {/* Legacy-connection migration nudge. Shown only for orgs connected
            via the shared platform External Client App (sf_client_id is null).
            Those connections lose their refresh token roughly every 2 hours
            because Salesforce blocks cross-org refresh — the user has to
            reconnect daily. Once they reconnect with their own ECA, the row
            gets sf_client_id populated and this banner disappears. */}
        {!org.sf_client_id && org.connection_status === 'connected' && !org.disconnected_at && (
          <div className="flex items-center justify-between gap-3 px-5 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200/70 dark:border-amber-800/40">
            <div className="flex items-start gap-2 min-w-0">
              <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-[11px] leading-snug text-amber-800 dark:text-amber-300">
                <span className="font-medium">Legacy connection.</span>{' '}
                Disconnect and reconnect using your own External Client App to stop daily expirations.
              </p>
            </div>
          </div>
        )}
        {/* Header */}
        <div className="p-5 pb-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-xl">
                <Cloud className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">{org.name}</h3>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                    org.is_sandbox ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      org.is_sandbox ? 'bg-amber-500' : 'bg-emerald-500'
                    }`} />
                    {org.is_sandbox ? 'Sandbox' : 'Production'}
                  </span>
                  {(() => {
                    const pkgs = org.installed_packages || [];
                    const hasCPQ = pkgs.includes('cpq');
                    const hasBilling = pkgs.includes('billing');
                    const hasARM = pkgs.includes('arm');
                    let label: string | null = null;
                    let cls = '';
                    if (hasCPQ && hasBilling && hasARM) {
                      label = 'CPQ + Billing + ARM';
                      cls = 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
                    } else if (hasCPQ && hasBilling) {
                      label = 'CPQ + Billing';
                      cls = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
                    } else if (hasCPQ && hasARM) {
                      label = 'CPQ + ARM';
                      cls = 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
                    } else if (hasCPQ) {
                      label = 'CPQ';
                      cls = 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
                    } else if (hasARM) {
                      label = 'ARM';
                      cls = 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300';
                    } else if (hasBilling) {
                      label = 'Billing';
                      cls = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
                    } else if (org.connection_status === 'connected') {
                      label = 'Detecting…';
                      cls = 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
                    }
                    return label ? (
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
                        {label}
                      </span>
                    ) : null;
                  })()}
                </div>
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

              {/* Bulk-select checkbox — only rendered when selectable is on
                  (i.e. user has 2+ orgs and the dashboard exposes bulk mode). */}
              {selectable && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
                  className={`flex items-center justify-center w-5 h-5 rounded border-2 transition ${
                    selected
                      ? 'bg-blue-600 border-blue-600'
                      : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 hover:border-blue-400'
                  }`}
                  aria-label={selected ? 'Deselect org' : 'Select org for bulk action'}
                  aria-pressed={selected}
                >
                  {selected && (
                    <svg viewBox="0 0 12 12" className="w-3 h-3 text-white">
                      <path d="M2 6.5L4.8 9 10 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
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

          {/* Scan progress / Stats */}
          {scanning ? (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2 text-xs text-blue-600 dark:text-blue-400 font-medium">
                <RefreshCw className="h-3 w-3 animate-spin flex-shrink-0" />
                <span>{SCAN_PHASES[scanPhase] || SCAN_PHASES[SCAN_PHASES.length - 1]}</span>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${Math.min(((scanPhase + 1) / SCAN_PHASES.length) * 100, 95)}%` }}
                />
              </div>
            </div>
          ) : org.last_scan_at ? (
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

        {/* Actions — when this org has never been scanned, draw attention to
            "Run Scan" with a subtle pulse ring. Disappears once last_scan_at
            is populated (no extra state to manage; derives from the data). */}
        {(() => {
          const neverScanned = !org.last_scan_at;
          return (
            <div className="px-5 pb-4 flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onScan(); }}
                disabled={scanning}
                className={`relative flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all disabled:opacity-60 shadow-sm shadow-blue-600/20 ${neverScanned && !scanning ? 'ring-2 ring-blue-400/60 ring-offset-2 ring-offset-white dark:ring-offset-gray-900' : ''}`}
              >
                {neverScanned && !scanning && (
                  <span className="absolute -inset-1 rounded-xl bg-blue-400/30 animate-ping pointer-events-none" style={{ animationDuration: '2.5s' }} />
                )}
                <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''} relative`} />
                <span className="relative">{scanning ? 'Scanning…' : neverScanned ? 'Run First Scan' : 'Run Scan'}</span>
              </button>
              {org.last_scan_score !== null && (
                <button
                  onClick={onView}
                  className="flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 dark:text-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-xl transition-colors"
                >
                  Open
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })()}
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
              We&apos;ll keep your scan history and remove the connection. Reconnect with the same Salesforce org any time and your history will be restored. To wipe history permanently, use &quot;Forget permanently&quot; from the Disconnected orgs section on the dashboard.
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
