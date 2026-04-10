'use client';

import { Layers, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { ComplexityBreakdown } from '@/types';

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
  const [expanded, setExpanded] = useState(false);
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
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">CPQ Complexity Score</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Benchmarked against healthy org thresholds</p>
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
            .map((factor) => (
              <div key={factor.label} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-44 truncate">{factor.label}</span>
                <span className="text-xs font-medium text-gray-900 w-10 text-right">{factor.count}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-purple-400"
                    style={{ width: `${Math.min((factor.contribution / 20) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-400 w-8 text-right">+{factor.contribution}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
