'use client';

import { useState } from 'react';
import { TrendingDown, Info, ChevronDown, ChevronUp, AlertCircle, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface TopContributor {
  check_id: string;
  title: string;
  severity: string;
  impact: number;
  methodology: string;
}

export interface RevenueLeakageData {
  estimated_annual_leakage: number;
  percent_of_revenue: number | null;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  top_contributors: TopContributor[];
  top_affected_accounts: Array<{ account_id: string; account_name: string; impact: number }>;
  coverage: {
    issues_evaluated: number;
    issues_with_formula: number;
    issues_with_impact: number;
  };
  audit: {
    baseline_source: 'opportunity' | 'sbqq_quote' | 'order' | 'default';
    baseline_sample_size: number;
    baseline_confidence: 'high' | 'medium' | 'low' | 'unknown';
    industry_used: string;
    use_median: boolean;
    formula_version: string;
    computed_at: string;
    notes: string[];
  };
}

export interface VerifiedLeakage {
  total_verified_usd: number;
  finding_count: number;
  status: string;
  forensic_scan_id: string | null;
  top_findings: Array<{
    id: string;
    detector_id: string;
    title: string;
    gap_usd: number;
  }>;
}

interface Props {
  leakage: RevenueLeakageData;
  verified?: VerifiedLeakage | null;
  orgId?: string;
  currency?: string;
}

const CONFIDENCE_STYLES: Record<
  RevenueLeakageData['confidence'],
  { label: string; bgClass: string; textClass: string }
> = {
  high: {
    label: 'High confidence',
    bgClass: 'bg-green-100 dark:bg-green-900/30',
    textClass: 'text-green-700 dark:text-green-300',
  },
  medium: {
    label: 'Medium confidence',
    bgClass: 'bg-blue-100 dark:bg-blue-900/30',
    textClass: 'text-blue-700 dark:text-blue-300',
  },
  low: {
    label: 'Low confidence',
    bgClass: 'bg-amber-100 dark:bg-amber-900/30',
    textClass: 'text-amber-700 dark:text-amber-300',
  },
  unknown: {
    label: 'Estimate only',
    bgClass: 'bg-gray-100 dark:bg-gray-800',
    textClass: 'text-gray-600 dark:text-gray-400',
  },
};

const SOURCE_LABELS: Record<RevenueLeakageData['audit']['baseline_source'], string> = {
  opportunity: 'Opportunity records',
  sbqq_quote: 'CPQ Quote records',
  order: 'Order records',
  default: 'system defaults',
};

function formatMoney(amount: number, currency: string): string {
  if (amount >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${currency} ${(amount / 1_000).toFixed(0)}K`;
  return `${currency} ${amount.toLocaleString()}`;
}

export function RevenueLeakageCard({ leakage, verified, orgId, currency = 'USD' }: Props) {
  const [showMethodology, setShowMethodology] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const confStyle = CONFIDENCE_STYLES[leakage.confidence];
  // Headline math: verified $ is the floor we can defend with real
  // transactional records; estimated $ is the heuristic on top. The
  // combined number is what consultants quote to their clients, but the
  // verified portion is what survives CFO scrutiny.
  const verifiedUsd = verified?.total_verified_usd ?? 0;
  const estimated = leakage.estimated_annual_leakage;
  const total = verifiedUsd + estimated;
  const forensicRunning = verified && ['queued', 'running', 'reconciling', 'attributing'].includes(verified.status);

  return (
    <Card className="border-amber-200 dark:border-amber-800/40 bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-900/10">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <TrendingDown className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Revenue Leakage
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {verifiedUsd > 0
                  ? 'Verified findings from real records + estimated impact from config heuristics'
                  : 'Forward-looking annualized estimate based on your org’s actual data'}
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${confStyle.bgClass} ${confStyle.textClass}`}
          >
            {confStyle.label}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {/* Headline. When forensic findings exist we split verified vs
            estimated explicitly — verified $ is what survives a CFO
            asking "show me the records." Estimated is the heuristic
            layer on top, kept honest with the same "Estimate only" chip.
            The word "Total" is explicit so users don't have to decode
            the breakdown to know what the big number represents. */}
        <div className="mb-5">
          <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
            {verifiedUsd > 0 ? 'Total Revenue Leakage' : 'Estimated Revenue Leakage'}
          </p>
          <div className="text-4xl font-bold text-gray-900 dark:text-white">
            {formatMoney(total, currency)}
            <span className="text-base font-medium text-gray-500 dark:text-gray-400 ml-2">/ year</span>
          </div>
          {verifiedUsd > 0 && (
            <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100/60 dark:bg-gray-800/40 text-sm">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                ✓ Verified
              </span>
              <span className="font-mono text-gray-900 dark:text-white">{formatMoney(verifiedUsd, currency)}</span>
              <span className="text-gray-400 dark:text-gray-500">+</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                ~ Estimated
              </span>
              <span className="font-mono text-gray-900 dark:text-white">{formatMoney(estimated, currency)}</span>
            </div>
          )}
          {forensicRunning && (
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Forensic scan running — verified $ updating live
            </p>
          )}
          {leakage.percent_of_revenue !== null && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1.5">
              {leakage.percent_of_revenue.toFixed(1)}% of your annual revenue from{' '}
              {SOURCE_LABELS[leakage.audit.baseline_source]}
            </p>
          )}
        </div>

        {/* Verified findings drill-down. Surfaces above the estimated
            contributors because real $ outranks heuristic $. Each one
            links to the finding detail page for attribution + recovery. */}
        {verified && verified.top_findings.length > 0 && orgId && (
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400 mb-2 flex items-center gap-1.5">
              {verified.top_findings.length < verified.finding_count
                ? `✓ Top ${verified.top_findings.length} of ${verified.finding_count} verified findings`
                : `✓ Verified findings (${verified.finding_count})`}
            </p>
            <div className="space-y-1.5">
              {verified.top_findings.map((f) => (
                <a
                  key={f.id}
                  href={`/orgs/${orgId}/forensics/${f.id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-green-200 dark:border-green-800/40 bg-green-50/40 dark:bg-green-900/10 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="text-[11px] font-mono text-green-700 dark:text-green-400 flex-shrink-0">
                      {f.detector_id}
                    </code>
                    <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{f.title}</span>
                  </div>
                  <span className="font-mono font-semibold text-green-700 dark:text-green-300 flex-shrink-0">
                    {formatMoney(f.gap_usd, currency)}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Top contributors */}
        {leakage.top_contributors.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              Top {Math.min(5, leakage.top_contributors.length)} contributors
            </p>
            <div className="space-y-1.5">
              {leakage.top_contributors.slice(0, 5).map((c, i) => (
                <div
                  key={c.check_id + i}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/40"
                >
                  <button
                    onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <code className="text-[11px] font-mono text-gray-500 dark:text-gray-400 flex-shrink-0">
                        {c.check_id}
                      </code>
                      <span className="text-sm text-gray-800 dark:text-gray-200 truncate">
                        {c.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="font-mono font-semibold text-amber-700 dark:text-amber-300">
                        {formatMoney(c.impact, currency)}
                      </span>
                      {expandedIdx === i ? (
                        <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                      )}
                    </div>
                  </button>
                  {expandedIdx === i && (
                    <div className="px-3 py-2.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30">
                      <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
                        <Sparkles className="inline h-3 w-3 text-blue-500 mr-1" />
                        {c.methodology}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Methodology disclosure */}
        <button
          onClick={() => setShowMethodology((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800/50 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors text-left"
        >
          <span className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
            <Info className="h-3.5 w-3.5" />
            How was this calculated?
          </span>
          {showMethodology ? (
            <ChevronUp className="h-3.5 w-3.5 text-gray-500" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
          )}
        </button>
        {showMethodology && (
          <div className="mt-3 px-3 py-3 rounded-lg bg-white dark:bg-[#0f172a] border border-gray-200 dark:border-gray-700 text-[12px] text-gray-700 dark:text-gray-300 leading-relaxed space-y-2">
            <p>
              <strong>Source:</strong> {SOURCE_LABELS[leakage.audit.baseline_source]} (
              {leakage.audit.baseline_sample_size.toLocaleString()} records analyzed)
            </p>
            <p>
              <strong>Averaging:</strong> {leakage.audit.use_median ? 'Median (robust to outliers)' : 'Mean'}
            </p>
            <p>
              <strong>Industry profile:</strong>{' '}
              <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
                {leakage.audit.industry_used}
              </code>{' '}
              (drives LTV multiplier — SaaS deals compound over multi-year subscriptions, one-time deals don&rsquo;t)
            </p>
            <p>
              <strong>Coverage:</strong> {leakage.coverage.issues_with_impact} of {leakage.coverage.issues_evaluated}{' '}
              findings have defensible $ formulas (the rest stay qualitative)
            </p>
            <p>
              <strong>Recoverability factors:</strong> Each formula includes a per-check recoverability % so we don&rsquo;t
              overpromise. Some leakage is structurally non-recoverable (e.g., legitimate promo deals).
            </p>
            <p>
              <strong>Forward-looking:</strong> This is the annualized $ you would lose <em>going forward</em> if
              configurations stay broken — not what&rsquo;s already lost in the past 12 months.
            </p>
            {leakage.audit.notes.length > 0 && (
              <div className="pt-2 mt-2 border-t border-gray-200 dark:border-gray-700">
                <p className="font-semibold mb-1">Caveats:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {leakage.audit.notes.map((n, i) => (
                    <li key={i} className="text-amber-700 dark:text-amber-400">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[10px] text-gray-400 dark:text-gray-500 pt-1 border-t border-gray-100 dark:border-gray-800">
              Computed {new Date(leakage.audit.computed_at).toLocaleString()} · Formula version{' '}
              <code>{leakage.audit.formula_version}</code>
            </p>
          </div>
        )}

        {/* Empty-state fallback for no contributors */}
        {leakage.top_contributors.length === 0 && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-800 dark:text-blue-300">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>
              No findings in this scan map to a defensible $ formula yet. The headline number includes only checks
              with quantifiable revenue impact.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
