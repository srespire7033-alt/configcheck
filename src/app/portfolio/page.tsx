'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  GitMerge,
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Building2,
  TrendingDown,
  Download,
  FileText,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import type { OrgCardData } from '@/types';

interface CategoryComparison {
  category: string;
  label: string;
  perOrg: Array<{
    org_id: string;
    org_name: string;
    record_count: number;
    critical_issues: number;
    warning_issues: number;
    health_ratio: number;
  }>;
  greenfieldRecommendation: {
    source_org_id: string;
    source_org_name: string;
    reason: string;
  } | null;
}

interface PortfolioOrg {
  id: string;
  name: string;
  is_sandbox: boolean;
  connection_status: string | null;
  latest_scan_at: string | null;
  overall_score: number | null;
  total_issues: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
  estimated_annual_leakage: number | null;
  leakage_confidence: string | null;
  leakage_percent_of_revenue: number | null;
  currency: string;
}

interface PortfolioLeakage {
  total_estimated_annual_leakage: number;
  orgs_with_estimate: number;
  orgs_total: number;
  currency_mixed: boolean;
  primary_currency: string;
}

interface CompareResult {
  orgs: PortfolioOrg[];
  categories: CategoryComparison[];
  migration_manifest: Array<{
    category: string;
    label: string;
    source_org_id: string;
    source_org_name: string;
    reason: string;
  }>;
  portfolio_leakage?: PortfolioLeakage;
  generated_at: string;
}

function formatPortfolioMoney(amount: number, currency: string): string {
  if (amount >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${currency} ${(amount / 1_000).toFixed(0)}K`;
  return `${currency} ${amount.toLocaleString()}`;
}

export default function PortfolioPage() {
  const [orgs, setOrgs] = useState<OrgCardData[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/orgs')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: OrgCardData[]) => {
        setOrgs(data);
        // Preselect all orgs if there are <= 5; otherwise leave selection blank.
        if (data.length <= 5) {
          setSelected(new Set(data.map((o) => o.id)));
        }
      })
      .catch(() => setError('Failed to load orgs'))
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function runCompare() {
    if (selected.size < 2) {
      setError('Select at least 2 orgs to compare');
      return;
    }
    setComparing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/scans/portfolio-compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Comparison failed');
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setComparing(false);
    }
  }

  function exportManifest() {
    if (!result) return;
    const lines = [
      `OrgPrism — Greenfield Migration Manifest`,
      `Generated: ${new Date(result.generated_at).toLocaleString()}`,
      `Compared orgs: ${result.orgs.map((o) => o.name).join(', ')}`,
      ``,
      `For each configuration domain, this manifest identifies the "cleanest source"`,
      `org to use when assembling a new greenfield target org.`,
      ``,
      ...result.migration_manifest.map(
        (m) => `[${m.category.padEnd(15)}] ${m.label}\n    → Source: ${m.source_org_name}\n    → Why: ${m.reason}\n`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orgprism-migration-manifest-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <LoadingScreen />;

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Back to dashboard"
            >
              <ArrowLeft className="h-4 w-4 text-gray-500" />
            </Link>
            <div className="p-2 bg-blue-600 rounded-lg">
              <GitMerge className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Portfolio Compare</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Compare configurations across multiple orgs and identify greenfield migration sources.
              </p>
            </div>
          </div>
          {result && (
            <button
              onClick={exportManifest}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              Export Manifest
            </button>
          )}
        </div>

        {/* Org Picker */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Select 2 or more orgs to compare
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Comparison uses the latest completed scan from each org — no live Salesforce fetch needed.
            </p>
          </CardHeader>
          <CardContent>
            {orgs.length < 2 ? (
              <div className="p-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">Portfolio Compare needs at least 2 connected orgs.</p>
                <p className="mt-1">
                  Connect another org from the{' '}
                  <Link href="/dashboard" className="underline font-medium">
                    dashboard
                  </Link>{' '}
                  to get started.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                  {orgs.map((org) => {
                    const isSelected = selected.has(org.id);
                    return (
                      <button
                        key={org.id}
                        onClick={() => toggle(org.id)}
                        className={`flex items-start gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <div
                          className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                            isSelected
                              ? 'bg-blue-600 border-blue-600'
                              : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600'
                          }`}
                        >
                          {isSelected && (
                            <svg viewBox="0 0 12 12" className="w-3 h-3 text-white">
                              <path d="M2 6.5L4.8 9 10 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-3.5 w-3.5 text-gray-400" />
                            <span className="font-medium text-sm text-gray-900 dark:text-white truncate">{org.name}</span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {org.is_sandbox ? 'Sandbox' : 'Production'} · score {org.last_scan_score ?? '—'}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {selected.size} selected
                  </p>
                  <button
                    onClick={runCompare}
                    disabled={selected.size < 2 || comparing}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {comparing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Comparing…
                      </>
                    ) : (
                      <>
                        <GitMerge className="h-4 w-4" />
                        Compare {selected.size} org{selected.size === 1 ? '' : 's'}
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
            {error && (
              <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        {result && (
          <>
            {/* Portfolio-wide Revenue Leakage Banner — sums the per-scan
                estimates across every org in the comparison. Anchors the
                page in $ before any per-category breakdowns. */}
            {result.portfolio_leakage && result.portfolio_leakage.total_estimated_annual_leakage > 0 && (
              <Card className="border-amber-200 dark:border-amber-800/40 bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-900/10">
                <CardContent className="py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">
                        Portfolio-wide Estimated Revenue Leakage
                      </p>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">
                        {formatPortfolioMoney(
                          result.portfolio_leakage.total_estimated_annual_leakage,
                          result.portfolio_leakage.primary_currency
                        )}
                        <span className="text-base font-medium text-gray-500 dark:text-gray-400 ml-2">/ year combined</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                        Based on {result.portfolio_leakage.orgs_with_estimate} of {result.portfolio_leakage.orgs_total} orgs with revenue baselines.
                        {result.portfolio_leakage.currency_mixed && ' Currencies vary across orgs; figures summed at face value.'}
                      </p>
                    </div>
                    <TrendingDown className="h-8 w-8 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Per-Org Overview Strip */}
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Orgs in this comparison</h2>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                        <th className="pb-2 font-medium">Org</th>
                        <th className="pb-2 font-medium">Type</th>
                        <th className="pb-2 font-medium text-right">Score</th>
                        <th className="pb-2 font-medium text-right">Critical</th>
                        <th className="pb-2 font-medium text-right">Warning</th>
                        <th className="pb-2 font-medium text-right">Total Issues</th>
                        <th className="pb-2 font-medium text-right">Annual Leakage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {result.orgs.map((org) => (
                        <tr key={org.id}>
                          <td className="py-2.5 font-medium text-gray-900 dark:text-white">{org.name}</td>
                          <td className="py-2.5 text-gray-600 dark:text-gray-400">
                            {org.is_sandbox ? 'Sandbox' : 'Production'}
                          </td>
                          <td className="py-2.5 text-right font-mono">{org.overall_score ?? '—'}</td>
                          <td className="py-2.5 text-right text-red-600 dark:text-red-400 font-semibold">
                            {org.critical_count}
                          </td>
                          <td className="py-2.5 text-right text-amber-600 dark:text-amber-400">
                            {org.warning_count}
                          </td>
                          <td className="py-2.5 text-right text-gray-600 dark:text-gray-400">
                            {org.total_issues}
                          </td>
                          <td className="py-2.5 text-right font-mono font-semibold text-amber-700 dark:text-amber-300">
                            {typeof org.estimated_annual_leakage === 'number'
                              ? formatPortfolioMoney(org.estimated_annual_leakage, org.currency)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Migration Manifest — top section because this is THE deliverable */}
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-blue-500" />
                  Greenfield Migration Manifest
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  For a clean target org, pull each configuration domain from the org with the cleanest implementation in this portfolio.
                  This manifest is the consultant deliverable — hand it to delivery to start the migration.
                </p>
              </CardHeader>
              <CardContent>
                {result.migration_manifest.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No category had enough data to make a confident recommendation. Run a scan on each org first.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {result.migration_manifest.map((m) => (
                      <div
                        key={m.category}
                        className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50/40 to-transparent dark:from-blue-900/10"
                      >
                        <div className="mt-0.5 w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                          <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white">{m.label}</p>
                          <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">
                            Source: <span className="font-semibold text-blue-700 dark:text-blue-400">{m.source_org_name}</span>
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{m.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Side-by-side category matrix */}
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Side-by-side category matrix
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Record count and critical-issue density per category, per org. The cleanest source in each row is highlighted.
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                        <th className="pb-2 font-medium">Category</th>
                        {result.orgs.map((org) => (
                          <th key={org.id} className="pb-2 font-medium text-center px-3">
                            {org.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {result.categories.map((cat) => {
                        const sourceOrgId = cat.greenfieldRecommendation?.source_org_id;
                        return (
                          <tr key={cat.category}>
                            <td className="py-3 align-top">
                              <p className="font-medium text-gray-900 dark:text-white">{cat.label}</p>
                              {sourceOrgId && (
                                <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Cleanest: {cat.greenfieldRecommendation?.source_org_name}
                                </p>
                              )}
                            </td>
                            {cat.perOrg.map((cell) => {
                              const isSource = cell.org_id === sourceOrgId;
                              return (
                                <td
                                  key={cell.org_id}
                                  className={`py-3 px-3 text-center align-top ${
                                    isSource
                                      ? 'bg-blue-50 dark:bg-blue-900/20 rounded-lg'
                                      : ''
                                  }`}
                                >
                                  {cell.record_count === 0 ? (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                                  ) : (
                                    <div>
                                      <p className={`font-mono text-base ${isSource ? 'text-blue-700 dark:text-blue-300 font-bold' : 'text-gray-900 dark:text-white'}`}>
                                        {cell.record_count}
                                      </p>
                                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                                        {cell.critical_issues > 0 ? (
                                          <span className="text-red-600 dark:text-red-400 inline-flex items-center gap-0.5">
                                            <TrendingDown className="h-2.5 w-2.5" />
                                            {cell.critical_issues} crit
                                          </span>
                                        ) : (
                                          <span className="text-green-600 dark:text-green-400">clean</span>
                                        )}
                                      </p>
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
