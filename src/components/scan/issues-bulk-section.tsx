'use client';

/**
 * IssuesBulkSection — flat list of (filtered) issues with checkboxes
 * and bulk-action affordances.
 *
 * Sits BELOW the Top Issues curated list on the Issues tab. Top
 * Issues shows the highest-priority 5; this section is the bulk-
 * work surface for selecting many and acknowledging / resolving /
 * marking-not-relevant in one click.
 *
 * No grouping logic — issues are listed flat in severity-then-impact
 * order. Filter state comes from the parent (drives both the Top
 * Issues block and this section), so narrowing by severity affects
 * what shows here too.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ClipboardList, CheckCircle2, EyeOff, ListChecks } from 'lucide-react';
import { BulkActionBar } from './bulk-action-bar';
import type { DBIssue } from '@/types';

interface Props {
  /** Already filtered upstream (search + severity + status). */
  issues: DBIssue[];
  orgId: string;
  onAfterUpdate?: () => void;
  onIssueClick?: (issue: DBIssue) => void;
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  warning: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  info: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
};

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
  acknowledged: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  resolved: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  ignored: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
  false_positive: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
  not_relevant: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
};

export function IssuesBulkSection({ issues, orgId, onAfterUpdate, onIssueClick }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [locallyUpdated, setLocallyUpdated] = useState<Map<string, string>>(new Map());

  if (issues.length === 0) return null;

  const visibleIds = issues.map((i) => i.id);
  const selectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkUpdate(ids: string[], status: string) {
    try {
      const r = await fetch('/api/issues/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds: ids, status }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Optimistic local update — show new status without waiting for
      // a full data refresh. Parent can also call onAfterUpdate to
      // re-fetch.
      setLocallyUpdated((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.set(id, status);
        return next;
      });
      setSelectedIds(new Set());
      onAfterUpdate?.();
    } catch (e) {
      console.error('[issues/bulk-update] failed', e);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <ListChecks className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">All issues</h3>
            <p className="text-base text-gray-500 dark:text-gray-400">
              Select multiple to acknowledge, resolve, or mark not relevant in one click.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <BulkActionBar
          selectedCount={selectedCount}
          totalVisible={visibleIds.length}
          allVisibleIds={visibleIds}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          actions={[
            {
              key: 'acknowledge',
              label: 'Acknowledge',
              icon: ClipboardList,
              variant: 'secondary',
              onClick: (ids) => bulkUpdate(ids, 'acknowledged'),
            },
            {
              key: 'resolve',
              label: 'Resolve',
              icon: CheckCircle2,
              variant: 'primary',
              onClick: (ids) => bulkUpdate(ids, 'resolved'),
            },
            {
              key: 'not_relevant',
              label: 'Mark not relevant',
              icon: EyeOff,
              variant: 'destructive',
              onClick: (ids) => bulkUpdate(ids, 'not_relevant'),
            },
          ]}
        />

        <div className="space-y-1">
          {issues.slice(0, 100).map((issue) => {
            const status = locallyUpdated.get(issue.id) ?? issue.status ?? 'open';
            const isSelected = selectedIds.has(issue.id);
            const sevClass = SEVERITY_BADGE[issue.severity] ?? SEVERITY_BADGE.info;
            const statusClass = STATUS_BADGE[status] ?? STATUS_BADGE.open;
            return (
              <div
                key={issue.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                  isSelected
                    ? 'border-blue-400 dark:border-blue-500 ring-2 ring-blue-400/30 bg-blue-50/30 dark:bg-blue-900/10'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                } transition-colors`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(issue.id)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0 cursor-pointer"
                  aria-label={`Select issue ${issue.title}`}
                />
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${sevClass} flex-shrink-0`}>
                  {issue.severity}
                </span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusClass} flex-shrink-0`}>
                  {status}
                </span>
                <button
                  type="button"
                  onClick={() => onIssueClick?.(issue)}
                  className="flex-1 min-w-0 text-left text-sm text-gray-800 dark:text-gray-200 truncate hover:underline"
                  title={issue.title}
                >
                  {issue.title}
                </button>
                <Link
                  href={`/orgs/${orgId}/issues/${issue.id}`}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
                >
                  View →
                </Link>
              </div>
            );
          })}
        </div>
        {issues.length > 100 && (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 text-center">
            Showing first 100 of {issues.length}. Use the filter bar above to narrow.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
