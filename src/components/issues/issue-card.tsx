'use client';

import { memo } from 'react';
import { AlertCircle, AlertTriangle, Info, CheckCircle2, EyeOff, ThumbsDown, Shield } from 'lucide-react';
import type { DBIssue } from '@/types';

interface TrustScore {
  total_feedback: number;
  trust_score: number | null;
}

interface IssueCardProps {
  issue: DBIssue;
  onClick: () => void;
  onStatusChange?: (issueId: string, status: string) => void;
  trustScore?: TrustScore;
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

function formatRevenue(value: number): string {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${Math.round(value)}`;
}

const statusConfig: Record<string, { label: string; bg: string; text: string; icon?: React.ElementType }> = {
  open: { label: 'Open', bg: 'bg-gray-100', text: 'text-gray-600' },
  acknowledged: { label: 'Acknowledged', bg: 'bg-blue-50', text: 'text-blue-600' },
  resolved: { label: 'Resolved', bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle2 },
  ignored: { label: 'Ignored', bg: 'bg-gray-50', text: 'text-gray-400', icon: EyeOff },
  false_positive: { label: 'False Positive', bg: 'bg-red-50', text: 'text-red-600', icon: ThumbsDown },
  not_relevant: { label: 'Not Relevant', bg: 'bg-gray-50', text: 'text-gray-500', icon: EyeOff },
};

function IssueCardImpl({ issue, onClick, onStatusChange, trustScore }: IssueCardProps) {
  const config = severityConfig[issue.severity] || severityConfig.info;
  const Icon = config.icon;
  const status = statusConfig[issue.status] || statusConfig.open;
  const isResolved = issue.status === 'resolved' || issue.status === 'ignored' ||
    issue.status === 'false_positive' || issue.status === 'not_relevant';
  // Trust score badge: only show when at least 3 users have given feedback (avoid noisy early signals)
  const showTrustScore = trustScore && trustScore.total_feedback >= 3 && trustScore.trust_score !== null;
  const trustScoreColor = showTrustScore && trustScore!.trust_score! >= 75
    ? 'text-emerald-700 bg-emerald-50'
    : showTrustScore && trustScore!.trust_score! >= 50
    ? 'text-amber-700 bg-amber-50'
    : 'text-gray-600 bg-gray-100';

  return (
    <div
      onClick={onClick}
      className={`p-4 sm:p-6 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition cursor-pointer ${isResolved ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-col sm:flex-row items-start gap-4">
        {/* Icon */}
        <div className={`w-10 h-10 ${config.bgColor} rounded-xl flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h4 className={`font-semibold ${isResolved ? 'text-gray-500 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-white'}`}>{issue.title}</h4>
            <span className={`px-2 py-0.5 ${config.badgeBg} ${config.badgeText} text-xs font-medium rounded-full`}>
              {issue.check_id}
            </span>
            {issue.status !== 'open' && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 ${status.bg} ${status.text} text-xs font-medium rounded-full`}>
                {status.icon && <status.icon className="w-3 h-3" />}
                {status.label}
              </span>
            )}
            {showTrustScore && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 ${trustScoreColor} text-xs font-medium rounded-full`}
                title={`${trustScore!.trust_score}% of users found this helpful (${trustScore!.total_feedback} feedback)`}
              >
                <Shield className="w-3 h-3" />
                {trustScore!.trust_score}% helpful
              </span>
            )}
          </div>
          <p className="text-gray-600 dark:text-gray-400 mb-3 text-sm">{issue.description}</p>
          {(issue.affected_records?.length > 0 || (issue.revenue_impact && issue.revenue_impact > 0)) && (
            <div className="flex items-center gap-6 text-sm">
              {issue.affected_records && issue.affected_records.length > 0 && (
                <span className="text-gray-500 dark:text-gray-400">
                  <strong className="text-gray-700 dark:text-gray-300">Impact:</strong> {issue.affected_records.length} record{issue.affected_records.length > 1 ? 's' : ''} affected
                </span>
              )}
              {issue.revenue_impact && issue.revenue_impact > 0 && (
                <span className="text-red-600 font-medium">
                  Est. {formatRevenue(issue.revenue_impact)} at risk
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-shrink-0 sm:ml-0 ml-14">
          {onStatusChange && !isResolved && (
            <button
              onClick={(e) => { e.stopPropagation(); onStatusChange(issue.id, 'resolved'); }}
              className="px-4 py-2 bg-green-50 text-green-600 rounded-lg text-sm font-medium hover:bg-green-100 transition"
            >
              Mark Fixed
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 transition"
          >
            Details
          </button>
        </div>
      </div>
    </div>
  );
}

// Memoized so the hundreds of card instances inside GroupedIssueList don't
// re-render when the parent re-renders for unrelated reasons.
export const IssueCard = memo(IssueCardImpl);
