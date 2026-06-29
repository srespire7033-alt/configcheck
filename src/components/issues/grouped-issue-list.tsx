'use client';

import { memo, useState } from 'react';
import { ChevronRight, ChevronDown, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { IssueCard } from './issue-card';
import type { DBIssue } from '@/types';

const groupSeverityConfig = {
  critical: {
    icon: AlertCircle,
    iconColor: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/40',
    badgeBg: 'bg-red-100 dark:bg-red-900/40',
    badgeText: 'text-red-700 dark:text-red-300',
    countBg: 'bg-red-600 dark:bg-red-500',
    countText: 'text-white',
    leftBorder: 'border-l-4 border-l-red-500',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900/40',
    badgeBg: 'bg-amber-100 dark:bg-amber-900/40',
    badgeText: 'text-amber-700 dark:text-amber-300',
    countBg: 'bg-amber-500 dark:bg-amber-500',
    countText: 'text-white',
    leftBorder: 'border-l-4 border-l-amber-500',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/40',
    badgeBg: 'bg-blue-100 dark:bg-blue-900/40',
    badgeText: 'text-blue-700 dark:text-blue-300',
    countBg: 'bg-blue-600 dark:bg-blue-500',
    countText: 'text-white',
    leftBorder: 'border-l-4 border-l-blue-500',
  },
} as const;

function aggregateAffected(group: DBIssue[]): number {
  const ids = new Set<string>();
  let untrackedRecords = 0;
  for (const issue of group) {
    if (Array.isArray(issue.affected_records) && issue.affected_records.length > 0) {
      for (const r of issue.affected_records) {
        if (r && typeof (r as { id?: unknown }).id === 'string') {
          ids.add((r as { id: string }).id);
        } else {
          untrackedRecords += 1;
        }
      }
    }
  }
  return ids.size + untrackedRecords;
}

function aggregateRevenue(group: DBIssue[]): number {
  let total = 0;
  for (const issue of group) {
    if (typeof issue.revenue_impact === 'number' && issue.revenue_impact > 0) {
      total += issue.revenue_impact;
    }
  }
  return total;
}

function formatRevenue(value: number): string {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${Math.round(value)}`;
}

interface GroupedIssueListProps {
  issues: DBIssue[];
  onIssueClick: (issue: DBIssue) => void;
  onStatusChange: (issueId: string, status: string) => void;
  trustScores: Record<string, { total_feedback: number; trust_score: number | null }>;
}

/**
 * Renders a flat list of issues grouped by check_id.
 *
 * - Single-issue groups (one issue with that check_id) render as a normal IssueCard.
 * - Multi-issue groups (2+ issues sharing a check_id) collapse under a single header
 *   showing the check name, the check_id pill, and the occurrence count. Click the
 *   header to expand and see each underlying issue as its own IssueCard.
 *
 * This solves the noise problem where the same check (e.g. PR-002 "Price Rule with
 * no conditions") fires on 5 different rules and produces 5 visually identical
 * cards. Now they collapse into one row by default.
 */
function GroupedIssueListImpl({
  issues,
  onIssueClick,
  onStatusChange,
  trustScores,
}: GroupedIssueListProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Group issues by check_id, preserving original order of first appearance
  const groups: Record<string, DBIssue[]> = {};
  const groupOrder: string[] = [];
  for (const issue of issues) {
    if (!groups[issue.check_id]) {
      groups[issue.check_id] = [];
      groupOrder.push(issue.check_id);
    }
    groups[issue.check_id].push(issue);
  }

  // Use the first issue's title as the friendly label, stripping leading
  // record-counts ("3 rules target..." -> "rules target...") or the leading
  // quoted name ("Test Foo" is active...) so the header is consistent across
  // the group.
  const checkLabel = (group: DBIssue[]) => {
    const t = group[0].title;
    return t.replace(/^\d+\s+\S+\s+/, '').replace(/^"[^"]+"\s*/, '').trim() || t;
  };

  const toggle = (checkId: string) =>
    setExpanded((prev) => ({ ...prev, [checkId]: !(prev[checkId] ?? false) }));

  return (
    <>
      {groupOrder.map((checkId) => {
        const group = groups[checkId];
        const isMultiple = group.length > 1;

        // Single occurrence: render the issue card directly.
        if (!isMultiple) {
          const issue = group[0];
          return (
            <IssueCard
              key={issue.id}
              issue={issue}
              onClick={() => onIssueClick(issue)}
              onStatusChange={onStatusChange}
              trustScore={trustScores[issue.check_id]}
            />
          );
        }

        // Multiple occurrences: collapsible group with full IssueCard-equivalent visual weight.
        const isOpen = expanded[checkId] ?? false; // collapsed by default
        const fixedCount = group.filter((i) => i.status === 'resolved').length;
        const openCount = group.length - fixedCount;
        const allFixed = openCount === 0;
        const severity = group[0].severity;
        const config = groupSeverityConfig[severity] || groupSeverityConfig.info;
        const Icon = config.icon;
        const affectedTotal = aggregateAffected(group);
        const revenueTotal = aggregateRevenue(group);
        const description = group[0].description;

        const handleMarkAllFixed = (e: React.MouseEvent) => {
          e.stopPropagation();
          for (const issue of group) {
            if (issue.status !== 'resolved') onStatusChange(issue.id, 'resolved');
          }
        };

        return (
          <div
            key={checkId}
            className={`${config.leftBorder} border-b border-gray-100 dark:border-gray-800 last:border-b-0 ${allFixed ? 'opacity-60' : ''}`}
          >
            {/* Group header — visually equivalent to a single IssueCard */}
            <div
              onClick={() => toggle(checkId)}
              className="p-4 sm:p-6 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition cursor-pointer"
            >
              <div className="flex flex-col sm:flex-row items-start gap-4">
                {/* Icon + count stack */}
                <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                  <div className={`relative w-10 h-10 ${config.bgColor} rounded-xl flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${config.iconColor}`} />
                    <span
                      className={`absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 ${config.countBg} ${config.countText} text-[11px] font-bold rounded-full flex items-center justify-center ring-2 ring-white dark:ring-gray-900`}
                    >
                      {group.length}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <h4 className={`font-semibold ${allFixed ? 'text-gray-500 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-white'}`}>
                      {checkLabel(group)}
                    </h4>
                    <span className={`px-2 py-0.5 ${config.badgeBg} ${config.badgeText} text-xs font-medium rounded-full`}>
                      {checkId}
                    </span>
                    <span className={`px-2 py-0.5 ${config.badgeBg} ${config.badgeText} text-xs font-bold rounded-full`}>
                      {group.length}× occurrences
                    </span>
                    {fixedCount > 0 && (
                      <span className="px-2 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium rounded-full">
                        {fixedCount} fixed
                      </span>
                    )}
                  </div>
                  <p className="text-gray-600 dark:text-gray-400 mb-3 text-sm">
                    {description}
                  </p>
                  {(affectedTotal > 0 || revenueTotal > 0) && (
                    <div className="flex items-center gap-6 text-sm flex-wrap">
                      {affectedTotal > 0 && (
                        <span className="text-gray-500 dark:text-gray-400">
                          <strong className="text-gray-700 dark:text-gray-300">Impact:</strong>{' '}
                          {affectedTotal} record{affectedTotal !== 1 ? 's' : ''} affected across {group.length} finding{group.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {revenueTotal > 0 && (
                        <span className="text-red-600 font-medium">
                          Est. {formatRevenue(revenueTotal)} at risk
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-shrink-0 sm:ml-0 ml-14 items-center">
                  {!allFixed && (
                    <button
                      onClick={handleMarkAllFixed}
                      className="px-4 py-2 bg-green-50 text-green-600 rounded-lg text-sm font-medium hover:bg-green-100 transition"
                    >
                      Mark all fixed
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggle(checkId); }}
                    className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 transition inline-flex items-center gap-1.5"
                  >
                    {isOpen ? (
                      <>
                        <ChevronDown className="w-4 h-4" />
                        Hide {group.length}
                      </>
                    ) : (
                      <>
                        <ChevronRight className="w-4 h-4" />
                        View all {group.length}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Nested issue cards when expanded */}
            {isOpen && (
              <div className="bg-gray-50/40 dark:bg-gray-900/30 border-t border-gray-100 dark:border-gray-800/60">
                <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {group.map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      onClick={() => onIssueClick(issue)}
                      onStatusChange={onStatusChange}
                      trustScore={trustScores[issue.check_id]}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// React.memo + stable parent callbacks (useCallback) lets the dashboard
// skip re-rendering this subtree on every parent state change. The
// dashboard renders up to 3 of these side-by-side (Critical / Warning /
// Info per category modal) so the savings compound.
export const GroupedIssueList = memo(GroupedIssueListImpl);
