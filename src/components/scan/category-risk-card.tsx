'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ShieldAlert, TrendingDown, ChevronRight, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import type { CategoryRiskResponse } from '@/app/api/orgs/[orgId]/category-risk/route';

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
  const copy = COPY[category];

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
        <CardContent className="py-4 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {copy.title} unavailable: {error}
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
              <h2 className="text-lg font-semibold">{copy.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{copy.subtitle}</p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-3xl font-bold ${colorClasses.chip}`}>{data.total_findings}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {category === 'pipeline' && data.total_at_risk_usd > 0
                ? formatMoney(data.total_at_risk_usd) + ' ARR'
                : data.total_findings === 1 ? '1 finding' : `${data.total_findings} findings`}
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

        {data.top_findings.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Top {Math.min(5, data.top_findings.length)} findings
            </p>
            <div className="space-y-1">
              {data.top_findings.slice(0, 5).map((f) => (
                <Link
                  key={f.id}
                  href={`/orgs/${orgId}/forensics/${f.id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 -mx-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400 uppercase">
                      {f.detector_id}
                    </p>
                    <p className="text-sm truncate">{f.title}</p>
                  </div>
                  {category === 'pipeline' && f.gap_usd > 0 && (
                    <span className={`text-sm font-semibold ${colorClasses.chip} flex-shrink-0`}>
                      {formatMoney(f.gap_usd)}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        )}
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
