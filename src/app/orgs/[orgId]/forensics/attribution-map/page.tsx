'use client';

/**
 * Org-wide Attribution Map — the consultant-deliverable hero screen.
 *
 * Per-finding drill-down (existing /forensics/[findingId]) answers
 * "why did this one leak happen?"
 *
 * Attribution Map answers "what 5 root config objects, if fixed,
 * recover the most $?" That second question is what an engagement
 * gets scoped around.
 *
 * Each row is one root config. Click to expand → the findings
 * attributed to it, with per-finding links.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Network,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertCircle,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';

interface AttributionMapRow {
  root_cause_class: 'A' | 'B' | 'C' | 'D' | 'E';
  root_config_type: string;
  root_config_id: string | null;
  root_config_name: string;
  primary_reason_code: string;
  max_confidence: number;
  primary_explanation: string | null;
  primary_suggested_fix: string | null;
  detectors: string[];
  finding_count: number;
  total_gap_usd: number;
  currency_iso_code: string;
  sample_finding_ids: string[];
}

interface MapResponse {
  scan_id: string | null;
  rows: AttributionMapRow[];
  total_gap_usd: number;
  total_findings: number;
  unattributed_findings: { count: number; total_gap_usd: number };
}

const CLASS_META: Record<AttributionMapRow['root_cause_class'], { label: string; bg: string; text: string; ring: string }> = {
  A: { label: 'System disconnect',   bg: 'bg-red-100 dark:bg-red-900/30',       text: 'text-red-700 dark:text-red-300',       ring: 'ring-red-500/30' },
  B: { label: 'Manual override',     bg: 'bg-amber-100 dark:bg-amber-900/30',   text: 'text-amber-700 dark:text-amber-300',   ring: 'ring-amber-500/30' },
  C: { label: 'Conflicting auto.',   bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', ring: 'ring-purple-500/30' },
  D: { label: 'Missing governance',  bg: 'bg-blue-100 dark:bg-blue-900/30',     text: 'text-blue-700 dark:text-blue-300',     ring: 'ring-blue-500/30' },
  E: { label: 'Data quality',        bg: 'bg-gray-100 dark:bg-gray-800',        text: 'text-gray-700 dark:text-gray-300',     ring: 'ring-gray-500/30' },
};

function formatMoney(amount: number, currency: string): string {
  if (amount >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${currency} ${(amount / 1_000).toFixed(0)}K`;
  return `${currency} ${amount.toLocaleString()}`;
}

export default function AttributionMapPage() {
  const params = useParams();
  const orgId = params?.orgId as string;

  const [data, setData] = useState<MapResponse | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgInstanceUrl, setOrgInstanceUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [classFilter, setClassFilter] = useState<AttributionMapRow['root_cause_class'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/forensics/attribution-map?organizationId=${orgId}`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))
      ),
      fetch(`/api/orgs?id=${orgId}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([mapRes, orgRes]) => {
        setData(mapRes);
        if (orgRes?.name) setOrgName(orgRes.name);
        if (orgRes?.instance_url) setOrgInstanceUrl(orgRes.instance_url);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [orgId]);

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
  if (!data || !data.scan_id) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <Network className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            No forensic scan yet
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Run a forensic scan first — the attribution map aggregates verified findings by their root config objects.
          </p>
          <Link
            href={`/orgs/${orgId}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back to org
          </Link>
        </div>
      </div>
    );
  }

  const filteredRows = classFilter
    ? data.rows.filter((r) => r.root_cause_class === classFilter)
    : data.rows;
  const filteredGap = filteredRows.reduce((s, r) => s + r.total_gap_usd, 0);

  // Count rows by class for the filter pills
  const classCounts: Record<string, number> = {};
  for (const row of data.rows) {
    classCounts[row.root_cause_class] = (classCounts[row.root_cause_class] ?? 0) + 1;
  }

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
          <div className="p-2 bg-purple-600 rounded-lg">
            <Network className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Attribution Map</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {orgName ?? 'Org'} · Root config objects ranked by $ at risk.
              One fix can resolve every finding under a root.
            </p>
          </div>
        </div>

        {/* Summary card */}
        <Card>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 py-2">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Total verified leakage</p>
                <p className="text-3xl font-bold text-amber-700 dark:text-amber-400">
                  {formatMoney(data.total_gap_usd, data.rows[0]?.currency_iso_code ?? 'USD')}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Root causes</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{data.rows.length}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">across {data.total_findings} finding{data.total_findings === 1 ? '' : 's'}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Top root recoverable
                </p>
                <p className="text-3xl font-bold text-green-700 dark:text-green-400">
                  {data.rows[0] ? formatMoney(data.rows[0].total_gap_usd, data.rows[0].currency_iso_code) : '—'}
                </p>
                {data.rows[0] && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {data.rows[0].root_config_name}
                  </p>
                )}
              </div>
            </div>
            {data.unattributed_findings.count > 0 && (
              <p className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                {data.unattributed_findings.count} finding{data.unattributed_findings.count === 1 ? '' : 's'}
                {' '}({formatMoney(data.unattributed_findings.total_gap_usd, data.rows[0]?.currency_iso_code ?? 'USD')})
                have no attribution trace and aren&apos;t shown here. Click any finding from the org page to investigate manually.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Class filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setClassFilter(null)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full transition ${
              classFilter === null
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            All ({data.rows.length})
          </button>
          {(['A', 'B', 'C', 'D', 'E'] as const).map((cls) => {
            const count = classCounts[cls] ?? 0;
            if (count === 0) return null;
            const meta = CLASS_META[cls];
            const isActive = classFilter === cls;
            return (
              <button
                key={cls}
                onClick={() => setClassFilter(isActive ? null : cls)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full transition ${
                  isActive ? `${meta.bg} ${meta.text} ring-2 ${meta.ring}` : `${meta.bg} ${meta.text} hover:opacity-80`
                }`}
              >
                {cls} · {meta.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Ranked root-cause list */}
        {filteredRows.length === 0 ? (
          <Card>
            <CardContent>
              <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
                {classFilter
                  ? `No findings under class ${classFilter} for this scan.`
                  : `No attributed findings yet. Findings without attribution traces live on the org page.`}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredRows.map((row, idx) => {
              const key = `${row.root_cause_class}-${row.root_config_id ?? row.root_config_name}-${idx}`;
              const isExpanded = expanded.has(key);
              const meta = CLASS_META[row.root_cause_class];
              const sfUrl =
                orgInstanceUrl && row.root_config_id
                  ? `${orgInstanceUrl}/lightning/r/${row.root_config_type}/${row.root_config_id}/view`
                  : null;
              return (
                <Card key={key}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <span
                          className={`flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold ${meta.bg} ${meta.text}`}
                        >
                          {row.root_cause_class}
                          <span className="font-medium opacity-70">· {meta.label}</span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
                            {row.root_config_name}
                          </h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            <code className="font-mono">{row.root_config_type}</code>
                            {' · '}
                            {row.finding_count} finding{row.finding_count === 1 ? '' : 's'}
                            {' · '}
                            via {row.detectors.join(', ')}
                            {' · '}
                            confidence {Math.round(row.max_confidence * 100)}%
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                          {formatMoney(row.total_gap_usd, row.currency_iso_code)}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">at risk</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {row.primary_explanation && (
                      <div className="rounded-lg bg-blue-50/40 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/40 p-3 mb-3">
                        <p className="text-[11px] uppercase tracking-wider text-blue-700 dark:text-blue-400 mb-1 flex items-center gap-1">
                          <Sparkles className="h-3 w-3" /> Why this is the root cause
                        </p>
                        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                          {row.primary_explanation}
                        </p>
                      </div>
                    )}
                    {row.primary_suggested_fix && (
                      <div className="rounded-lg bg-green-50/40 dark:bg-green-900/10 border border-green-200 dark:border-green-800/40 p-3 mb-3">
                        <p className="text-[11px] uppercase tracking-wider text-green-700 dark:text-green-400 mb-1 flex items-center gap-1">
                          <Wrench className="h-3 w-3" /> One-fix recovery
                        </p>
                        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                          {row.primary_suggested_fix}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 flex-wrap mt-3">
                      <button
                        onClick={() => {
                          const next = new Set(expanded);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          setExpanded(next);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
                      >
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {row.finding_count} finding{row.finding_count === 1 ? '' : 's'} {isExpanded ? 'collapsed' : 'attributed'}
                      </button>
                      {sfUrl && (
                        <a
                          href={sfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Open in Salesforce <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-1">
                        {row.sample_finding_ids.map((findingId) => (
                          <Link
                            key={findingId}
                            href={`/orgs/${orgId}/forensics/${findingId}`}
                            className="block px-3 py-1.5 text-xs rounded hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300 font-mono"
                          >
                            → {findingId}
                          </Link>
                        ))}
                        {row.finding_count > row.sample_finding_ids.length && (
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 px-3 pt-1">
                            +{row.finding_count - row.sample_finding_ids.length} more (sample capped at {row.sample_finding_ids.length})
                          </p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Footer summary when filtered */}
        {classFilter && (
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center pt-2">
            Showing {filteredRows.length} of {data.rows.length} root causes · {' '}
            {formatMoney(filteredGap, data.rows[0]?.currency_iso_code ?? 'USD')} of {formatMoney(data.total_gap_usd, data.rows[0]?.currency_iso_code ?? 'USD')} total at risk
          </div>
        )}
      </div>
    </div>
  );
}
