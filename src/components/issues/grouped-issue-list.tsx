'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { IssueCard } from './issue-card';
import type { DBIssue } from '@/types';

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
export function GroupedIssueList({
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

        // Multiple occurrences: collapsible group.
        const isOpen = expanded[checkId] ?? false; // collapsed by default
        const fixedCount = group.filter((i) => i.status === 'resolved').length;
        const severity = group[0].severity;
        const sevDot =
          severity === 'critical'
            ? 'bg-red-500'
            : severity === 'warning'
            ? 'bg-amber-500'
            : 'bg-blue-500';
        const sevPillCls =
          severity === 'critical'
            ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
            : severity === 'warning'
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';

        return (
          <div key={checkId} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
            {/* Group header — click to expand/collapse */}
            <button
              onClick={() => toggle(checkId)}
              className="w-full text-left px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition flex items-center gap-3"
            >
              {isOpen ? (
                <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
              )}
              <span className={`w-2 h-2 rounded-full ${sevDot} flex-shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {checkLabel(group)}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-mono font-medium rounded ${sevPillCls}`}
                  >
                    {checkId}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {group.length} occurrence{group.length !== 1 ? 's' : ''}
                    {fixedCount > 0 && ` • ${fixedCount} fixed`}
                  </span>
                </div>
              </div>
            </button>

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
