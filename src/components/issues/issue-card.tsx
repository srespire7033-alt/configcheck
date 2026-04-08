'use client';

import { AlertCircle, AlertTriangle, Info, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getCategoryLabel } from '@/lib/utils';
import type { DBIssue } from '@/types';

interface IssueCardProps {
  issue: DBIssue;
  onClick: () => void;
}

const severityConfig = {
  critical: {
    icon: AlertCircle,
    iconColor: 'text-red-500',
    bgColor: 'bg-red-50',
    borderColor: 'border-l-red-500',
    label: 'Critical',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-l-amber-500',
    label: 'Warning',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-500',
    bgColor: 'bg-blue-50',
    borderColor: 'border-l-blue-500',
    label: 'Info',
  },
};

export function IssueCard({ issue, onClick }: IssueCardProps) {
  const config = severityConfig[issue.severity] || severityConfig.info;
  const Icon = config.icon;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-xl border border-gray-200 border-l-4 ${config.borderColor} hover:shadow-md hover:border-gray-300 transition-all duration-200 p-4 group`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`p-1.5 ${config.bgColor} rounded-lg flex-shrink-0 mt-0.5`}>
          <Icon className={`h-4 w-4 ${config.iconColor}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
              {issue.check_id}
            </span>
            <Badge variant={issue.severity}>{config.label}</Badge>
            <Badge>{getCategoryLabel(issue.category)}</Badge>
            {issue.status !== 'open' && (
              <Badge variant={issue.status === 'resolved' ? 'success' : 'default'}>
                {issue.status}
              </Badge>
            )}
          </div>
          <h4 className="text-sm font-semibold text-gray-900 mb-1 group-hover:text-blue-700 transition-colors">
            {issue.title}
          </h4>
          <p className="text-sm text-gray-500 line-clamp-2">{issue.description}</p>
        </div>

        {/* Arrow */}
        <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-blue-500 flex-shrink-0 mt-1 transition-colors" />
      </div>
    </button>
  );
}
