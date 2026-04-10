'use client';

import { getCategoryLabel } from '@/lib/utils';
import { DollarSign, Percent, Package, GitBranch, Settings, RefreshCw, FileText, Handshake, Variable, ShieldCheck, Code, FileSpreadsheet, SlidersHorizontal, Compass, Layers, Gauge, Network, ChevronRight } from 'lucide-react';
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
  selectedCategory?: string | null;
  onCategoryClick?: (category: string) => void;
}

export function CategoryBreakdown({ scores, issues = [], layout = 'vertical', selectedCategory, onCategoryClick }: CategoryBreakdownProps) {
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
    const info = catIssues.filter((i) => i.severity === 'info').length;
    return { critical, warning, info, total: critical + warning + info };
  }

  if (layout === 'horizontal') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {entries.map(([category, score]) => {
          const { critical, warning, total } = getCategoryCounts(category);
          const isSelected = selectedCategory === category;
          const Icon = categoryIcons[category] || FileText;
          return (
            <button
              key={category}
              onClick={() => onCategoryClick?.(category)}
              className={`text-left bg-white dark:bg-[#111827] rounded-xl p-5 border shadow-sm transition-all duration-200 ${
                isSelected
                  ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/20 dark:ring-blue-400/20'
                  : 'border-gray-100 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${isSelected ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`} />
                  <span className={`text-sm font-medium ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}>
                    {getCategoryLabel(category)}
                  </span>
                </div>
                <span className={`text-lg font-bold ${getScoreTextColor(score)}`}>
                  {score}%
                </span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${getBarColor(score)} transition-all duration-700`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {total === 0
                    ? 'No issues'
                    : critical > 0
                    ? `${critical} critical, ${warning} warning${warning !== 1 ? 's' : ''}`
                    : `${warning} warning${warning !== 1 ? 's' : ''}`}
                </p>
                <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  isSelected ? 'text-blue-500 rotate-90' : 'text-gray-300 dark:text-gray-600'
                }`} />
              </div>
            </button>
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
                <Icon className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {getCategoryLabel(category)}
                </span>
              </div>
              <span className={`text-sm font-bold ${getScoreTextColor(score)}`}>
                {score}/100
              </span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
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
