'use client';

import { getCategoryLabel } from '@/lib/utils';
import { DollarSign, Percent, Package, GitBranch, Settings, RefreshCw, FileText, Handshake, Variable, ShieldCheck, Code, FileSpreadsheet, SlidersHorizontal, Compass, Layers, Gauge, Network } from 'lucide-react';
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
  summary_variables: Variable,
  approval_rules: ShieldCheck,
  quote_calculator_plugin: Code,
  quote_templates: FileSpreadsheet,
  configuration_attributes: SlidersHorizontal,
  guided_selling: Compass,
  advanced_pricing: Layers,
  performance: Gauge,
  impact_analysis: Network,
};

interface CategoryBreakdownProps {
  scores: CategoryScores;
  issues?: { category: string; severity: string }[];
  layout?: 'vertical' | 'horizontal';
}

export function CategoryBreakdown({ scores, issues = [], layout = 'vertical' }: CategoryBreakdownProps) {
  const entries = Object.entries(scores as unknown as Record<string, number>)
    .sort(([, a], [, b]) => a - b);

  function getBarColor(score: number): string {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-amber-500';
    return 'bg-red-500';
  }

  function getScoreTextColor(score: number): string {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-amber-600';
    return 'text-red-600';
  }

  function getCategoryCounts(category: string) {
    const catIssues = issues.filter((i) => i.category === category);
    const critical = catIssues.filter((i) => i.severity === 'critical').length;
    const warning = catIssues.filter((i) => i.severity === 'warning').length;
    return { critical, warning };
  }

  if (layout === 'horizontal') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {entries.map(([category, score]) => {
          const { critical, warning } = getCategoryCounts(category);
          return (
            <div
              key={category}
              className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">
                  {getCategoryLabel(category)}
                </span>
                <span className={`text-lg font-bold ${getScoreTextColor(score)}`}>
                  {score}%
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${getBarColor(score)} transition-all duration-700`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {critical > 0 || warning > 0
                  ? `${critical} critical, ${warning} warning${warning !== 1 ? 's' : ''}`
                  : 'No issues'}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map(([category, score]) => {
        const Icon = categoryIcons[category] || FileText;
        return (
          <div key={category}>
            <div className="flex justify-between items-center mb-1.5">
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">
                  {getCategoryLabel(category)}
                </span>
              </div>
              <span className={`text-sm font-bold ${getScoreTextColor(score)}`}>
                {score}/100
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full ${getBarColor(score)} transition-all duration-1000 ease-out`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
