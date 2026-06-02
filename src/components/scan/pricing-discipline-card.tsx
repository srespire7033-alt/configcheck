'use client';

import { useEffect, useState } from 'react';
import { Scale, ChevronDown, ChevronUp, AlertTriangle, TrendingDown, ExternalLink, Info, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { PricingDisciplineResponse } from '@/app/api/orgs/[orgId]/pricing-discipline/route';

export function PricingDisciplineCard({ orgId }: { orgId: string }) {
  const [data, setData] = useState<PricingDisciplineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/orgs/${orgId}/pricing-discipline`);
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        const j = (await r.json()) as PricingDisciplineResponse;
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

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-gray-500 dark:text-gray-400">
          Loading pricing discipline metrics…
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Pricing discipline couldn&rsquo;t load</p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;
  if (data.total_quote_lines === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3 items-start">
            <div className="rounded-lg bg-indigo-100 dark:bg-indigo-900/30 p-2">
              <Scale className="h-5 w-5 text-indigo-700 dark:text-indigo-300" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Pricing Discipline</h2>
              <p className="text-base text-gray-500 dark:text-gray-400">
                Org-level pricing-health signals across {data.total_quote_lines.toLocaleString()} quote lines (last 12 months).
              </p>
            </div>
          </div>
          <GradeBadge grade={data.grade} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Discount discipline */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg discount applied</p>
            <p className="text-3xl font-bold">{data.avg_discount_pct.toFixed(1)}%</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Median: {data.median_discount_pct.toFixed(1)}%
            </p>
            <p
              className="text-xs text-gray-500 dark:text-gray-400 mt-1 inline-flex items-center gap-1 cursor-help"
              title={data.approved_threshold_source}
            >
              Max allowed discount: {data.approved_threshold_pct}% <Info className="h-3 w-3 opacity-60" />
            </p>
            <p className="text-sm mt-2">
              <span className={data.pct_lines_above_threshold > 30 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-600 dark:text-gray-300'}>
                {data.pct_lines_above_threshold.toFixed(1)}%
              </span>{' '}
              of lines discounted beyond the limit ({data.lines_above_threshold.toLocaleString()} lines)
            </p>
          </div>

          {/* Override discipline */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Manual price overrides</p>
            <p className="text-3xl font-bold">{data.override_pct.toFixed(1)}%</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {data.override_count.toLocaleString()} lines with prices typed in manually (CPQ&rsquo;s calculation bypassed)
            </p>
            <p className="text-sm mt-2 text-gray-600 dark:text-gray-300">
              {data.override_pct > 25
                ? 'High — reps frequently bypass calculated price'
                : data.override_pct > 10
                  ? 'Moderate — some override activity'
                  : 'Low — calculated price is honored'}
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{data.grade_narrative}</p>

        {(data.top_discount_offenders.length > 0 || data.top_override_offenders.length > 0) && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 mt-2"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? 'Hide' : 'Show'} top offenders
          </button>
        )}

        {expanded && (
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.top_discount_offenders.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
                    <TrendingDown className="h-3 w-3" /> Highest avg discount (by product)
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                        <th className="py-1">Product</th>
                        <th className="py-1 text-right">Lines</th>
                        <th className="py-1 text-right">Avg discount</th>
                        <th className="py-1">Sample quote</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_discount_offenders.map((row) => (
                        <tr key={row.product_id} className="border-b border-gray-100 dark:border-gray-900">
                          <td className="py-1 truncate max-w-[150px]" title={row.product_name}>{row.product_name}</td>
                          <td className="py-1 text-right">{row.line_count}</td>
                          <td className="py-1 text-right font-mono">{row.avg_discount_pct.toFixed(1)}%</td>
                          <td className="py-1 truncate max-w-[100px] text-gray-500 dark:text-gray-400">
                            {row.sample_quote_name ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.top_override_offenders.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" /> Most-overridden products
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                        <th className="py-1">Product</th>
                        <th className="py-1 text-right">Override count</th>
                        <th className="py-1">Sample quote</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_override_offenders.map((row) => (
                        <tr key={row.product_id} className="border-b border-gray-100 dark:border-gray-900">
                          <td className="py-1 truncate max-w-[150px]" title={row.product_name}>{row.product_name}</td>
                          <td className="py-1 text-right font-mono">{row.override_count}</td>
                          <td className="py-1 truncate max-w-[100px] text-gray-500 dark:text-gray-400">
                            {row.sample_quote_name ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-4">
                  No manual overrides detected in window
                </div>
              )}
            </div>

            {data.top_discounting_accounts.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> Top discounting accounts
                </p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                      <th className="py-1">Account</th>
                      <th className="py-1 text-right">Lines</th>
                      <th className="py-1 text-right">Avg discount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_discounting_accounts.map((row) => (
                      <tr key={row.account_id} className="border-b border-gray-100 dark:border-gray-900">
                        <td className="py-1 truncate max-w-[200px]" title={row.account_name}>{row.account_name}</td>
                        <td className="py-1 text-right">{row.line_count}</td>
                        <td className="py-1 text-right font-mono">{row.avg_discount_pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GradeBadge({ grade }: { grade: 'A' | 'B' | 'C' | 'D' | 'F' }) {
  const cls = {
    A: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    B: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    C: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    D: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800',
    F: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  }[grade];
  return (
    <div className={`flex flex-col items-center justify-center rounded-lg border-2 px-3 py-1 ${cls}`}>
      <span className="text-2xl font-bold leading-tight">{grade}</span>
      <span className="text-[10px] uppercase tracking-wider">grade</span>
    </div>
  );
}
