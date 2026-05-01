'use client';

import { IndianRupee, AlertTriangle } from 'lucide-react';
import type { RevenueRiskSummary } from '@/types';

function formatIndianCurrency(value: number): string {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${Math.round(value)}`;
}

interface Props {
  summary: RevenueRiskSummary;
}

// What "low quote volume" means here. Below this threshold, percentage
// math becomes unstable (one ₹500 affected line on a ₹1,000 sample shows
// up as 50% — visually alarming, statistically meaningless). When the
// sample size is too small we hide the percentage and show a quieter
// "insufficient quote volume" hint instead.
const LOW_VOLUME_THRESHOLD_INR = 100_000; // ₹1L

export function RevenueRiskCard({ summary }: Props) {
  // Cap at 100% — risk can't logically exceed total. The old display
  // could show 131% when atRiskValue > totalQuoteValue (which can happen
  // when a single quote line counts toward both totals via different
  // checks); cap visually so the headline never reads as nonsensical.
  const rawPct = summary.totalQuoteValue > 0
    ? (summary.atRiskValue / summary.totalQuoteValue) * 100
    : 0;
  const riskPct = Math.min(100, Math.round(rawPct));
  const lowVolume = summary.totalQuoteValue < LOW_VOLUME_THRESHOLD_INR;

  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 bg-red-50 dark:bg-red-900/30 rounded-xl flex items-center justify-center">
          <IndianRupee className="w-5 h-5 text-red-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Revenue at Risk</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">Based on last 90 days quote volume</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Total Quote Volume</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{formatIndianCurrency(summary.totalQuoteValue)}</p>
          <p className="text-xs text-gray-400">{summary.totalQuotesAnalyzed} quotes analyzed</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Estimated at Risk</p>
          <p className="text-xl font-bold text-red-600">{formatIndianCurrency(summary.atRiskValue)}</p>
          <p className="text-xs text-gray-400">{summary.atRiskQuotes} quotes affected</p>
        </div>
      </div>

      {/* Risk bar — hidden when sample is too small to draw a defensible
          percentage from. */}
      {!lowVolume && summary.totalQuoteValue > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-500">Risk exposure</span>
            <span className={`text-xs font-bold ${riskPct > 15 ? 'text-red-600' : riskPct > 5 ? 'text-amber-600' : 'text-green-600'}`}>
              {riskPct}%
            </span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                riskPct > 15 ? 'bg-red-500' : riskPct > 5 ? 'bg-amber-500' : 'bg-green-500'
              }`}
              style={{ width: `${riskPct}%` }}
            />
          </div>
        </div>
      )}

      {lowVolume && summary.totalQuoteValue > 0 && (
        <div className="mt-2 flex items-start gap-2 p-3 bg-gray-50 dark:bg-gray-800/40 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Quote volume in the last 90 days is below ₹1L &mdash; too small to
            draw a meaningful risk percentage. Connect a higher-volume org or
            extend the analysis window.
          </p>
        </div>
      )}

      {!lowVolume && riskPct > 10 && (
        <div className="mt-4 flex items-start gap-2 p-3 bg-red-50 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">
            Configuration issues may be affecting {formatIndianCurrency(summary.atRiskValue)} in quote value. Review critical issues to reduce risk.
          </p>
        </div>
      )}
    </div>
  );
}
