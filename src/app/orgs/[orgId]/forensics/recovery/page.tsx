'use client';

/**
 * Recovery Dashboard — the moat.
 *
 * Per-finding drill-down was "why did this leak happen?"
 * Attribution Map was "what root configs cost the most $?"
 * Recovery Dashboard is "approve, download, commit. Track what's done."
 *
 * State machine the consultant moves through:
 *   Pending  → Approved  → Committed
 *      ↘  Rejected  (un-reject = back to Pending)
 *
 * Bulk select + bulk approve/reject/commit. Per-action approve/reject
 * inline. Combined CSV download on the approved tab.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Download,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Network,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';

type StatusTab = 'pending' | 'approved' | 'committed' | 'rejected';

interface RecoveryAction {
  id: string;
  finding_id: string;
  action_type: string;
  approval_status: StatusTab;
  draft_payload: {
    csv_header?: string;
    csv_row?: string;
    action_label?: string;
    filename?: string;
  } | null;
  projected_reclaim_usd: number;
  approved_at: string | null;
  committed_at: string | null;
  created_at: string;
  finding: {
    id: string;
    detector_id: string;
    gap_usd: number;
    currency_iso_code: string;
    title: string;
    primary_record: { type?: string; id?: string; name?: string } | null;
  } | null;
}

interface ListResponse {
  actions: RecoveryAction[];
  counts: Record<StatusTab, number>;
  totals: Record<StatusTab, number>;
}

const TAB_META: Record<StatusTab, { label: string; icon: typeof ShieldCheck; chipBg: string; chipText: string }> = {
  pending: { label: 'Pending review',  icon: ShieldCheck,   chipBg: 'bg-amber-100 dark:bg-amber-900/30',  chipText: 'text-amber-700 dark:text-amber-300' },
  approved:{ label: 'Approved',        icon: CheckCircle2,  chipBg: 'bg-blue-100 dark:bg-blue-900/30',    chipText: 'text-blue-700 dark:text-blue-300' },
  committed:{label: 'Committed',       icon: CheckCircle2,  chipBg: 'bg-green-100 dark:bg-green-900/30',  chipText: 'text-green-700 dark:text-green-300' },
  rejected:{ label: 'Rejected',        icon: XCircle,       chipBg: 'bg-gray-100 dark:bg-gray-800',       chipText: 'text-gray-700 dark:text-gray-300' },
};

function formatMoney(amount: number, currency: string): string {
  if (amount >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${currency} ${(amount / 1_000).toFixed(0)}K`;
  return `${currency} ${amount.toLocaleString()}`;
}

export default function RecoveryDashboardPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const [tab, setTab] = useState<StatusTab>('pending');
  const [data, setData] = useState<ListResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/recovery-actions?organizationId=${orgId}&status=${tab}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ListResponse = await res.json();
      setData(json);
      // Drop selections that aren't in the new dataset.
      setSelected((prev) => {
        const valid = new Set(json.actions.map((a) => a.id));
        const next = new Set<string>();
        prev.forEach((id) => {
          if (valid.has(id)) next.add(id);
        });
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [orgId, tab]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  async function bulkAction(action: 'approve' | 'reject' | 'commit' | 'stage') {
    if (selected.size === 0) return;
    setActionInFlight(true);
    try {
      await fetch('/api/recovery-actions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), action }),
      });
      await fetchData();
    } finally {
      setActionInFlight(false);
    }
  }

  function downloadBulkCsv() {
    if (selected.size === 0) return;
    const ids = Array.from(selected).join(',');
    window.location.href = `/api/recovery-actions/bulk-csv?ids=${ids}`;
  }

  if (loading) return <LoadingScreen />;
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
          <p className="text-gray-700 dark:text-gray-300">{error}</p>
          <Link href={`/orgs/${orgId}`} className="text-blue-600 dark:text-blue-400 mt-2 inline-block">
            ← Back to org
          </Link>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const totalReclaimAcrossStates =
    (data.totals.pending ?? 0) + (data.totals.approved ?? 0) + (data.totals.committed ?? 0);
  const currentTabActions = data.actions;

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Link
          href={`/orgs/${orgId}`}
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to org
        </Link>

        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="p-2 bg-green-600 rounded-lg">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Recovery Queue</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Stage findings, approve recoveries, track what's been committed back to Salesforce.
            </p>
          </div>
          <Link
            href={`/orgs/${orgId}/forensics/attribution-map`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium"
          >
            <Network className="h-4 w-4" />
            Attribution Map
          </Link>
        </div>

        {/* Summary card */}
        <Card>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-2">
              {(['pending', 'approved', 'committed', 'rejected'] as const).map((s) => {
                const meta = TAB_META[s];
                return (
                  <div key={s}>
                    <p className={`text-[11px] uppercase tracking-wider font-semibold ${meta.chipText}`}>
                      {meta.label}
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {data.counts[s] ?? 0}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatMoney(data.totals[s] ?? 0, 'USD')}
                    </p>
                  </div>
                );
              })}
            </div>
            {totalReclaimAcrossStates > 0 && (
              <p className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                {formatMoney(totalReclaimAcrossStates, 'USD')} of projected reclaim across the active queue.
                Once approved + committed, that's $ recovered.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700">
          {(['pending', 'approved', 'committed', 'rejected'] as const).map((s) => {
            const isActive = tab === s;
            const meta = TAB_META[s];
            return (
              <button
                key={s}
                onClick={() => setTab(s)}
                className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
                  isActive
                    ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {meta.label} ({data.counts[s] ?? 0})
              </button>
            );
          })}
        </div>

        {/* Tab-specific narrative — explains the workflow's next step
            so users don't bounce off after Approve wondering what to
            do next. Commit is a manual attestation in v1; we don't
            auto-verify the Salesforce-side upload. */}
        {tab === 'pending' && data.counts.pending > 0 && (
          <div className="px-4 py-3 rounded-lg bg-amber-50/40 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-300">
            <strong>Next step:</strong> Review each row, then Approve. Approved actions move to the next tab where you can download the consolidated CSV.
          </div>
        )}
        {tab === 'approved' && data.counts.approved > 0 && (
          <div className="px-4 py-3 rounded-lg bg-blue-50/40 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/40 text-xs text-blue-800 dark:text-blue-300">
            <strong>Recovery flow:</strong>
            <ol className="list-decimal list-inside mt-1 space-y-0.5">
              <li>Select the actions you want to commit</li>
              <li>Click <b>Download CSV</b> — you'll get a single Data Loader-ready file</li>
              <li>Open Salesforce Data Loader, upload the CSV (Upsert with Id as external ID)</li>
              <li>Come back here, re-select the same rows, click <b>Mark committed</b> to record that the upload succeeded</li>
            </ol>
            <p className="mt-1.5 opacity-80">
              v1 trusts your attestation — we don&apos;t auto-verify the Salesforce-side write. v2 will re-query the records after commit to confirm.
            </p>
          </div>
        )}
        {tab === 'committed' && data.counts.committed > 0 && (
          <div className="px-4 py-3 rounded-lg bg-green-50/40 dark:bg-green-900/10 border border-green-200 dark:border-green-800/40 text-xs text-green-800 dark:text-green-300">
            <strong>Done.</strong> These actions are the audit trail of what your engagement actually recovered.
            Hand the committed list (and the CSVs you uploaded) to the client as the deliverable.
          </div>
        )}
        {tab === 'rejected' && data.counts.rejected > 0 && (
          <div className="px-4 py-3 rounded-lg bg-gray-50/60 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300">
            Changed your mind on a rejected action? Select it and click <b>Re-stage</b> to send it back to Pending.
          </div>
        )}

        {/* Bulk action bar */}
        {currentTabActions.length > 0 && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={selected.size === currentTabActions.length && currentTabActions.length > 0}
                onChange={(e) => {
                  if (e.target.checked) setSelected(new Set(currentTabActions.map((a) => a.id)));
                  else setSelected(new Set());
                }}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {selected.size === 0
                  ? `${currentTabActions.length} action${currentTabActions.length === 1 ? '' : 's'}`
                  : `${selected.size} selected`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {tab === 'pending' && (
                <>
                  <button
                    onClick={() => bulkAction('approve')}
                    disabled={selected.size === 0 || actionInFlight}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </button>
                  <button
                    onClick={() => bulkAction('reject')}
                    disabled={selected.size === 0 || actionInFlight}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" /> Reject
                  </button>
                </>
              )}
              {tab === 'approved' && (
                <>
                  <button
                    onClick={downloadBulkCsv}
                    disabled={selected.size === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" /> Download CSV
                  </button>
                  <button
                    onClick={() => bulkAction('commit')}
                    disabled={selected.size === 0 || actionInFlight}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                    title="Mark as committed after uploading the CSV to Salesforce"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Mark committed
                  </button>
                </>
              )}
              {tab === 'rejected' && (
                <button
                  onClick={() => bulkAction('stage')}
                  disabled={selected.size === 0 || actionInFlight}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" /> Re-stage
                </button>
              )}
            </div>
          </div>
        )}

        {/* Action list */}
        {currentTabActions.length === 0 ? (
          <Card>
            <CardContent>
              <div className="text-center py-12">
                <ShieldCheck className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No recovery actions in <span className="font-semibold">{TAB_META[tab].label}</span>.
                </p>
                {tab === 'pending' && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                    Stage findings from the Attribution Map or individual finding pages.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {currentTabActions.map((action) => {
              const isExpanded = expanded.has(action.id);
              const isSelected = selected.has(action.id);
              const meta = TAB_META[action.approval_status];
              return (
                <Card key={action.id}>
                  <CardContent>
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(action.id);
                          else next.delete(action.id);
                          setSelected(next);
                        }}
                        className="mt-1 h-4 w-4 rounded border-gray-300 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                                {action.finding?.detector_id}
                              </code>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.chipBg} ${meta.chipText}`}>
                                {meta.label}
                              </span>
                              {action.finding?.primary_record?.name && (
                                <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
                                  {action.finding.primary_record.name}
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {action.finding?.title ?? '—'}
                            </p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                              {action.draft_payload?.action_label}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-base font-bold text-green-700 dark:text-green-400">
                              {formatMoney(action.projected_reclaim_usd, action.finding?.currency_iso_code ?? 'USD')}
                            </p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400">projected reclaim</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                          <a
                            href={`/orgs/${orgId}/forensics/${action.finding_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                            title="Opens in a new tab so you keep your queue selection"
                          >
                            View finding <ExternalLink className="h-3 w-3" />
                          </a>
                          <button
                            onClick={() => {
                              const next = new Set(expanded);
                              if (next.has(action.id)) next.delete(action.id);
                              else next.add(action.id);
                              setExpanded(next);
                            }}
                            className="text-xs text-gray-600 dark:text-gray-400 hover:underline inline-flex items-center gap-1"
                          >
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            CSV preview
                          </button>
                          {action.approval_status === 'approved' && (
                            <a
                              href={`/api/forensic-findings/${action.finding_id}/recovery-csv`}
                              className="text-xs text-green-700 dark:text-green-400 hover:underline inline-flex items-center gap-1"
                            >
                              <Download className="h-3 w-3" /> Download single
                            </a>
                          )}
                        </div>
                        {isExpanded && action.draft_payload && (
                          <pre className="mt-3 text-[11px] bg-gray-900 dark:bg-gray-950 text-gray-100 p-3 rounded-lg overflow-x-auto">
                            {action.draft_payload.csv_header}{'\n'}{action.draft_payload.csv_row}
                          </pre>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
