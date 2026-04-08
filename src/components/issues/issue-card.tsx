'use client';

import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getSeverityBorderColor, getCategoryLabel } from '@/lib/utils';
import type { DBIssue } from '@/types';

interface IssueCardProps {
  issue: DBIssue;
  onClick: () => void;
}

const severityIcons = {
  critical: <AlertCircle className="h-5 w-5 text-red-500" />,
  warning: <AlertTriangle className="h-5 w-5 text-yellow-500" />,
  info: <Info className="h-5 w-5 text-blue-500" />,
};

export function IssueCard({ issue, onClick }: IssueCardProps) {
  return (
    <Card
      hover
      onClick={onClick}
      className={`border-l-4 ${getSeverityBorderColor(issue.severity)}`}
    >
      <CardContent>
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="mt-0.5 flex-shrink-0">
            {severityIcons[issue.severity]}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-gray-400">{issue.check_id}</span>
              <Badge variant={issue.severity}>{issue.severity}</Badge>
              <Badge>{getCategoryLabel(issue.category)}</Badge>
              {issue.status !== 'open' && (
                <Badge variant={issue.status === 'resolved' ? 'success' : 'default'}>
                  {issue.status}
                </Badge>
              )}
            </div>
            <h4 className="text-sm font-semibold text-gray-900 mb-1">{issue.title}</h4>
            <p className="text-sm text-gray-600 line-clamp-2">{issue.description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
