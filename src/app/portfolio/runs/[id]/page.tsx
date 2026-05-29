'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, CheckCircle2, XCircle, RefreshCw, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';

/**
 * Portfolio run progress page. Polls /api/portfolio-runs/[id] every 3s
 * until every referenced scan reaches a terminal state, then redirects
 * to the comparison view (which we pin to this run's scan IDs).
 *
 * The user can safely close this tab — the run finishes server-side
 * regardless, and the email notification flag (set in the modal) brings
 * them back to results when ready.
 */

interface Slot {
  org_id: string;
  scan_id: string | null;
  status: string;
  overall_score?: number | null;
  total_issues?: number | null;
  critical_count?: number | null;
  warning_count?: number | null;
  completed_at?: string | null;
  error_message?: string | null;
}

interface RunResponse {
  run: {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
    organization_ids: string[];
    scan_ids: (string | null)[];
    started_at: string;
    completed_at: string | null;
  };
  slots: Slot[];
}

interface OrgLite {
  id: string;
  name: string;
}

const POLL_MS = 3000;
const TERMINAL = new Set(['completed', 'failed', 'kickoff_failed', 'partial']);

export default function PortfolioRunPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [data, setData] = useState<RunResponse | null>(null);
  const [orgNames, setOrgNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(`/api/portfolio-runs/${params.id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed to load run (${res.status})`);
        return null;
      }
      const json: RunResponse = await res.json();
      setData(json);
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load run');
      return null;
    }
  }, [params.id]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function loop() {
      const json = await fetchOnce();
      if (cancelled) return;
      if (!json) return; // hard error — stop polling
      const allTerminal = json.slots.every((s) => TERMINAL.has(s.status));
      if (allTerminal) {
        // Comparison view is the next stop. We pass the run id so the
        // results page can fetch /api/scans/portfolio-compare with the
        // pinned scan_ids — guarantees the comparison reads exactly
        // the scans this run produced.
        setRedirecting(true);
        setTimeout(() => {
          router.replace(`/portfolio?runId=${json.run.id}`);
        }, 600);
        return;
      }
      timer = setTimeout(loop, POLL_MS);
    }

    loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchOnce, router]);

  // One-shot org name lookup so the progress bars don't show bare UUIDs.
  useEffect(() => {
    if (!data) return;
    if (orgNames.size > 0) return;
    fetch('/api/orgs')
      .then((r) => (r.ok ? r.json() : []))
      .then((orgs: OrgLite[]) => {
        const m = new Map<string, string>();
        for (const o of orgs) m.set(o.id, o.name);
        setOrgNames(m);
      })
      .catch(() => {});
  }, [data, orgNames.size]);

  if (!data && !error) return <LoadingScreen />;

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/portfolio"
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Back to portfolio"
          >
            <ArrowLeft className="h-4 w-4 text-gray-500" />
          </Link>
          <div className="p-2 bg-blue-600 rounded-lg">
            <RefreshCw className={`h-6 w-6 text-white ${data?.run.status === 'running' ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Refreshing your portfolio</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {redirecting
                ? 'Done — opening the comparison…'
                : 'You can close this tab; we\'ll email you when it\'s ready (if you opted in).'}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {data && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {data.slots.filter((s) => s.status === 'completed').length} of {data.slots.length} ready
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Each org runs in its own scan job. The Salesforce queries fan out in parallel; the AI summary phase
                is serialized per user to keep within rate limits.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.slots.map((slot) => {
                  const name = orgNames.get(slot.org_id) ?? slot.org_id;
                  const isDone = slot.status === 'completed';
                  const isFailed = slot.status === 'failed' || slot.status === 'kickoff_failed';
                  const isRunning = slot.status === 'running' || slot.status === 'pending';
                  return (
                    <div
                      key={slot.org_id}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/40 dark:bg-gray-900/40"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {isDone ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                        ) : isFailed ? (
                          <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                        ) : (
                          <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {isDone
                              ? `Done · score ${slot.overall_score ?? '—'} · ${slot.total_issues ?? 0} issues`
                              : isFailed
                                ? `Failed${slot.error_message ? ' — ' + slot.error_message.slice(0, 100) : ''}`
                                : isRunning
                                  ? 'Running…'
                                  : slot.status}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
