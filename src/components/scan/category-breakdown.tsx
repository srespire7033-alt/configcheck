'use client';

import { getCategoryLabel } from '@/lib/utils';
import { DollarSign, Percent, Package, GitBranch, Settings, RefreshCw, FileText, Handshake } from 'lucide-react';
import type { CategoryScores } from '@/types';

const categoryIcons: Record<string, React.ElementType> = {
  price_rules: DollarSign,
  discount_schedules: Percent,
  products: Package,
  product_rules: GitBranch,
  cpq_settings: Settings,
  subscriptions: RefreshCw,
  quote_lines: FileText,
  contracted_prices: Handshake,
};

interface CategoryBreakdownProps {
  scores: CategoryScores;
}

export function CategoryBreakdown({ scores }: CategoryBreakdownProps) {
  const entries = Object.entries(scores as unknown as Record<string, number>)
    .sort(([, a], [, b]) => a - b); // Worst first

  function getBarGradient(score: number): string {
    if (score >= 80) return 'from-emerald-400 to-emerald-500';
    if (score >= 60) return 'from-yellow-400 to-amber-500';
    return 'from-red-400 to-red-500';
  }

  return (
    <div className="space-y-4">
      {entries.map(([category, score]) => {
        const Icon = categoryIcons[category] || FileText;
        return (
          <div key={category} className="group">
            <div className="flex justify-between items-center mb-1.5">
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">
                  {getCategoryLabel(category)}
                </span>
              </div>
              <span className={`text-sm font-bold ${
                score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-600'
              }`}>
                {score}/100
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${getBarGradient(score)} transition-all duration-1000 ease-out`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
