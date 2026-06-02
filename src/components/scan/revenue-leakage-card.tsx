'use client';

import { useState } from 'react';
import { TrendingDown, Info, ChevronDown, ChevronUp, AlertCircle, Sparkles, Network, ChevronRight, ShieldCheck, FileDown, RefreshCw, Percent, Receipt, Layers, Lock, EyeOff } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getDetectorEffort, type EffortLevel } from '@/lib/forensics/types';

// Effort badge — borrowed pattern from Hubbl's severity×effort matrix.
// Lets a consultant glance at a finding and know if it's a quick win
// (Low effort + high \$) or a deeper engagement (High effort).
const EFFORT_META: Record<EffortLevel, { label: string; bg: string; text: string; ring: string }> = {
  low: { label: 'Low effort', bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-200/60 dark:ring-emerald-800/40' },
  medium: { label: 'Medium effort', bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300', ring: 'ring-amber-200/60 dark:ring-amber-800/40' },
  high: { label: 'High effort', bg: 'bg-rose-50 dark:bg-rose-900/20', text: 'text-rose-700 dark:text-rose-300', ring: 'ring-rose-200/60 dark:ring-rose-800/40' },
};

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
    label: 'Projected (formula-based)',
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

        {/* Verified findings drill-down — grouped by detector so the
            card stays readable when forensic scans produce many
            findings. When there's only one detector or only a few
            findings, we flatten back to the per-finding list. */}
        {verified && verified.top_findings.length > 0 && orgId && (
          <>
            <VerifiedFindingsSection
              findings={verified.top_findings}
              totalCount={verified.finding_count}
              orgId={orgId}
              currency={currency}
            />
            {/* Hero CTA — the consultant-deliverable screen. Surfaces
                only when verified findings exist (no map to show
                otherwise). */}
            <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <a
                href={`/orgs/${orgId}/forensics/attribution-map`}
                className="group flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-sm shadow-purple-600/20 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Network className="h-5 w-5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">Attribution Map</p>
                    <p className="text-[11px] opacity-80 truncate">
                      Root configs ranked by $ at risk
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 opacity-70 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
              </a>
              <a
                href={`/orgs/${orgId}/forensics/recovery`}
                className="group flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-sm shadow-green-600/20 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ShieldCheck className="h-5 w-5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">Recovery Queue</p>
                    <p className="text-[11px] opacity-80 truncate">
                      Stage → approve → download CSV
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 opacity-70 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
              </a>
              <a
                href={`/api/orgs/${orgId}/executive-report`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-slate-700 to-slate-900 hover:from-slate-800 hover:to-black text-white shadow-sm shadow-slate-700/20 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileDown className="h-5 w-5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">Download Client Report</p>
                    <p className="text-[11px] opacity-80 truncate">
                      5-page executive PDF · the deliverable
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 opacity-70 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
              </a>
            </div>
          </>
        )}

        {/* Top contributors */}
        {leakage.top_contributors.length > 0 && (
          <div className="mb-4">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Biggest revenue leaks
              </p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                Top {Math.min(5, leakage.top_contributors.length)} by $ impact
              </p>
            </div>
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
              <strong>How much we sized:</strong> {leakage.coverage.issues_with_impact} of {leakage.coverage.issues_evaluated}{' '}
              issues had enough data to attach a dollar figure. The rest are flagged qualitatively.
            </p>
            <p>
              <strong>What you can realistically recover:</strong> Every formula is multiplied by a recovery % so we don&rsquo;t
              overpromise. Some leakage is structurally unrecoverable (e.g., legitimate promo deals already honored).
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

/**
 * Verified findings list with adaptive layout:
 *   - ≤5 findings total: render flat (per-finding rows). Same as before.
 *   - >5 findings: collapse into per-detector groups ("REN-001 — 9 findings,
 *     USD 126K"). Click a group to expand its individual findings inline.
 *
 * Keeps the leakage card readable as the engine ships more detectors and
 * customers run scans across many checks. Defers a dedicated /forensics
 * page until card-scrolling becomes truly painful.
 */
/**
 * Theme groupings for the verified-findings cards. Each theme tells
 * one coherent story a consultant can lead a conversation around.
 *
 * Keep in sync with DETECTOR_CATEGORY in lib/forensics/types.ts — every
 * revenue_leakage detector ID should appear in exactly one theme group.
 * Detectors not in any theme still surface under 'Other' (back-compat).
 */
interface FindingTheme {
  key: string;
  label: string;
  description: string;
  detectorIds: ReadonlyArray<string>;
  icon: typeof RefreshCw;
  accentText: string;
  accentBg: string;
  accentBorder: string;
}
const FINDING_THEMES: ReadonlyArray<FindingTheme> = [
  {
    key: 'renewals',
    label: 'Renewals',
    description: 'Uplift suppressed, renewal below current list.',
    detectorIds: ['REN-001', 'REN-002'],
    icon: RefreshCw,
    accentText: 'text-blue-700 dark:text-blue-300',
    accentBg: 'bg-blue-100 dark:bg-blue-900/30',
    accentBorder: 'border-blue-200 dark:border-blue-800/40',
  },
  {
    key: 'discounting',
    label: 'Discounting',
    description: 'Discounts kept past their date, options given away free, caps exceeded.',
    detectorIds: ['DSC-FOR-001', 'DSC-FOR-002', 'QL-FOR-001'],
    icon: Percent,
    accentText: 'text-amber-700 dark:text-amber-300',
    accentBg: 'bg-amber-100 dark:bg-amber-900/30',
    accentBorder: 'border-amber-200 dark:border-amber-800/40',
  },
  {
    key: 'orders',
    label: 'Orders & Billing',
    description: 'Q→O variance, activated orders with no billing schedule, terminated assets still billing.',
    detectorIds: ['ORD-FOR-001', 'ORD-FOR-002', 'ORD-FOR-003', 'AST-FOR-001'],
    icon: Receipt,
    accentText: 'text-indigo-700 dark:text-indigo-300',
    accentBg: 'bg-indigo-100 dark:bg-indigo-900/30',
    accentBorder: 'border-indigo-200 dark:border-indigo-800/40',
  },
  {
    key: 'subs',
    label: 'Subscriptions',
    description: 'Subscription quantity vs Asset drift, provisioning gaps.',
    detectorIds: ['SUB-FOR-001', 'PROV-FOR-001', 'PROV-FOR-002'],
    icon: Layers,
    accentText: 'text-emerald-700 dark:text-emerald-300',
    accentBg: 'bg-emerald-100 dark:bg-emerald-900/30',
    accentBorder: 'border-emerald-200 dark:border-emerald-800/40',
  },
  {
    key: 'pricing',
    label: 'Pricing Locks',
    description: 'Expired contracted prices, multi-year flat segments.',
    detectorIds: ['CT-FOR-001', 'MDQ-FOR-001'],
    icon: Lock,
    accentText: 'text-slate-700 dark:text-slate-300',
    accentBg: 'bg-slate-100 dark:bg-slate-800',
    accentBorder: 'border-slate-200 dark:border-slate-700',
  },
];

function VerifiedFindingsSection({
  findings,
  totalCount,
  orgId,
  currency,
}: {
  findings: Array<{ id: string; detector_id: string; title: string; gap_usd: number }>;
  totalCount: number;
  orgId: string;
  currency: string;
}) {
  // Local hide-state — when the user clicks the eye-off on a finding
  // we drop it from view immediately (optimistic). The server-side
  // DELETE of hidden_at would survive a refresh anyway, but reactive
  // local state means the user doesn't have to refresh to see it go.
  const [locallyHidden, setLocallyHidden] = useState<Set<string>>(new Set());
  const visibleFindings = findings.filter((f) => !locallyHidden.has(f.id));
  const handleHide = (id: string) => {
    setLocallyHidden((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  if (visibleFindings.length === 0) return null;

  // Build per-theme buckets up front.
  const themedBuckets = FINDING_THEMES.map((theme) => {
    const matched = visibleFindings.filter((f) => theme.detectorIds.includes(f.detector_id));
    return {
      ...theme,
      items: matched,
      total: matched.reduce((s, f) => s + f.gap_usd, 0),
    };
  });
  // Anything that didn't match a theme falls through to 'Other'.
  const themedIds = new Set(FINDING_THEMES.flatMap((t) => t.detectorIds));
  const otherItems = visibleFindings.filter((f) => !themedIds.has(f.detector_id));
  if (otherItems.length > 0) {
    themedBuckets.push({
      key: 'other',
      label: 'Other',
      description: 'Detectors not in a named theme.',
      detectorIds: [],
      icon: Sparkles,
      accentText: 'text-gray-700 dark:text-gray-300',
      accentBg: 'bg-gray-100 dark:bg-gray-800',
      accentBorder: 'border-gray-200 dark:border-gray-700',
      items: otherItems,
      total: otherItems.reduce((s, f) => s + f.gap_usd, 0),
    });
  }

  const grandTotal = visibleFindings.reduce((s, f) => s + f.gap_usd, 0);
  const visibleCount = visibleFindings.length;
  const headerLabel =
    locallyHidden.size > 0
      ? `✓ ${visibleCount} verified finding${visibleCount === 1 ? '' : 's'} (${locallyHidden.size} hidden)`
      : visibleCount < totalCount
        ? `✓ Top ${visibleCount} of ${totalCount} verified findings`
        : `✓ Verified findings (${totalCount})`;

  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">
          {headerLabel}
        </p>
        <span className="text-[11px] font-mono text-green-700 dark:text-green-400">
          {formatMoney(grandTotal, currency)} total
        </span>
      </div>

      {/* 3-per-row grid keeps the dashboard short. Each card is
          self-contained: theme + count + \$ in the header, top 3
          findings inline. Empty themes stay visible (muted) so the
          consultant can point at 'we checked, nothing here.' */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {[...themedBuckets].sort((a, b) => b.total - a.total).map((bucket) => (
          <ThemeCard
            key={bucket.key}
            bucket={bucket}
            orgId={orgId}
            currency={currency}
            onHide={handleHide}
          />
        ))}
      </div>
    </div>
  );
}

interface ThemeBucket extends FindingTheme {
  items: Array<{ id: string; detector_id: string; title: string; gap_usd: number }>;
  total: number;
}

function ThemeCard({
  bucket,
  orgId,
  currency,
  onHide,
}: {
  bucket: ThemeBucket;
  orgId: string;
  currency: string;
  onHide?: (findingId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = bucket.icon;
  const isEmpty = bucket.items.length === 0;
  // Compact mode shows 3 in the default state. The grid is 1/3 of
  // the screen width so anything more starts wrapping.
  const VISIBLE_LIMIT = 3;

  const sorted = [...bucket.items].sort((a, b) => b.gap_usd - a.gap_usd);
  const visible = expanded ? sorted : sorted.slice(0, VISIBLE_LIMIT);
  const hidden = Math.max(0, sorted.length - VISIBLE_LIMIT);

  return (
    <div
      className={`rounded-xl border ${bucket.accentBorder} bg-white dark:bg-gray-900/40 flex flex-col ${isEmpty ? 'opacity-60' : ''}`}
    >
      {/* Compact header — icon on left, $ on right, theme + count below */}
      <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-start justify-between gap-2">
          <div className={`rounded-lg p-1.5 flex-shrink-0 ${bucket.accentBg}`}>
            <Icon className={`h-3.5 w-3.5 ${bucket.accentText}`} />
          </div>
          <p
            className={`text-base font-bold leading-tight ${isEmpty ? 'text-gray-400 dark:text-gray-600' : bucket.accentText}`}
          >
            {isEmpty ? '—' : formatMoney(bucket.total, currency)}
          </p>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {bucket.label}
          </h3>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${bucket.accentBg} ${bucket.accentText} flex-shrink-0`}>
            {bucket.items.length}
          </span>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex-1 px-3 py-3 text-[11px] text-gray-500 dark:text-gray-400 italic">
          No findings.
        </div>
      ) : (
        <div className="flex-1 px-1.5 py-1.5 space-y-0.5">
          {visible.map((f) => (
            <FindingRow key={f.id} finding={f} orgId={orgId} currency={currency} compact onHide={onHide} />
          ))}
          {hidden > 0 && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="w-full text-left text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 transition-colors"
            >
              + {hidden} more →
            </button>
          )}
          {expanded && hidden > 0 && (
            <button
              onClick={() => setExpanded(false)}
              className="w-full text-left text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 transition-colors"
            >
              ↑ Show fewer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FindingRow({
  finding,
  orgId,
  currency,
  compact,
  onHide,
}: {
  finding: { id: string; detector_id: string; title: string; gap_usd: number };
  orgId: string;
  currency: string;
  compact?: boolean;
  /** Called after a successful hide so the parent can drop the row. */
  onHide?: (findingId: string) => void;
}) {
  const [hiding, setHiding] = useState(false);
  const effort = getDetectorEffort(finding.detector_id);
  const effortMeta = EFFORT_META[effort];

  async function handleHide(e: React.MouseEvent) {
    // The row is wrapped in an <a> — stop the navigation before firing
    // the POST or the user jumps to the detail page mid-action.
    e.preventDefault();
    e.stopPropagation();
    if (hiding) return;
    setHiding(true);
    try {
      const r = await fetch(`/api/forensic-findings/${finding.id}/hide`, { method: 'POST' });
      if (r.ok) onHide?.(finding.id);
    } finally {
      setHiding(false);
    }
  }

  return (
    <a
      href={`/orgs/${orgId}/forensics/${finding.id}`}
      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-green-200 dark:border-green-800/40 bg-green-50/40 dark:bg-green-900/10 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors group ${
        compact ? 'border-transparent bg-transparent dark:bg-transparent hover:bg-white/40 dark:hover:bg-gray-800/30' : ''
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {!compact && (
          <code className="text-[11px] font-mono text-green-700 dark:text-green-400 flex-shrink-0">
            {finding.detector_id}
          </code>
        )}
        <span className={`text-sm text-gray-800 dark:text-gray-200 truncate ${compact ? 'text-xs' : ''}`}>
          {finding.title}
        </span>
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset flex-shrink-0 ${effortMeta.bg} ${effortMeta.text} ${effortMeta.ring}`}
          title={`${effortMeta.label} — heuristic estimate of how much work to fix`}
        >
          {effort}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`font-mono font-semibold text-green-700 dark:text-green-300 ${compact ? 'text-xs' : ''}`}>
          {formatMoney(finding.gap_usd, currency)}
        </span>
        {onHide && (
          <button
            onClick={handleHide}
            disabled={hiding}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
            title="Hide this finding (you can restore it later)"
            aria-label="Hide finding"
          >
            <EyeOff className="h-3.5 w-3.5 text-gray-500" />
          </button>
        )}
      </div>
    </a>
  );
}
