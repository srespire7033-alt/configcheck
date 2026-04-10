'use client';

import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
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
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-shrink-0">
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
