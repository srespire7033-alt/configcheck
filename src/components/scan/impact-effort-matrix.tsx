'use client';

/**
 * $-Impact × Effort matrix — the capstone competitive move against
 * metadata-only audit tools (Hubbl, Salto, Provar).
 *
 * Hubbl's diagnostic dashboard has a 3×3 severity×effort matrix that
 * lets a consultant glance at it and say "these are the quick wins to
 * pitch first." Smart pattern. But severity is a categorical guess
 * — 'how bad does this look' — not a number a CFO can act on.
 *
 * We replace the Y-axis with DOLLARS. Same shape, completely different
 * conversation:
 *
 *                 Low effort       Medium effort     High effort
 *   High $ ≥50K  [QUICK WINS ⭐]  [worth doing]      [strategic]
 *   Med $        [easy]            [standard]         [evaluate]
 *   Low $ <10K   [housekeeping]   [skip?]            [defer]
 *
 * The top-left cell is the consultant's pitch slide. The bottom-right
 * cell is the 'do not start an engagement here' warning. Cells in
 * between order by $/effort ratio.
 *
 * Effort comes from DETECTOR_EFFORT (heuristic per detector).
 * \$ buckets are absolute thresholds (not percentile) — 'is this
 * finding worth a consultant's time' is a real-world question, not a
 * relative one. A $5K finding is housekeeping whether it's 1 of 100 or
 * 1 of 5.
 *
 * Click any populated cell → scrolls to Revenue Leakage card. (We could
 * filter to that cell's findings in a future iteration; v1 just routes
 * the user's eye to where they can act.)
 */

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Sparkles, Info, X, ExternalLink, ChevronRight } from 'lucide-react';
import { getDetectorEffort, type EffortLevel } from '@/lib/forensics/types';

interface Finding {
  id: string;
  detector_id: string;
  gap_usd: number;
  // Optional — when present the click-to-drill modal shows it.
  // Older call sites that didn't pass title still work; modal just
  // falls back to the detector_id as the row label.
  title?: string;
}

interface Props {
  findings: Finding[];
  currency?: string;
  /** Org ID — when set, finding rows in the modal deep-link to the finding detail page. */
  orgId?: string;
}

type ImpactLevel = 'high' | 'medium' | 'low';

// Absolute \$ thresholds. Numbers chosen to land where consultant
// instinct already is: a $50K-recoverable finding warrants real client
// conversation; a <$10K finding is fold-into-cleanup work.
const IMPACT_HIGH_THRESHOLD = 50_000;
const IMPACT_LOW_THRESHOLD = 10_000;

function bucketImpact(gapUsd: number): ImpactLevel {
  if (gapUsd >= IMPACT_HIGH_THRESHOLD) return 'high';
  if (gapUsd >= IMPACT_LOW_THRESHOLD) return 'medium';
  return 'low';
}

// Effort → hours-per-finding heuristic. Lets consultants put a real
// hours number on each cell so the matrix doubles as a rough SOW
// estimator: 'Worth doing cell = \$8M opportunity, ~28 hrs to deliver.'
//
// Numbers are conservative averages from Maulik's CPQ consulting
// experience. A Low-effort finding is a 30-min Salesforce setting
// flip or 1 CSV row update. A Medium is per-record data correction
// with sign-off. High is code/schema work touching accounting.
//
// Cell hours = count × per-finding hours. So a cell with 14 medium-
// effort findings becomes 14 × 2 = 28 hours.
const EFFORT_HOURS_PER_FINDING: Record<EffortLevel, number> = {
  low: 0.5,
  medium: 2,
  high: 8,
};

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 10) return `${hours.toFixed(1)} hrs`;
  if (hours < 80) return `${Math.round(hours)} hrs`;
  // Above ~2 weeks of work, switch to days for readability.
  const days = hours / 8;
  return `${days.toFixed(0)} days`;
}

function formatMoney(amount: number, currency: string): string {
  if (amount >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${currency} ${(amount / 1_000).toFixed(0)}K`;
  if (amount < 1) return '—';
  return `${currency} ${Math.round(amount).toLocaleString()}`;
}

interface CellMeta {
  label: string;
  // Background tone — runs from emerald (top-left, the pitch slide)
  // through to slate (bottom-right, defer). Picked by hand so the eye
  // is drawn to the upper-left quadrant.
  bg: string;
  ring: string;
  text: string;
  highlight?: boolean; // adds the Sparkles icon
}

// Keyed by `${impact}-${effort}` — 9 cells.
const CELL_META: Record<string, CellMeta> = {
  'high-low': {
    label: 'Quick wins',
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    ring: 'ring-2 ring-emerald-400 dark:ring-emerald-500',
    text: 'text-emerald-800 dark:text-emerald-200',
    highlight: true,
  },
  'high-medium': {
    label: 'Worth doing',
    bg: 'bg-teal-50 dark:bg-teal-900/20',
    ring: 'ring-1 ring-teal-300 dark:ring-teal-700/40',
    text: 'text-teal-800 dark:text-teal-300',
  },
  'high-high': {
    label: 'Strategic',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    ring: 'ring-1 ring-blue-300 dark:ring-blue-700/40',
    text: 'text-blue-800 dark:text-blue-300',
  },
  'medium-low': {
    label: 'Easy',
    bg: 'bg-lime-50 dark:bg-lime-900/20',
    ring: 'ring-1 ring-lime-300 dark:ring-lime-700/40',
    text: 'text-lime-800 dark:text-lime-300',
  },
  'medium-medium': {
    label: 'Standard',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    ring: 'ring-1 ring-amber-300 dark:ring-amber-700/40',
    text: 'text-amber-800 dark:text-amber-300',
  },
  'medium-high': {
    label: 'Evaluate',
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    ring: 'ring-1 ring-orange-300 dark:ring-orange-700/40',
    text: 'text-orange-800 dark:text-orange-300',
  },
  'low-low': {
    label: 'Housekeeping',
    bg: 'bg-gray-50 dark:bg-gray-800/40',
    ring: 'ring-1 ring-gray-200 dark:ring-gray-700',
    text: 'text-gray-700 dark:text-gray-300',
  },
  'low-medium': {
    label: 'Skip?',
    bg: 'bg-gray-50 dark:bg-gray-800/40',
    ring: 'ring-1 ring-gray-200 dark:ring-gray-700',
    text: 'text-gray-600 dark:text-gray-400',
  },
  'low-high': {
    label: 'Defer',
    bg: 'bg-slate-50 dark:bg-slate-800/40',
    ring: 'ring-1 ring-slate-200 dark:ring-slate-700',
    text: 'text-slate-600 dark:text-slate-400',
  },
};

interface Cell {
  count: number;
  totalUsd: number;
  totalHours: number;
  findings: Finding[];
}

export function ImpactEffortMatrix({ findings, currency = 'USD', orgId }: Props) {
  // Click-to-drill modal state. When a cell is clicked, we open a
  // modal listing the findings in that cell — keeps the user on the
  // Summary tab instead of forcing a navigation away from the
  // strategic overview.
  const [openCell, setOpenCell] = useState<string | null>(null);

  // Bucket every finding into one of the 9 cells. Memoized because the
  // org page re-renders frequently during scan-streaming and recomputing
  // a 1000-row reduce on each render adds up. Now stores the FINDINGS
  // per cell too so the drill-down modal can list them without
  // re-iterating the parent array.
  const matrix = useMemo(() => {
    const buckets: Record<string, Cell> = {};
    let totalFindings = 0;
    let totalUsd = 0;

    for (const f of findings) {
      const impact = bucketImpact(f.gap_usd);
      const effort: EffortLevel = getDetectorEffort(f.detector_id);
      const key = `${impact}-${effort}`;
      const cell = buckets[key] ?? { count: 0, totalUsd: 0, totalHours: 0, findings: [] };
      cell.count += 1;
      cell.totalUsd += f.gap_usd;
      cell.totalHours += EFFORT_HOURS_PER_FINDING[effort];
      cell.findings.push(f);
      buckets[key] = cell;
      totalFindings += 1;
      totalUsd += f.gap_usd;
    }

    // Sort each cell's findings by gap desc so the modal lists the
    // biggest \$ contributors first.
    for (const key of Object.keys(buckets)) {
      buckets[key].findings.sort((a, b) => b.gap_usd - a.gap_usd);
    }

    const totalHours = Object.values(buckets).reduce((s, c) => s + c.totalHours, 0);
    return { buckets, totalFindings, totalUsd, totalHours };
  }, [findings]);

  if (matrix.totalFindings === 0) return null;

  const quickWins = matrix.buckets['high-low'];
  const hasQuickWins = quickWins && quickWins.count > 0;

  // Rows top-to-bottom: high \$, medium \$, low \$. Cols left-to-right:
  // low effort, medium effort, high effort. Reading order puts the eye
  // on the top-left (Quick Wins) first.
  const IMPACT_ORDER: ImpactLevel[] = ['high', 'medium', 'low'];
  const EFFORT_ORDER: EffortLevel[] = ['low', 'medium', 'high'];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-100 to-blue-100 dark:from-emerald-900/40 dark:to-blue-900/40 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                What to fix first
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Findings by dollar impact &times; effort to fix.{' '}
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                  Quick Wins
                </span>{' '}
                in the top-left are the pitch slide.
              </p>
            </div>
          </div>
          {hasQuickWins && (
            <div className="rounded-lg bg-emerald-100 dark:bg-emerald-900/30 px-3 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                Quick wins
              </p>
              <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
                {quickWins.count} finding{quickWins.count === 1 ? '' : 's'} · {formatMoney(quickWins.totalUsd, currency)}
              </p>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Grid — labels live on the gutters; the 3x3 inner grid is the cells. */}
        <div className="flex gap-2">
          {/* Y-axis label column */}
          <div className="flex flex-col justify-between py-2 text-right">
            <div className="flex flex-col items-end h-full justify-between">
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-200">High</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">≥{formatMoney(IMPACT_HIGH_THRESHOLD, currency)}</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-200">Medium</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">≥{formatMoney(IMPACT_LOW_THRESHOLD, currency)}</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-200">Low</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">&lt;{formatMoney(IMPACT_LOW_THRESHOLD, currency)}</p>
              </div>
            </div>
          </div>

          {/* The 3×3 cell grid */}
          <div className="flex-1">
            <div className="grid grid-cols-3 gap-2">
              {IMPACT_ORDER.flatMap((impact) =>
                EFFORT_ORDER.map((effort) => {
                  const key = `${impact}-${effort}`;
                  const cell = matrix.buckets[key];
                  const meta = CELL_META[key];
                  const count = cell?.count ?? 0;
                  const total = cell?.totalUsd ?? 0;
                  const isEmpty = count === 0;
                  // Empty cells are non-clickable — there's nothing to
                  // drill into, and a button with no payload would mislead.
                  const CellElement = isEmpty ? 'div' : 'button';
                  return (
                    <CellElement
                      key={key}
                      type={isEmpty ? undefined : 'button'}
                      onClick={isEmpty ? undefined : () => setOpenCell(key)}
                      className={`relative rounded-lg p-4 min-h-[110px] flex flex-col justify-between text-left w-full ${meta.bg} ${meta.ring} ${isEmpty ? 'opacity-50 cursor-default' : 'cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all'}`}
                      aria-label={isEmpty ? undefined : `Open ${meta.label} findings (${count} findings, ${formatMoney(total, currency)})`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className={`text-xs font-bold uppercase tracking-wider ${meta.text}`}>
                          {meta.label}
                        </p>
                        {meta.highlight && !isEmpty && (
                          <Sparkles className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400 flex-shrink-0" />
                        )}
                      </div>
                      <div>
                        <p className={`text-3xl font-bold leading-none ${meta.text}`}>{count}</p>
                        {!isEmpty ? (
                          <div className="mt-1.5 space-y-0.5">
                            <p className={`text-sm font-mono font-semibold ${meta.text}`}>
                              {formatMoney(total, currency)}
                            </p>
                            <p className={`text-xs font-medium ${meta.text} opacity-90`}>
                              ~{formatHours(cell.totalHours)}
                            </p>
                          </div>
                        ) : (
                          <p className={`text-sm font-mono mt-1.5 ${meta.text} opacity-60`}>—</p>
                        )}
                      </div>
                    </CellElement>
                  );
                })
              )}
            </div>
            {/* X-axis labels under the grid */}
            <div className="grid grid-cols-3 gap-2 mt-3">
              {EFFORT_ORDER.map((effort) => (
                <p key={effort} className="text-center text-sm font-bold text-gray-800 dark:text-gray-200 capitalize">
                  {effort} effort
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* Footer summary */}
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <Info className="h-3 w-3" />
            Click any cell to drill in. {matrix.totalFindings} total finding{matrix.totalFindings === 1 ? '' : 's'} &middot; {formatMoney(matrix.totalUsd, currency)} verified &middot; ~{formatHours(matrix.totalHours)} estimated work.
          </p>
        </div>
      </CardContent>

      {/* Drill-down modal — opens when a populated cell is clicked.
          Lists every finding in that cell sorted by \$ desc. Each row
          links out to the finding detail page (when orgId is provided).
          Closing options: × button, Esc key, click on backdrop. */}
      {openCell && (() => {
        const cell = matrix.buckets[openCell];
        const meta = CELL_META[openCell];
        if (!cell) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setOpenCell(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`${meta.label} findings`}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
              className="relative bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-2xl w-full max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className={`px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-4 rounded-t-2xl ${meta.bg}`}>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className={`text-[11px] font-semibold uppercase tracking-wider ${meta.text}`}>
                      {meta.label}
                    </p>
                    {meta.highlight && (
                      <Sparkles className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                    )}
                  </div>
                  <p className={`text-2xl font-bold leading-tight ${meta.text}`}>
                    {cell.count} finding{cell.count === 1 ? '' : 's'} · {formatMoney(cell.totalUsd, currency)}
                  </p>
                  <p className={`text-xs mt-1 ${meta.text} opacity-80`}>
                    ~{formatHours(cell.totalHours)} estimated work
                  </p>
                </div>
                <button
                  onClick={() => setOpenCell(null)}
                  className="p-1 rounded-lg hover:bg-white/40 dark:hover:bg-gray-800/40 transition-colors"
                  aria-label="Close"
                >
                  <X className={`h-5 w-5 ${meta.text}`} />
                </button>
              </div>

              {/* Modal body — scrollable list */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-1.5">
                  {cell.findings.map((f) => {
                    const label = f.title || f.detector_id;
                    const RowEl = orgId ? 'a' : 'div';
                    const props = orgId
                      ? {
                          href: `/orgs/${orgId}/forensics/${f.id}`,
                          className:
                            'flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-50/40 dark:hover:bg-emerald-900/10 transition-colors',
                        }
                      : {
                          className:
                            'flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700',
                        };
                    return (
                      <RowEl key={f.id} {...props}>
                        <div className="min-w-0 flex-1">
                          <code className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
                            {f.detector_id}
                          </code>
                          <p className="text-sm text-gray-800 dark:text-gray-200 truncate">
                            {label}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-sm font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                            {formatMoney(f.gap_usd, currency)}
                          </span>
                          {orgId && <ChevronRight className="h-4 w-4 text-gray-400" />}
                        </div>
                      </RowEl>
                    );
                  })}
                </div>
              </div>

              {/* Modal footer */}
              <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                <p>
                  <Info className="inline h-3 w-3 mr-1" />
                  Click a finding to open its detail page.
                </p>
                <button
                  onClick={() => setOpenCell(null)}
                  className="font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </Card>
  );
}
