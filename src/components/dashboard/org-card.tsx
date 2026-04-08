'use client';

import { Cloud, RefreshCw, ArrowRight, AlertTriangle } from 'lucide-react';
import type { OrgCardData } from '@/types';
import { getScoreColor, formatTimeAgo } from '@/lib/utils';

interface OrgCardProps {
  org: OrgCardData;
  onView: () => void;
  onScan: () => void;
  scanning?: boolean;
}

export function OrgCard({ org, onView, onScan, scanning = false }: OrgCardProps) {
  return (
    <div className="group bg-white rounded-2xl border border-gray-200 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-50 transition-all duration-300 overflow-hidden">
      {/* Header */}
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-xl">
              <Cloud className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{org.name}</h3>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium mt-0.5 ${
                org.is_sandbox ? 'text-amber-600' : 'text-emerald-600'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  org.is_sandbox ? 'bg-amber-500' : 'bg-emerald-500'
                }`} />
                {org.is_sandbox ? 'Sandbox' : 'Production'}
              </span>
            </div>
          </div>

          {/* Score */}
          {org.last_scan_score !== null && (
            <div className="text-right">
              <div className={`text-2xl font-bold ${getScoreColor(org.last_scan_score)}`}>
                {org.last_scan_score}
              </div>
              <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">/100</div>
            </div>
          )}
        </div>

        {/* Stats */}
        {org.last_scan_at ? (
          <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
            <span>Last scan: {formatTimeAgo(org.last_scan_at)}</span>
            {org.critical_count > 0 && (
              <span className="flex items-center gap-1 text-red-600 font-medium">
                <AlertTriangle className="h-3 w-3" />
                {org.critical_count} critical
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 mb-4">No scans yet</p>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 pb-4 flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onScan(); }}
          disabled={scanning}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all disabled:opacity-50 shadow-sm shadow-blue-600/20"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Scanning...' : 'Run Scan'}
        </button>
        {org.last_scan_score !== null && (
          <button
            onClick={onView}
            className="flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
          >
            View
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
