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

import { useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Sparkles, Info } from 'lucide-react';
import { getDetectorEffort, type EffortLevel } from '@/lib/forensics/types';

interface Finding {
  id: string;
  detector_id: string;
  gap_usd: number;
}

interface Props {
  findings: Finding[];
  currency?: string;
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
}

export function ImpactEffortMatrix({ findings, currency = 'USD' }: Props) {
  // Bucket every finding into one of the 9 cells. Memoized because the
  // org page re-renders frequently during scan-streaming and recomputing
  // a 1000-row reduce on each render adds up.
  const matrix = useMemo(() => {
    const buckets: Record<string, Cell> = {};
    let totalFindings = 0;
    let totalUsd = 0;

    for (const f of findings) {
      const impact = bucketImpact(f.gap_usd);
      const effort: EffortLevel = getDetectorEffort(f.detector_id);
      const key = `${impact}-${effort}`;
      const cell = buckets[key] ?? { count: 0, totalUsd: 0 };
      cell.count += 1;
      cell.totalUsd += f.gap_usd;
      buckets[key] = cell;
      totalFindings += 1;
      totalUsd += f.gap_usd;
    }

    return { buckets, totalFindings, totalUsd };
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
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
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
                <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">High</p>
                <p className="text-[9px] text-gray-500 dark:text-gray-400">≥{formatMoney(IMPACT_HIGH_THRESHOLD, currency)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Medium</p>
                <p className="text-[9px] text-gray-500 dark:text-gray-400">≥{formatMoney(IMPACT_LOW_THRESHOLD, currency)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Low</p>
                <p className="text-[9px] text-gray-500 dark:text-gray-400">&lt;{formatMoney(IMPACT_LOW_THRESHOLD, currency)}</p>
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
                  return (
                    <div
                      key={key}
                      className={`relative rounded-lg p-3 min-h-[80px] flex flex-col justify-between ${meta.bg} ${meta.ring} ${isEmpty ? 'opacity-40' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className={`text-[10px] font-semibold uppercase tracking-wider ${meta.text}`}>
                          {meta.label}
                        </p>
                        {meta.highlight && !isEmpty && (
                          <Sparkles className="h-3 w-3 text-emerald-500 dark:text-emerald-400 flex-shrink-0" />
                        )}
                      </div>
                      <div>
                        <p className={`text-2xl font-bold leading-none ${meta.text}`}>{count}</p>
                        <p className={`text-[11px] font-mono mt-1 ${meta.text} opacity-80`}>
                          {isEmpty ? '—' : formatMoney(total, currency)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {/* X-axis labels under the grid */}
            <div className="grid grid-cols-3 gap-2 mt-2">
              {EFFORT_ORDER.map((effort) => (
                <p key={effort} className="text-center text-[11px] font-semibold text-gray-700 dark:text-gray-300 capitalize">
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
            Effort is a heuristic per detector. {matrix.totalFindings} total finding{matrix.totalFindings === 1 ? '' : 's'}, {formatMoney(matrix.totalUsd, currency)} verified.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
