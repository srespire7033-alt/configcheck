'use client';

import { useState } from 'react';
import { AlertCircle, AlertTriangle, Info, MessageCircle, X, Loader2 } from 'lucide-react';
import type { DBIssue } from '@/types';

interface IssueCardProps {
  issue: DBIssue;
  onClick: () => void;
}

const severityConfig = {
  critical: {
    icon: AlertCircle,
    iconColor: 'text-red-600',
    bgColor: 'bg-red-100',
    badgeBg: 'bg-red-100',
    badgeText: 'text-red-700',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-amber-600',
    bgColor: 'bg-amber-100',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-700',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-600',
    bgColor: 'bg-blue-100',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-700',
  },
};

export function IssueCard({ issue, onClick }: IssueCardProps) {
  const config = severityConfig[issue.severity] || severityConfig.info;
  const Icon = config.icon;
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

  async function handleExplain(e: React.MouseEvent) {
    e.stopPropagation();
    if (explanation) { setExplanation(null); return; }
    setExplaining(true);
    try {
      const res = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: issue.title,
          description: issue.description,
          impact: issue.impact,
          checkId: issue.check_id,
          category: issue.category,
          severity: issue.severity,
        }),
      });
      const data = await res.json();
      setExplanation(data.explanation || 'Unable to generate explanation.');
    } catch {
      setExplanation('Failed to generate explanation. Please try again.');
    } finally {
      setExplaining(false);
    }
  }

  return (
    <div className="p-6 hover:bg-gray-50 transition">
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={`w-10 h-10 ${config.bgColor} rounded-xl flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h4 className="font-semibold text-gray-900">{issue.title}</h4>
            <span className={`px-2 py-0.5 ${config.badgeBg} ${config.badgeText} text-xs font-medium rounded-full`}>
              {issue.check_id}
            </span>
          </div>
          <p className="text-gray-600 mb-3 text-sm">{issue.description}</p>
          {issue.affected_records && issue.affected_records.length > 0 && (
            <div className="flex items-center gap-6 text-sm">
              <span className="text-gray-500">
                📊 <strong className="text-gray-700">Impact:</strong> {issue.affected_records.length} record{issue.affected_records.length > 1 ? 's' : ''} affected
              </span>
            </div>
          )}

          {/* AI Explanation Panel */}
          {explanation && (
            <div className="mt-3 p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl border border-purple-100 relative">
              <button
                onClick={(e) => { e.stopPropagation(); setExplanation(null); }}
                className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
              <p className="text-xs font-semibold text-purple-700 mb-1.5">Plain English Explanation</p>
              <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{explanation}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={handleExplain}
            disabled={explaining}
            className="px-4 py-2 bg-purple-50 text-purple-600 rounded-lg text-sm font-medium hover:bg-purple-100 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            {explaining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
            {explanation ? 'Hide' : 'Explain'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 transition"
          >
            View Fix
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition"
          >
            Details
          </button>
        </div>
      </div>
    </div>
  );
}
