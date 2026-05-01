'use client';

import { useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, History, ArrowRight, Minus } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import type { DBScan } from '@/types';

interface ScoreTrendProps {
  scans: DBScan[];
  onViewHistory: () => void;
}

interface TrendPoint {
  name: string;
  score: number;
  issues: number;
  critical: number;
  warning: number;
  scanIdx: number;
  scanId: string;
  completed_at: string | null;
  raw: DBScan;
}

/**
 * Interactive Score Trend chart.
 *
 * Improvements over the old static area chart:
 * - Hovering a point shows full diff vs. the previous scan (issues delta,
 *   criticals delta, warnings delta, raw counts) — not just the score.
 * - The selected baseline scan is highlighted on the chart, and the
 *   "Compare" pill shows {first}→{last} or {baseline}→{latest} delta.
 * - Click any dot to set it as the comparison baseline. The card then
 *   shows latest-vs-baseline numbers instead of latest-vs-previous.
 * - Best/worst scan markers callout the high and low watermarks so users
 *   can see at a glance whether the org is trending up or backsliding.
 */
export function ScoreTrend({ scans, onViewHistory }: ScoreTrendProps) {
  // Convert to oldest-first for the chart x-axis.
  const trendData = useMemo<TrendPoint[]>(() => {
    return scans
      .slice()
      .reverse()
      .map((s, idx) => ({
        name: new Date(s.completed_at || s.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        score: s.overall_score || 0,
        issues: s.total_issues || 0,
        critical: s.critical_count || 0,
        warning: s.warning_count || 0,
        scanIdx: idx + 1,
        scanId: s.id,
        completed_at: s.completed_at,
        raw: s,
      }));
  }, [scans]);

  // Default baseline: first scan (so "delta" reads as overall improvement
  // vs. when the org first connected). User can click a different dot.
  const [baselineId, setBaselineId] = useState<string>(trendData[0]?.scanId ?? '');

  const baseline = trendData.find((p) => p.scanId === baselineId) ?? trendData[0];
  const latest = trendData[trendData.length - 1];
  const previous = trendData.length >= 2 ? trendData[trendData.length - 2] : null;

  // Best/worst markers
  const bestScore = Math.max(...trendData.map((p) => p.score));
  const worstScore = Math.min(...trendData.map((p) => p.score));

  if (!baseline || !latest) return null;

  const scoreDelta = latest.score - baseline.score;
  const issuesDelta = latest.issues - baseline.issues;
  const criticalDelta = latest.critical - baseline.critical;

  // Previous-scan delta (for "since last scan" stat)
  const prevScoreDelta = previous ? latest.score - previous.score : 0;

  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-8">
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Score Trend</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Click any point to set it as the comparison baseline
            </p>
          </div>
        </div>
        <button
          onClick={onViewHistory}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 dark:text-gray-400 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-xl transition"
        >
          <History className="w-4 h-4" />
          View History
        </button>
      </div>

      {/* Compare strip — baseline -> latest */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <CompareTile
          label="Baseline"
          subLabel={baseline.name + (baseline === trendData[0] ? ' (first scan)' : '')}
          value={`${baseline.score}/100`}
          tone="muted"
        />
        <CompareTile
          label="Latest"
          subLabel={latest.name}
          value={`${latest.score}/100`}
          tone={
            scoreDelta > 0 ? 'good' : scoreDelta < 0 ? 'bad' : 'muted'
          }
          deltaIcon={
            scoreDelta > 0 ? TrendingUp : scoreDelta < 0 ? TrendingDown : Minus
          }
          deltaText={
            scoreDelta === 0
              ? 'no change'
              : `${scoreDelta > 0 ? '+' : ''}${scoreDelta} vs baseline`
          }
        />
        <CompareTile
          label="Issues delta"
          subLabel={`${baseline.issues} → ${latest.issues}`}
          value={
            issuesDelta === 0
              ? '0'
              : `${issuesDelta > 0 ? '+' : ''}${issuesDelta}`
          }
          tone={issuesDelta < 0 ? 'good' : issuesDelta > 0 ? 'bad' : 'muted'}
        />
        <CompareTile
          label="Critical delta"
          subLabel={`${baseline.critical} → ${latest.critical}`}
          value={
            criticalDelta === 0
              ? '0'
              : `${criticalDelta > 0 ? '+' : ''}${criticalDelta}`
          }
          tone={criticalDelta < 0 ? 'good' : criticalDelta > 0 ? 'bad' : 'muted'}
        />
      </div>

      {/* Since-last-scan callout — only shown when there are 2+ scans */}
      {previous && (
        <div className="mb-4 px-3 py-2 bg-gray-50 dark:bg-gray-900/40 rounded-lg flex items-center gap-2 text-xs">
          <span className="text-gray-500 dark:text-gray-400">Since last scan ({previous.name}):</span>
          <span
            className={`font-semibold ${
              prevScoreDelta > 0
                ? 'text-green-600'
                : prevScoreDelta < 0
                ? 'text-red-600'
                : 'text-gray-500'
            }`}
          >
            {prevScoreDelta === 0
              ? 'No score change'
              : `${prevScoreDelta > 0 ? '+' : ''}${prevScoreDelta} points`}
          </span>
          <ArrowRight className="w-3 h-3 text-gray-400" />
          <span className="text-gray-500 dark:text-gray-400">
            {latest.issues - previous.issues === 0
              ? 'same issue count'
              : `${latest.issues - previous.issues > 0 ? '+' : ''}${
                  latest.issues - previous.issues
                } issues`}
          </span>
        </div>
      )}

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={trendData}
            margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 12, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const point = payload[0].payload as TrendPoint;
                const idxInArr = trendData.findIndex(
                  (p) => p.scanId === point.scanId,
                );
                const prev = idxInArr > 0 ? trendData[idxInArr - 1] : null;
                const dScore = prev ? point.score - prev.score : 0;
                const dIssues = prev ? point.issues - prev.issues : 0;
                const dCrit = prev ? point.critical - prev.critical : 0;

                return (
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg p-3 text-xs min-w-[200px]">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100 dark:border-gray-800">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        Scan #{point.scanIdx} — {point.name}
                      </span>
                    </div>
                    <Row
                      label="Score"
                      value={`${point.score}/100`}
                      delta={prev ? dScore : null}
                      lowerIsBetter={false}
                    />
                    <Row
                      label="Issues"
                      value={point.issues}
                      delta={prev ? dIssues : null}
                      lowerIsBetter
                    />
                    <Row
                      label="Critical"
                      value={point.critical}
                      delta={prev ? dCrit : null}
                      lowerIsBetter
                    />
                    <Row
                      label="Warning"
                      value={point.warning}
                      delta={
                        prev ? point.warning - prev.warning : null
                      }
                      lowerIsBetter
                    />
                    {point.scanId !== baselineId && (
                      <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                        Click to set as baseline
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {/* Best/worst reference lines — only when meaningful spread */}
            {bestScore - worstScore >= 5 && (
              <>
                <ReferenceLine
                  y={bestScore}
                  stroke="#10b981"
                  strokeDasharray="4 4"
                  strokeOpacity={0.4}
                  label={{
                    value: `Best ${bestScore}`,
                    position: 'insideTopRight',
                    fill: '#10b981',
                    fontSize: 10,
                  }}
                />
                <ReferenceLine
                  y={worstScore}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  strokeOpacity={0.35}
                  label={{
                    value: `Low ${worstScore}`,
                    position: 'insideBottomRight',
                    fill: '#ef4444',
                    fontSize: 10,
                  }}
                />
              </>
            )}
            <Area
              type="monotone"
              dataKey="score"
              stroke="#3b82f6"
              strokeWidth={2.5}
              fill="url(#scoreGradient)"
              dot={(props) => {
                const { cx, cy, payload } = props as {
                  cx?: number;
                  cy?: number;
                  payload: TrendPoint;
                };
                const isBaseline = payload.scanId === baselineId;
                const isLatest = payload.scanId === latest.scanId;
                const isBest = payload.score === bestScore;
                const isWorst = payload.score === worstScore;
                const fill = isBaseline
                  ? '#6366f1'
                  : isBest
                  ? '#10b981'
                  : isWorst
                  ? '#ef4444'
                  : '#3b82f6';
                const r = isBaseline || isLatest ? 6 : 4;
                return (
                  <circle
                    key={payload.scanId}
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={fill}
                    stroke="#fff"
                    strokeWidth={2}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setBaselineId(payload.scanId)}
                  />
                );
              }}
              activeDot={{ r: 7 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend strip */}
      <div className="mt-3 flex items-center justify-center gap-4 text-[11px] text-gray-500 dark:text-gray-400 flex-wrap">
        <LegendDot color="#6366f1" label="Baseline" />
        <LegendDot color="#10b981" label="Best" />
        <LegendDot color="#ef4444" label="Low" />
        <LegendDot color="#3b82f6" label="Other scans" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

interface CompareTileProps {
  label: string;
  subLabel: string;
  value: string;
  tone: 'good' | 'bad' | 'muted';
  deltaIcon?: React.ElementType;
  deltaText?: string;
}

function CompareTile({
  label,
  subLabel,
  value,
  tone,
  deltaIcon: Icon,
  deltaText,
}: CompareTileProps) {
  const toneCls =
    tone === 'good'
      ? 'text-green-600 dark:text-green-400'
      : tone === 'bad'
      ? 'text-red-600 dark:text-red-400'
      : 'text-gray-700 dark:text-gray-300';
  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div className={`text-xl font-bold ${toneCls} mt-1`}>{value}</div>
      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
        {subLabel}
      </div>
      {deltaText && (
        <div
          className={`text-[11px] mt-1 inline-flex items-center gap-1 ${toneCls}`}
        >
          {Icon && <Icon className="w-3 h-3" />}
          {deltaText}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  delta,
  lowerIsBetter,
}: {
  label: string;
  value: string | number;
  delta: number | null;
  lowerIsBetter: boolean;
}) {
  const positive = delta !== null && delta > 0;
  const negative = delta !== null && delta < 0;
  const good = lowerIsBetter ? negative : positive;
  const bad = lowerIsBetter ? positive : negative;
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="font-semibold text-gray-900 dark:text-white">{value}</span>
        {delta !== null && delta !== 0 && (
          <span
            className={`text-[10px] font-medium ${
              good
                ? 'text-green-600'
                : bad
                ? 'text-red-600'
                : 'text-gray-500'
            }`}
          >
            ({delta > 0 ? '+' : ''}
            {delta})
          </span>
        )}
      </span>
    </div>
  );
}
