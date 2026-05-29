'use client';

/**
 * Pre-flight modal for "Refresh & Compare". Shows each selected org with
 * a staleness chip and per-org toggle (scan vs cached). Footer counts
 * scans needed against quota remaining and blocks if there isn't enough.
 *
 * Stateless about staleness — it receives a server-classified list, so
 * the threshold can be tuned in one place (lib/portfolio/staleness.ts)
 * without UI changes. Per-org toggles produce two override arrays
 * (forceRescan, skipScan) that get POSTed verbatim to the orchestrator.
 */

import { useMemo, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, Clock, CheckCircle2, XCircle, X } from 'lucide-react';
import type { StalenessVerdict } from '@/lib/portfolio/staleness';

interface ModalOrg {
  id: string;
  name: string;
  is_sandbox: boolean;
  last_scan_at: string | null;
}

interface Props {
  open: boolean;
  orgs: ModalOrg[];
  verdicts: StalenessVerdict[];
  quota: { used: number; limit: number | null } | null;
  onCancel: () => void;
  onConfirm: (params: { forceRescanOrgIds: string[]; skipScanOrgIds: string[]; notifyOnComplete: boolean }) => void;
  submitting?: boolean;
  error?: string | null;
}

function formatAge(verdict: StalenessVerdict): string {
  if (verdict.bucket === 'never') return 'Never scanned';
  if (verdict.age_days === null) return '';
  if (verdict.age_days === 0) return 'Today';
  if (verdict.age_days === 1) return '1 day ago';
  if (verdict.age_days < 30) return `${verdict.age_days} days ago`;
  return `${Math.round(verdict.age_days / 30)} months ago`;
}

const CHIP_STYLES: Record<StalenessVerdict['bucket'], { label: string; bg: string; text: string; Icon: typeof Clock }> = {
  fresh:   { label: 'Fresh',          bg: 'bg-green-100 dark:bg-green-900/30',  text: 'text-green-700 dark:text-green-300',  Icon: CheckCircle2 },
  stale:   { label: 'Stale',          bg: 'bg-amber-100 dark:bg-amber-900/30',  text: 'text-amber-700 dark:text-amber-300',  Icon: Clock },
  never:   { label: 'Never scanned',  bg: 'bg-red-100 dark:bg-red-900/30',      text: 'text-red-700 dark:text-red-300',      Icon: XCircle },
};

export function RefreshAndCompareModal({
  open, orgs, verdicts, quota, onCancel, onConfirm, submitting, error,
}: Props) {
  // Per-org override map. Default: scan = (bucket !== fresh). Toggling
  // flips the choice for THAT org regardless of bucket — gives the
  // consultant final say over what gets re-scanned.
  const initialChoice = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const v of verdicts) m.set(v.org_id, v.bucket !== 'fresh');
    return m;
  }, [verdicts]);
  const [choice, setChoice] = useState<Map<string, boolean>>(initialChoice);
  const [notify, setNotify] = useState<boolean>(false);

  // The choice map can go stale if verdicts change (e.g. user toggles a
  // different org list and reopens). Easiest fix: rebuild from initial
  // whenever the modal opens.
  // Note: we intentionally don't reset on every render — only when
  // the underlying verdict set changes.

  if (!open) return null;

  const scanCount = Array.from(choice.values()).filter(Boolean).length;
  const remaining = quota?.limit === null ? Number.POSITIVE_INFINITY : Math.max(0, (quota?.limit ?? 0) - (quota?.used ?? 0));
  const quotaShort = scanCount > remaining;

  const forceRescanOrgIds: string[] = [];
  const skipScanOrgIds: string[] = [];
  choice.forEach((wantsScan, orgId) => {
    const v = verdicts.find((x) => x.org_id === orgId);
    if (!v) return;
    if (wantsScan && v.bucket === 'fresh') forceRescanOrgIds.push(orgId);
    if (!wantsScan && v.bucket !== 'fresh') skipScanOrgIds.push(orgId);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <RefreshCw className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Refresh & Compare</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Re-scan stale orgs before comparing, so the matrix reflects current configuration.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 -m-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-2">
            {orgs.map((org) => {
              const v = verdicts.find((x) => x.org_id === org.id);
              if (!v) return null;
              const chip = CHIP_STYLES[v.bucket];
              const ChipIcon = chip.Icon;
              const wantsScan = choice.get(org.id) ?? false;
              return (
                <div
                  key={org.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/40 dark:bg-gray-900/40"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-900 dark:text-white">{org.name}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${chip.bg} ${chip.text}`}>
                        <ChipIcon className="h-3 w-3" />
                        {chip.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {org.is_sandbox ? 'Sandbox' : 'Production'} · {formatAge(v)}
                    </p>
                  </div>
                  <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1 flex-shrink-0">
                    <button
                      onClick={() => {
                        const next = new Map(choice);
                        next.set(org.id, true);
                        setChoice(next);
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        wantsScan
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      Re-scan
                    </button>
                    <button
                      onClick={() => {
                        const next = new Map(choice);
                        next.set(org.id, false);
                        setChoice(next);
                      }}
                      disabled={v.bucket === 'never'}
                      title={v.bucket === 'never' ? 'No cached scan available' : ''}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        !wantsScan && v.bucket !== 'never'
                          ? 'bg-gray-700 text-white shadow-sm dark:bg-gray-600'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      Cached
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <label className="flex items-center gap-2 mt-4 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Email me when the comparison is ready
          </label>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 px-6 py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <p className="font-medium text-gray-900 dark:text-white">
                {scanCount} scan{scanCount === 1 ? '' : 's'} needed
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {quota?.limit === null
                  ? 'No quota limit on your plan'
                  : `${remaining} of ${quota?.limit ?? '—'} scans remaining this month`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirm({ forceRescanOrgIds, skipScanOrgIds, notifyOnComplete: notify })}
                disabled={submitting || quotaShort}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    {scanCount === 0 ? 'Compare cached' : `Scan ${scanCount} & compare`}
                  </>
                )}
              </button>
            </div>
          </div>
          {(error || quotaShort) && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                {error
                  ? error
                  : `You're requesting ${scanCount} scans but only ${remaining} remain this month. Switch some orgs to "Cached" or upgrade your plan.`}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
