'use client';

import { getScoreBarColor, getCategoryLabel } from '@/lib/utils';
import type { CategoryScores } from '@/types';

interface CategoryBreakdownProps {
  scores: CategoryScores;
}

export function CategoryBreakdown({ scores }: CategoryBreakdownProps) {
  const entries = Object.entries(scores as unknown as Record<string, number>)
    .sort(([, a], [, b]) => a - b); // Worst first

  return (
    <div className="space-y-3">
      {entries.map(([category, score]) => (
        <div key={category}>
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium text-gray-700">
              {getCategoryLabel(category)}
            </span>
            <span className="text-sm font-semibold text-gray-900">{score}/100</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-700 ${getScoreBarColor(score)}`}
              style={{ width: `${score}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
