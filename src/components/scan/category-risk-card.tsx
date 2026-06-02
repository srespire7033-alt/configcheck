'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ShieldAlert, TrendingDown, ChevronRight, AlertTriangle, EyeOff } from 'lucide-react';
import Link from 'next/link';
import type { CategoryRiskResponse } from '@/app/api/orgs/[orgId]/category-risk/route';
import { getDetectorEffort, type EffortLevel } from '@/lib/forensics/types';

const EFFORT_META: Record<EffortLevel, { label: string; bg: string; text: string }> = {
  low: { label: 'Low effort', bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300' },
  medium: { label: 'Medium effort', bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300' },
  high: { label: 'High effort', bg: 'bg-rose-50 dark:bg-rose-900/20', text: 'text-rose-700 dark:text-rose-300' },
};

interface Props {
  orgId: string;
  category: 'governance' | 'pipeline';
}

const COPY: Record<'governance' | 'pipeline', {
  title: string;
  subtitle: string;
  empty: string;
  icon: React.ReactNode;
  color: 'amber' | 'sky';
}> = {
  governance: {
    title: 'Governance Risk',
    subtitle: 'Process and audit findings — the dollar amount isn\'t the story; the missing audit trail is.',
    empty: 'No governance issues detected.',
    icon: <ShieldAlert className="h-5 w-5" />,
    color: 'amber',
  },
  pipeline: {
    title: 'Pipeline Risk',
    subtitle: 'Revenue actively walking out the door — not lost yet, but it will be without action.',
    empty: 'No pipeline rot detected.',
    icon: <TrendingDown className="h-5 w-5" />,
    color: 'sky',
  },
};

export function CategoryRiskCard({ orgId, category }: Props) {
  const [data, setData] = useState<CategoryRiskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locallyHidden, setLocallyHidden] = useState<Set<string>>(new Set());
  const copy = COPY[category];

  async function handleHide(findingId: string) {
    // Optimistic local hide. The server-side update would survive a
    // refresh; the local Set just means the user doesn't have to wait
    // for the next API roundtrip to see the row disappear.
    setLocallyHidden((prev) => {
      const next = new Set(prev);
      next.add(findingId);
      return next;
    });
    try {
      await fetch(`/api/forensic-findings/${findingId}/hide`, { method: 'POST' });
    } catch {
      // If the API call fails, roll back so the row reappears.
      setLocallyHidden((prev) => {
        const next = new Set(prev);
        next.delete(findingId);
        return next;
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/orgs/${orgId}/category-risk?category=${category}`);
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        if (!cancelled) setData((await r.json()) as CategoryRiskResponse);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, category]);

  if (loading) return null;
  if (error) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">{copy.title} couldn&rsquo;t load</p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">
              {error || 'Unknown error — please refresh the page or try again.'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!data || data.total_findings === 0) {
    return (
      <Card>
        <CardContent className="py-4 flex items-center gap-3">
          <div className={`rounded-lg p-2 ${copy.color === 'amber' ? 'bg-amber-100/40 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300' : 'bg-sky-100/40 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'}`}>
            {copy.icon}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{copy.title}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{copy.empty}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const colorClasses = copy.color === 'amber'
    ? {
        accent: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
        chip: 'text-amber-700 dark:text-amber-300',
        border: 'border-amber-200 dark:border-amber-800/40',
      }
    : {
        accent: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
        chip: 'text-sky-700 dark:text-sky-300',
        border: 'border-sky-200 dark:border-sky-800/40',
      };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3 items-start">
            <div className={`rounded-lg p-2 ${colorClasses.accent}`}>{copy.icon}</div>
            <div>
              <h2 className="text-xl font-bold">{copy.title}</h2>
              <p className="text-base text-gray-500 dark:text-gray-400">{copy.subtitle}</p>
            </div>
          </div>
          <div
            className={`flex flex-col items-center justify-center rounded-xl border ${colorClasses.border} ${colorClasses.accent} px-4 py-2 min-w-[88px] flex-shrink-0`}
          >
            <p className={`text-2xl font-bold leading-tight ${colorClasses.chip}`}>
              {data.total_findings}
            </p>
            <p className="text-[10px] uppercase tracking-wider opacity-80 mt-0.5">
              {category === 'pipeline' && data.total_at_risk_usd > 0
                ? formatMoney(data.total_at_risk_usd) + ' ARR'
                : data.total_findings === 1 ? '1 finding' : 'findings'}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.by_detector.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {data.by_detector.map((d) => (
              <div key={d.detector_id} className={`rounded-lg border ${colorClasses.border} px-3 py-2`}>
                <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{d.detector_id}</p>
                <p className="text-sm font-medium">{d.label}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className={`text-xs ${colorClasses.chip}`}>
                    {d.finding_count} finding{d.finding_count === 1 ? '' : 's'}
                  </span>
                  {category === 'pipeline' && d.total_usd > 0 && (
                    <span className="text-xs font-medium">{formatMoney(d.total_usd)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {(() => {
          const visibleTop = data.top_findings.filter((f) => !locallyHidden.has(f.id));
          if (visibleTop.length === 0) return null;
          return (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                Top {Math.min(5, visibleTop.length)} findings
                {locallyHidden.size > 0 && ` (${locallyHidden.size} hidden)`}
              </p>
              <div className="space-y-1">
                {visibleTop.slice(0, 5).map((f) => {
                  const effort = getDetectorEffort(f.detector_id);
                  const effortMeta = EFFORT_META[effort];
                  return (
                    <div key={f.id} className="group flex items-center gap-2">
                      <Link
                        href={`/orgs/${orgId}/forensics/${f.id}`}
                        // min-w-0 is critical for truncate to work down the
                        // tree. Without it, flexbox lets the title's full
                        // width push this Link wider than its flex-1
                        // allotment, defeating the truncate on the title
                        // block below. -mx-1 was also pulling the row past
                        // the card border, which is what made the right-
                        // side \$ chip render outside the card.
                        className="flex-1 min-w-0 flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-mono text-gray-500 dark:text-gray-400 uppercase">
                              {f.detector_id}
                            </p>
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${effortMeta.bg} ${effortMeta.text}`}
                              title={`${effortMeta.label} — heuristic estimate of how much work to fix`}
                            >
                              {effort}
                            </span>
                          </div>
                          <p className="text-base truncate">{f.title}</p>
                        </div>
                        {category === 'pipeline' && f.gap_usd > 0 && (
                          <span className={`text-sm font-semibold ${colorClasses.chip} flex-shrink-0`}>
                            {formatMoney(f.gap_usd)}
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      </Link>
                      <button
                        onClick={() => handleHide(f.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 flex-shrink-0"
                        title="Hide this finding (you can restore it later)"
                        aria-label="Hide finding"
                      >
                        <EyeOff className="h-3.5 w-3.5 text-gray-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n < 1) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}
