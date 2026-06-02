'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, ArrowRight, Check, Sparkles, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ForensicDiffResponse } from '@/app/api/orgs/[orgId]/forensic-diff/route';

export function SinceLastScanCard({ orgId }: { orgId: string }) {
  const [data, setData] = useState<ForensicDiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/orgs/${orgId}/forensic-diff`);
        if (r.status === 204) {
          // Single scan or none — hide the card.
          if (!cancelled) setData(null);
          return;
        }
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        const j = (await r.json()) as ForensicDiffResponse;
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (loading || (!data && !error)) return null;

  if (error) {
    // Show errors but don't block other cards.
    return (
      <Card>
        <CardContent className="py-4 text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Couldn&rsquo;t compare to your last scan</p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">
              {error || 'Unknown error — please refresh the page or try again.'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const gotWorse = data.net_delta_usd > 0;
  const noChange = Math.abs(data.net_delta_usd) < 1;
  const deltaColor = noChange
    ? 'text-gray-600 dark:text-gray-300'
    : gotWorse
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-emerald-600 dark:text-emerald-400';

  const arrow = noChange ? '' : gotWorse ? '↑' : '↓';
  const fromDate = data.from_scan.completed_at ? fmtShort(data.from_scan.completed_at) : '—';
  const toDate = data.to_scan.completed_at ? fmtShort(data.to_scan.completed_at) : '—';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3 items-start">
            <div className={`rounded-lg p-2 ${gotWorse ? 'bg-rose-100 dark:bg-rose-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30'}`}>
              {gotWorse ? (
                <TrendingUp className={`h-5 w-5 ${gotWorse ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`} />
              ) : (
                <TrendingDown className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold">Since your last scan</h2>
              <p className="text-base text-gray-500 dark:text-gray-400">
                {fromDate} → {toDate}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-3xl font-bold ${deltaColor}`}>
              {arrow} {formatMoney(Math.abs(data.net_delta_usd))}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {noChange
                ? 'no net change'
                : gotWorse
                  ? `revenue leaking +${data.net_delta_pct.toFixed(1)}% more`
                  : `recovered ${Math.abs(data.net_delta_pct).toFixed(1)}%`}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Pill
            icon={<Sparkles className="h-4 w-4" />}
            color="rose"
            label="New"
            count={data.summary.new_count}
            value={data.summary.new_total_usd}
            tone={data.summary.new_count > 0 ? 'bad' : 'neutral'}
          />
          <Pill
            icon={<TrendingUp className="h-4 w-4" />}
            color="amber"
            label="Escalated"
            count={data.summary.escalated_count}
            value={data.summary.escalated_total_usd}
            tone={data.summary.escalated_count > 0 ? 'bad' : 'neutral'}
          />
          <Pill
            icon={<Check className="h-4 w-4" />}
            color="emerald"
            label="Resolved"
            count={data.summary.resolved_count}
            value={data.summary.resolved_total_usd}
            tone="good"
          />
          <Pill
            icon={<TrendingDown className="h-4 w-4" />}
            color="sky"
            label="Improved"
            count={data.summary.improved_count}
            value={data.summary.improved_total_usd}
            tone="good"
          />
        </div>
        <a
          href={`/orgs/${orgId}/forensics/diff`}
          className="inline-flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          See full diff <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </CardContent>
    </Card>
  );
}

function Pill({
  icon,
  color,
  label,
  count,
  value,
  tone,
}: {
  icon: React.ReactNode;
  color: 'rose' | 'amber' | 'emerald' | 'sky';
  label: string;
  count: number;
  value: number;
  tone: 'good' | 'bad' | 'neutral';
}) {
  const colorClasses = {
    rose: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800',
    amber: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
    emerald: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
    sky: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800',
  }[color];
  const dim = count === 0;
  return (
    <div className={`rounded-lg border px-3 py-2 ${colorClasses} ${dim ? 'opacity-50' : ''}`}>
      <p className="text-xs uppercase tracking-wider flex items-center gap-1 opacity-80">
        {icon} {label}
      </p>
      <p className="text-xl font-bold mt-0.5">{count}</p>
      <p className="text-xs">{formatMoney(value)}</p>
      <span className="sr-only">{tone}</span>
    </div>
  );
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n < 1) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
