'use client';

import { useState } from 'react';
import { TrendingDown, Info, ChevronDown, ChevronUp, AlertCircle, Sparkles, Network, ChevronRight, ShieldCheck, FileDown } from 'lucide-react';
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
 * Theme groupings for the verified-findings tabs. Each tab tells one
 * coherent story a consultant can lead a conversation around. 'all'
 * is the default catch-all and shows every revenue-leakage finding.
 *
 * Keep in sync with DETECTOR_CATEGORY in lib/forensics/types.ts — every
 * revenue_leakage detector ID should appear in exactly one theme group.
 */
const FINDING_THEMES: ReadonlyArray<{ key: string; label: string; detectorIds: ReadonlyArray<string> }> = [
  { key: 'all', label: 'All', detectorIds: [] }, // empty = include everything
  { key: 'renewals', label: 'Renewals', detectorIds: ['REN-001', 'REN-002'] },
  { key: 'discounting', label: 'Discounting', detectorIds: ['DSC-FOR-001', 'DSC-FOR-002', 'QL-FOR-001'] },
  { key: 'orders', label: 'Orders & Billing', detectorIds: ['ORD-FOR-001', 'ORD-FOR-002', 'ORD-FOR-003', 'AST-FOR-001'] },
  { key: 'subs', label: 'Subscriptions', detectorIds: ['SUB-FOR-001', 'PROV-FOR-001', 'PROV-FOR-002'] },
  { key: 'pricing', label: 'Pricing Locks', detectorIds: ['CT-FOR-001', 'MDQ-FOR-001'] },
] as const;

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
  const FLAT_THRESHOLD = 5;
  const [expandedDetectors, setExpandedDetectors] = useState<Set<string>>(new Set());
  const [activeTheme, setActiveTheme] = useState<string>('all');

  // Compute per-theme counts + totals from the ENTIRE finding set —
  // these populate the tab badges regardless of which tab is active.
  // Findings whose detector_id isn't in any theme still appear in 'All'
  // (back-compat for any future detector we forget to classify here).
  const themeStats = FINDING_THEMES.map((theme) => {
    const matched = theme.key === 'all'
      ? findings
      : findings.filter((f) => theme.detectorIds.includes(f.detector_id));
    return {
      ...theme,
      count: matched.length,
      total: matched.reduce((s, f) => s + f.gap_usd, 0),
    };
  });
  const activeThemeStats = themeStats.find((t) => t.key === activeTheme) ?? themeStats[0];
  const themeMatched = activeTheme === 'all'
    ? findings
    : findings.filter((f) => (FINDING_THEMES.find((t) => t.key === activeTheme)?.detectorIds ?? []).includes(f.detector_id));

  const verifiedTotalUsd = themeMatched.reduce((sum, f) => sum + f.gap_usd, 0);
  const headerLabel = activeTheme === 'all'
    ? findings.length < totalCount
      ? `✓ Top ${findings.length} of ${totalCount} verified findings`
      : `✓ Verified findings (${totalCount})`
    : `✓ ${activeThemeStats.label} (${themeMatched.length})`;

  // Tab strip — render only when there's enough cross-theme variety
  // that filtering is useful. If 4 or fewer findings total, just show
  // the flat list (the tabs would feel like dead weight).
  const tabsWorthShowing = findings.length > FLAT_THRESHOLD &&
    themeStats.filter((t) => t.key !== 'all' && t.count > 0).length >= 2;
  const tabStrip = tabsWorthShowing ? (
    <div className="mb-3 -mx-1 px-1 flex gap-1 overflow-x-auto pb-0.5">
      {themeStats
        .filter((t) => t.key === 'all' || t.count > 0)
        .map((t) => {
          const active = t.key === activeTheme;
          return (
            <button
              key={t.key}
              onClick={() => {
                setActiveTheme(t.key);
                // Collapse all expanded detector groups when changing
                // tab so the new view starts clean.
                setExpandedDetectors(new Set());
              }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'bg-green-600 dark:bg-green-700 text-white border-green-600 dark:border-green-700'
                  : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-green-400 dark:hover:border-green-600'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 ${active ? 'opacity-80' : 'text-gray-400 dark:text-gray-500'}`}>
                ({t.count})
              </span>
            </button>
          );
        })}
    </div>
  ) : null;

  // Flat list for small N — keeps simple cases simple.
  if (themeMatched.length <= FLAT_THRESHOLD) {
    return (
      <div className="mb-5">
        {tabStrip}
        <p className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400 mb-2 flex items-center gap-1.5">
          {headerLabel}
        </p>
        {themeMatched.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-4 py-6 text-center text-xs text-gray-500 dark:text-gray-400">
            No {activeThemeStats.label.toLowerCase()} findings in this scan.
          </div>
        ) : (
          <div className="space-y-1.5">
            {themeMatched.map((f) => (
              <FindingRow key={f.id} finding={f} orgId={orgId} currency={currency} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Group by detector_id; sort groups by their total $ desc.
  const groups = new Map<string, typeof findings>();
  for (const f of themeMatched) {
    const list = groups.get(f.detector_id) ?? [];
    list.push(f);
    groups.set(f.detector_id, list);
  }
  const sortedGroups = Array.from(groups.entries())
    .map(([detectorId, items]) => ({
      detectorId,
      items: items.sort((a, b) => b.gap_usd - a.gap_usd),
      totalGap: items.reduce((sum, f) => sum + f.gap_usd, 0),
      // Use the first finding's title as a representative label —
      // findings in the same detector tend to share the same title shape.
      representativeTitle: items[0].title,
    }))
    .sort((a, b) => b.totalGap - a.totalGap);

  return (
    <div className="mb-5">
      {tabStrip}
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400 flex items-center gap-1.5">
          {headerLabel}
        </p>
        <span className="text-[11px] font-mono text-green-700 dark:text-green-400">
          {formatMoney(verifiedTotalUsd, currency)} total
        </span>
      </div>
      <div className="space-y-1.5">
        {sortedGroups.map((group) => {
          const isExpanded = expandedDetectors.has(group.detectorId);
          return (
            <div key={group.detectorId} className="rounded-lg border border-green-200 dark:border-green-800/40 bg-green-50/40 dark:bg-green-900/10">
              <button
                onClick={() => {
                  const next = new Set(expandedDetectors);
                  if (next.has(group.detectorId)) next.delete(group.detectorId);
                  else next.add(group.detectorId);
                  setExpandedDetectors(next);
                }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <code className="text-[11px] font-mono text-green-700 dark:text-green-400 flex-shrink-0">
                    {group.detectorId}
                  </code>
                  <span className="text-sm text-gray-800 dark:text-gray-200 truncate">
                    {group.representativeTitle}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0">
                    · {group.items.length} finding{group.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="font-mono font-semibold text-green-700 dark:text-green-300">
                    {formatMoney(group.totalGap, currency)}
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                  )}
                </div>
              </button>
              {isExpanded && (
                <div className="px-2 pb-2 pt-1 space-y-1 border-t border-green-100 dark:border-green-900/30">
                  {group.items.map((f) => (
                    <FindingRow key={f.id} finding={f} orgId={orgId} currency={currency} compact />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FindingRow({
  finding,
  orgId,
  currency,
  compact,
}: {
  finding: { id: string; detector_id: string; title: string; gap_usd: number };
  orgId: string;
  currency: string;
  compact?: boolean;
}) {
  return (
    <a
      href={`/orgs/${orgId}/forensics/${finding.id}`}
      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-green-200 dark:border-green-800/40 bg-green-50/40 dark:bg-green-900/10 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors ${
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
      </div>
      <span className={`font-mono font-semibold text-green-700 dark:text-green-300 flex-shrink-0 ${compact ? 'text-xs' : ''}`}>
        {formatMoney(finding.gap_usd, currency)}
      </span>
    </a>
  );
}
