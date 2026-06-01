'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown, Check, Sparkles, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ForensicDiffResponse } from '@/app/api/orgs/[orgId]/forensic-diff/route';

export default function ForensicDiffPage() {
  // useParams() — matches the existing pattern across this codebase
  // (attribution-map, recovery, finding-detail all use it). The
  // page-props params signature changed between Next 14/15 and the
  // useParams hook works on both.
  const params = useParams();
  const orgId = params.orgId as string;
  const [data, setData] = useState<ForensicDiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/orgs/${orgId}/forensic-diff`);
        if (r.status === 204) {
          setError('Only one forensic scan exists — need at least two to compare.');
          return;
        }
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        setData((await r.json()) as ForensicDiffResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <Link
        href={`/orgs/${orgId}`}
        className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back to org
      </Link>
      <h1 className="text-3xl font-bold mb-1">Forensic Diff</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        What changed between the latest two forensic scans for this org.
      </p>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}
      {data && (
        <>
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Net change</p>
                  <p className={`text-4xl font-bold ${
                    data.net_delta_usd > 1
                      ? 'text-rose-600 dark:text-rose-400'
                      : data.net_delta_usd < -1
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-gray-700 dark:text-gray-200'
                  }`}>
                    {data.net_delta_usd > 0 ? '↑ ' : data.net_delta_usd < 0 ? '↓ ' : ''}
                    {fmt(Math.abs(data.net_delta_usd))}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    From {fmt(data.from_total_usd)} → To {fmt(data.to_total_usd)}
                    {data.from_total_usd > 0 && ` (${data.net_delta_pct >= 0 ? '+' : ''}${data.net_delta_pct.toFixed(1)}%)`}
                  </p>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <p>{data.from_scan.completed_at && new Date(data.from_scan.completed_at).toLocaleString()}</p>
                  <p>↓</p>
                  <p>{data.to_scan.completed_at && new Date(data.to_scan.completed_at).toLocaleString()}</p>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Section
            title="New findings"
            sub="Appeared in this scan; were not present last time."
            icon={<Sparkles className="h-5 w-5 text-rose-600" />}
            count={data.summary.new_count}
            sumLabel={fmt(data.summary.new_total_usd)}
            color="rose"
          >
            {data.new.map((f) => (
              <Row
                key={f.id}
                detector={f.detector_id}
                title={f.title}
                primary={fmt(f.gap_usd)}
                primaryColor="rose"
                orgId={orgId}
                findingId={f.id}
              />
            ))}
          </Section>

          <Section
            title="Escalated"
            sub="Same record, gap got bigger."
            icon={<TrendingUp className="h-5 w-5 text-amber-600" />}
            count={data.summary.escalated_count}
            sumLabel={`+${fmt(data.summary.escalated_total_usd)}`}
            color="amber"
          >
            {data.escalated.map((f) => (
              <Row
                key={f.id}
                detector={f.detector_id}
                title={f.title}
                primary={`+${fmt(f.delta_usd)}`}
                primaryColor="amber"
                secondary={`${fmt(f.prev_gap_usd)} → ${fmt(f.gap_usd)}`}
                orgId={orgId}
                findingId={f.id}
              />
            ))}
          </Section>

          <Section
            title="Resolved"
            sub="Were findings last scan; gone this scan. Good work."
            icon={<Check className="h-5 w-5 text-emerald-600" />}
            count={data.summary.resolved_count}
            sumLabel={fmt(data.summary.resolved_total_usd)}
            color="emerald"
          >
            {data.resolved.map((f) => (
              <Row
                key={f.id}
                detector={f.detector_id}
                title={f.title}
                primary={fmt(f.gap_usd)}
                primaryColor="emerald"
                orgId={orgId}
                findingId={f.id}
              />
            ))}
          </Section>

          <Section
            title="Improved"
            sub="Same record, gap got smaller. Partial recovery."
            icon={<TrendingDown className="h-5 w-5 text-sky-600" />}
            count={data.summary.improved_count}
            sumLabel={`-${fmt(data.summary.improved_total_usd)}`}
            color="sky"
          >
            {data.improved.map((f) => (
              <Row
                key={f.id}
                detector={f.detector_id}
                title={f.title}
                primary={`${fmt(f.delta_usd)}`} // delta_usd is negative
                primaryColor="sky"
                secondary={`${fmt(f.prev_gap_usd)} → ${fmt(f.gap_usd)}`}
                orgId={orgId}
                findingId={f.id}
              />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  sub,
  icon,
  count,
  sumLabel,
  color,
  children,
}: {
  title: string;
  sub: string;
  icon: React.ReactNode;
  count: number;
  sumLabel: string;
  color: 'rose' | 'amber' | 'emerald' | 'sky';
  children: React.ReactNode;
}) {
  const colorClasses = {
    rose: 'border-rose-200 dark:border-rose-800',
    amber: 'border-amber-200 dark:border-amber-800',
    emerald: 'border-emerald-200 dark:border-emerald-800',
    sky: 'border-sky-200 dark:border-sky-800',
  }[color];
  return (
    <Card className={`mb-6 ${colorClasses}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3 items-start">
            <div>{icon}</div>
            <div>
              <h2 className="text-lg font-semibold">
                {title} <span className="text-gray-400 font-normal">({count})</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{sub}</p>
            </div>
          </div>
          <p className="text-lg font-semibold">{sumLabel}</p>
        </div>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic">None.</p>
        ) : (
          <div className="space-y-1">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  detector,
  title,
  primary,
  primaryColor,
  secondary,
  orgId,
  findingId,
}: {
  detector: string;
  title: string;
  primary: string;
  primaryColor: 'rose' | 'amber' | 'emerald' | 'sky';
  secondary?: string;
  orgId: string;
  findingId: string;
}) {
  const primaryClass = {
    rose: 'text-rose-700 dark:text-rose-300',
    amber: 'text-amber-700 dark:text-amber-300',
    emerald: 'text-emerald-700 dark:text-emerald-300',
    sky: 'text-sky-700 dark:text-sky-300',
  }[primaryColor];
  return (
    <Link
      href={`/orgs/${orgId}/forensics/${findingId}`}
      className="flex items-center justify-between gap-3 px-3 py-2 -mx-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{detector}</p>
        <p className="text-sm truncate">{title}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`font-semibold ${primaryClass}`}>{primary}</p>
        {secondary && <p className="text-xs text-gray-500 dark:text-gray-400">{secondary}</p>}
      </div>
    </Link>
  );
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (Math.abs(n) < 1) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}
