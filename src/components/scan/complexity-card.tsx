'use client';

import { Layers, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { ComplexityBreakdown } from '@/types';

// Industry benchmarks for a 'healthy' mid-market Salesforce CPQ org.
// These are educated estimates based on consultant experience (Maulik's
// Salesforce CPQ practice + Salesforce Well-Architected guidance).
// When a factor's count exceeds the benchmark, the bar's benchmark
// tick mark sits to the LEFT of the user's value — visually signaling
// 'you're above average here.' Below the benchmark = under-utilizing
// or just simpler than peers. Keyed by the factor label (case-sensitive
// — matches what the scan emits in metadata.complexity.factors[].label).
const FACTOR_BENCHMARKS: Record<string, number> = {
  // CPQ catalog complexity
  'Active Products': 50,
  'Product Options (Bundles)': 30,
  'Discount Schedules': 5,
  'Active Price Rules': 5,
  'Contracted Prices': 50,
  // Salesforce automation hygiene
  'Workflows': 5,
  'Process Builders': 5,
  'Process Builder': 5,
  'Flows': 25,
  'Triggers': 30,
  'Active Approval Processes': 3,
  // Catalog dimension
  'Standard Objects': 40,
  'Custom Objects': 30,
  'Custom Metadata': 5,
  'Custom Settings': 10,
};

interface Props {
  complexity: ComplexityBreakdown;
}

const ratingConfig = {
  'Low': { color: 'text-green-600', bg: 'bg-green-100', desc: 'Simple configuration, easy to maintain' },
  'Moderate': { color: 'text-blue-600', bg: 'bg-blue-100', desc: 'Standard complexity, manageable with good documentation' },
  'High': { color: 'text-amber-600', bg: 'bg-amber-100', desc: 'Complex setup, requires experienced CPQ admin' },
  'Very High': { color: 'text-red-600', bg: 'bg-red-100', desc: 'Very complex, high maintenance burden and risk' },
};

export function ComplexityCard({ complexity }: Props) {
  // Default expanded — the breakdown is the value of this card. Hiding it
  // behind a click meant most users never saw which factors were driving
  // the rating, which is exactly the diagnostic question the card answers.
  const [expanded, setExpanded] = useState(true);
  const config = ratingConfig[complexity.rating];

  // Gauge percentage (cap at 150 for visual)
  const gaugePercent = Math.min((complexity.totalScore / 150) * 100, 100);

  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
            <Layers className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">CPQ Complexity Score</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Compared to healthy Salesforce orgs of similar size</p>
          </div>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-bold ${config.bg} ${config.color}`}>
          {complexity.rating}
        </div>
      </div>

      {/* Score display */}
      <div className="mb-4">
        <div className="flex items-end gap-2 mb-2">
          <span className={`text-3xl font-bold ${config.color}`}>{complexity.totalScore}</span>
          <span className="text-sm text-gray-400 mb-1">points</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all bg-gradient-to-r from-green-400 via-amber-400 to-red-500"
            style={{ width: `${gaugePercent}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-gray-400">0 (Simple)</span>
          <span className="text-[10px] text-gray-400">150+ (Very Complex)</span>
        </div>
      </div>

      <p className="text-xs text-gray-500 mb-3">{config.desc}</p>

      {/* Toggle breakdown */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-700"
      >
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {expanded ? 'Hide' : 'Show'} breakdown
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {complexity.factors
            .filter((f) => f.count > 0)
            .sort((a, b) => b.contribution - a.contribution)
            .map((factor) => {
              const benchmark = FACTOR_BENCHMARKS[factor.label];
              // Scale: bar width is contribution / 20 capped at 100%. The
              // benchmark tick mark needs to land on the SAME scale so it's
              // visually meaningful next to the user's bar. We translate
              // 'benchmark count' to 'where that count would land on the
              // contribution scale' by interpolating against the user's
              // own count↔contribution ratio. Defensive: if the user has
              // zero count we skip (the .filter above already handles
              // this) so we never divide by zero.
              const userBarPct = Math.min((factor.contribution / 20) * 100, 100);
              const benchmarkPct =
                benchmark !== undefined
                  ? Math.min((benchmark / factor.count) * userBarPct, 100)
                  : null;
              const aboveBenchmark = benchmark !== undefined && factor.count > benchmark;
              return (
                <div key={factor.label} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 dark:text-gray-400 w-44 truncate">{factor.label}</span>
                  <span className="text-xs font-medium text-gray-900 dark:text-white w-10 text-right">{factor.count}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden relative">
                    <div
                      className="h-full rounded-full bg-purple-400"
                      style={{ width: `${userBarPct}%` }}
                    />
                    {/* Benchmark tick — small grey vertical line at the
                        position the industry-average count would occupy
                        on the same scale. Sits ABOVE the bar so it's
                        readable even when the user bar overlaps it. */}
                    {benchmarkPct !== null && (
                      <div
                        className="absolute top-0 h-full w-0.5 bg-gray-500 dark:bg-gray-400 pointer-events-none"
                        style={{ left: `${benchmarkPct}%` }}
                        title={`Benchmark: ${benchmark} (industry-average healthy org)`}
                      />
                    )}
                  </div>
                  <span
                    className={`text-[10px] w-8 text-right ${
                      aboveBenchmark ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-gray-400'
                    }`}
                    title={benchmark !== undefined ? `Industry benchmark: ${benchmark}` : 'No benchmark'}
                  >
                    +{factor.contribution}
                  </span>
                </div>
              );
            })}
          {/* Legend so users know what the grey tick means. */}
          <div className="flex items-center gap-3 pt-2 mt-1 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-3 rounded bg-purple-400" />
              <span className="text-[10px] text-gray-500 dark:text-gray-400">Your count</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-0.5 bg-gray-500 dark:bg-gray-400" />
              <span className="text-[10px] text-gray-500 dark:text-gray-400">Industry benchmark</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
