'use client';

import { useState } from 'react';
import { X, AlertCircle, AlertTriangle, Info as InfoIcon, ChevronRight, ChevronDown } from 'lucide-react';
import { getCategoryLabel } from '@/lib/utils';
import type { DBIssue } from '@/types';

interface SeverityModalProps {
  severity: 'critical' | 'warning' | 'info';
  issues: DBIssue[];
  onClose: () => void;
  onIssueClick: (issue: DBIssue) => void;
}

const config = {
  critical: {
    label: 'Critical Issues',
    icon: AlertCircle,
    headerBg: 'bg-red-600',
    badgeBg: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
    accentBorder: 'border-l-red-500',
    dotColor: 'bg-red-500',
  },
  warning: {
    label: 'Warnings',
    icon: AlertTriangle,
    headerBg: 'bg-amber-500',
    badgeBg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    accentBorder: 'border-l-amber-500',
    dotColor: 'bg-amber-500',
  },
  info: {
    label: 'Best Practices',
    icon: InfoIcon,
    headerBg: 'bg-blue-600',
    badgeBg: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    accentBorder: 'border-l-blue-500',
    dotColor: 'bg-blue-500',
  },
};

export function SeverityModal({ severity, issues, onClose, onIssueClick }: SeverityModalProps) {
  const cfg = config[severity];
  const Icon = cfg.icon;
  // Tracks which check_id groups are expanded (key = `${category}|${check_id}`)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Two-level grouping: category → check_id → issues[]
  const grouped: Record<string, Record<string, DBIssue[]>> = {};
  for (const issue of issues) {
    const cat = issue.category;
    const checkId = issue.check_id;
    if (!grouped[cat]) grouped[cat] = {};
    if (!grouped[cat][checkId]) grouped[cat][checkId] = [];
    grouped[cat][checkId].push(issue);
  }
  const categories = Object.keys(grouped).sort();

  // Use the first issue's title as the friendly label for a check_id group
  // (titles can vary slightly per record but we want one human-readable header)
  const checkLabel = (checkIssues: DBIssue[]) => {
    const first = checkIssues[0];
    // Strip leading record-counts like "3 rules target the same field" so the
    // header stays consistent across the group. Match typical patterns:
    //   "X record(s) ..."  "X rule(s) ..."  "X quote line(s) ..."  etc.
    return first.title.replace(/^\d+\s+\S+\s+/, '').replace(/^"[^"]+"\s*/, '').trim() || first.title;
  };

  const isGroupExpanded = (cat: string, checkId: string, count: number) => {
    const key = `${cat}|${checkId}`;
    if (expanded[key] !== undefined) return expanded[key];
    // Default: expanded for single-issue groups, collapsed when there are 2+
    return count < 2;
  };

  const toggleGroup = (cat: string, checkId: string) => {
    const key = `${cat}|${checkId}`;
    setExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[80vh] flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className={`${cfg.headerBg} px-6 py-5 flex items-center justify-between flex-shrink-0`}>
          <div className="flex items-center gap-3">
            <Icon className="w-6 h-6 text-white" />
            <div>
              <h2 className="text-lg font-bold text-white">{cfg.label}</h2>
              <p className="text-sm text-white/80">{issues.length} issue{issues.length !== 1 ? 's' : ''} found across {categories.length} categor{categories.length !== 1 ? 'ies' : 'y'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Issue list */}
        <div className="flex-1 overflow-y-auto">
          {categories.map((cat) => {
            const checkIds = Object.keys(grouped[cat]).sort();
            const totalInCat = checkIds.reduce((sum, cid) => sum + grouped[cat][cid].length, 0);
            return (
              <div key={cat}>
                {/* Category header */}
                <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {getCategoryLabel(cat)} ({totalInCat})
                  </span>
                </div>

                {/* Per-check_id sub-groups */}
                {checkIds.map((checkId) => {
                  const checkIssues = grouped[cat][checkId];
                  const isMultiple = checkIssues.length > 1;
                  const isExpanded = isGroupExpanded(cat, checkId, checkIssues.length);

                  // Single-issue group: render the issue directly (no sub-header)
                  if (!isMultiple) {
                    const issue = checkIssues[0];
                    return (
                      <button
                        key={issue.id}
                        onClick={() => onIssueClick(issue)}
                        className="w-full text-left px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition flex items-start gap-4 group border-l-4 border-l-transparent hover:border-l-4 border-b border-gray-100 dark:border-gray-800"
                        style={{ borderLeftColor: 'transparent' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderLeftColor = severity === 'critical' ? '#ef4444' : severity === 'warning' ? '#f59e0b' : '#3b82f6';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderLeftColor = 'transparent';
                        }}
                      >
                        <span className={`w-2 h-2 rounded-full ${cfg.dotColor} mt-2 flex-shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                              {issue.title}
                            </p>
                            <span className={`px-1.5 py-0.5 ${cfg.badgeBg} text-[10px] font-mono font-medium rounded`}>
                              {issue.check_id}
                            </span>
                          </div>
                          {issue.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{issue.description}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1.5">
                            {issue.affected_records?.length ? (
                              <span className="text-xs text-gray-400 dark:text-gray-500">
                                {issue.affected_records.length} affected record{issue.affected_records.length !== 1 ? 's' : ''}
                              </span>
                            ) : null}
                            {issue.effort_hours ? (
                              <span className="text-xs text-gray-400 dark:text-gray-500">~{issue.effort_hours}h to fix</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 mt-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            issue.status === 'resolved'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                          }`}>
                            {issue.status === 'resolved' ? 'Fixed' : 'Open'}
                          </span>
                          <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition" />
                        </div>
                      </button>
                    );
                  }

                  // Multi-issue group: render a collapsible header with all issues nested below
                  const label = checkLabel(checkIssues);
                  const fixedCount = checkIssues.filter((i) => i.status === 'resolved').length;
                  return (
                    <div key={`${cat}|${checkId}`} className="border-b border-gray-100 dark:border-gray-800">
                      {/* Group header — clickable to expand/collapse */}
                      <button
                        onClick={() => toggleGroup(cat, checkId)}
                        className="w-full text-left px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition flex items-center gap-3 group"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        )}
                        <span className={`w-2 h-2 rounded-full ${cfg.dotColor} flex-shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                              {label}
                            </p>
                            <span className={`px-1.5 py-0.5 ${cfg.badgeBg} text-[10px] font-mono font-medium rounded`}>
                              {checkId}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {checkIssues.length} occurrence{checkIssues.length !== 1 ? 's' : ''}
                              {fixedCount > 0 && ` • ${fixedCount} fixed`}
                            </span>
                          </div>
                        </div>
                      </button>

                      {/* Nested issue rows */}
                      {isExpanded && (
                        <div className="bg-gray-50/50 dark:bg-gray-900/40">
                          {checkIssues.map((issue) => (
                            <button
                              key={issue.id}
                              onClick={() => onIssueClick(issue)}
                              className="w-full text-left pl-14 pr-6 py-3 hover:bg-gray-100 dark:hover:bg-gray-800/60 transition flex items-start gap-3 group border-t border-gray-100 dark:border-gray-800/60"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition line-clamp-2">
                                  {issue.title}
                                </p>
                                {issue.affected_records?.length ? (
                                  <span className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 inline-block">
                                    {issue.affected_records.length} record{issue.affected_records.length !== 1 ? 's' : ''}
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                  issue.status === 'resolved'
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                                }`}>
                                  {issue.status === 'resolved' ? 'Fixed' : 'Open'}
                                </span>
                                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition" />
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {issues.length === 0 && (
            <div className="px-6 py-16 text-center">
              <Icon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">No {cfg.label.toLowerCase()} found.</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Great job!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
