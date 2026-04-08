'use client';

import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getScoreColor, getScoreBgColor, formatTimeAgo } from '@/lib/utils';
import type { OrgCardData } from '@/types';

interface OrgCardProps {
  org: OrgCardData;
  onView: () => void;
  onScan: () => void;
  scanning?: boolean;
}

export function OrgCard({ org, onView, onScan, scanning = false }: OrgCardProps) {
  const hasScore = org.last_scan_score !== null;

  return (
    <Card hover className="flex flex-col" onClick={onView}>
      <CardContent className="flex-1">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{org.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              {org.is_sandbox ? (
                <Badge variant="warning">Sandbox</Badge>
              ) : (
                <Badge variant="info">Production</Badge>
              )}
              {org.connection_status === 'connected' ? (
                <Cloud className="h-4 w-4 text-green-500" />
              ) : (
                <CloudOff className="h-4 w-4 text-red-500" />
              )}
            </div>
          </div>

          {/* Score */}
          {hasScore && (
            <div className={`px-3 py-2 rounded-lg border ${getScoreBgColor(org.last_scan_score!)}`}>
              <span className={`text-2xl font-bold ${getScoreColor(org.last_scan_score!)}`}>
                {org.last_scan_score}
              </span>
              <span className="text-xs text-gray-500 block text-center">/100</span>
            </div>
          )}
        </div>

        {/* Stats */}
        {hasScore && org.critical_count > 0 && (
          <div className="mb-4">
            <Badge variant="critical">{org.critical_count} Critical</Badge>
          </div>
        )}

        {/* Last scan */}
        <p className="text-xs text-gray-400">
          {org.last_scan_at
            ? `Last scan: ${formatTimeAgo(org.last_scan_at)}`
            : 'Never scanned'}
        </p>
      </CardContent>

      {/* Actions */}
      <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 rounded-b-lg">
        <button
          onClick={(e) => { e.stopPropagation(); onView(); }}
          className="flex-1 text-sm font-medium text-blue-600 hover:text-blue-800 py-1"
        >
          View
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onScan(); }}
          disabled={scanning}
          className="flex-1 text-sm font-medium text-green-600 hover:text-green-800 py-1 flex items-center justify-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Scanning...' : 'Scan'}
        </button>
      </div>
    </Card>
  );
}
