'use client';

/**
 * BulkActionBar — appears when consultants select multiple findings
 * in a review session. Lets them stage (queue for recovery) or hide
 * (dismiss as known-false-positive) the entire selection in one click.
 *
 * Sticky-feeling banner that slides in from the top of the findings
 * area when selection is non-empty. Borrows the Hubbl "bulk action"
 * pattern from their Recommendations table.
 *
 * UX choices:
 *   - Action buttons sit on the right (primary CTA pattern)
 *   - 'Select all visible' affordance on the left for quick mass
 *     selection without click-each
 *   - 'Clear' resets selection but stays focused on the page
 *   - Success toast is the caller's responsibility — this component
 *     just emits onAction events
 */

import { CheckSquare, EyeOff, Square, X, Loader2 } from 'lucide-react';
import { useState } from 'react';

interface Props {
  selectedCount: number;
  totalVisible: number;
  /** All findings currently visible (after filter). Used by 'Select all visible'. */
  allVisibleIds: string[];
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  /** Hits /api/forensic-findings/bulk-stage with the selected IDs. */
  onStage?: (ids: string[]) => Promise<void>;
  /** Hits /api/forensic-findings/bulk-hide with the selected IDs. */
  onHide?: (ids: string[]) => Promise<void>;
}

export function BulkActionBar({
  selectedCount,
  totalVisible,
  allVisibleIds,
  selectedIds,
  setSelectedIds,
  onStage,
  onHide,
}: Props) {
  const [pending, setPending] = useState<'stage' | 'hide' | null>(null);
  if (selectedCount === 0) return null;

  const allSelected = selectedCount === totalVisible && totalVisible > 0;

  function handleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allVisibleIds));
    }
  }

  async function handleStage() {
    if (!onStage || pending) return;
    setPending('stage');
    try {
      await onStage(Array.from(selectedIds));
    } finally {
      setPending(null);
    }
  }

  async function handleHide() {
    if (!onHide || pending) return;
    setPending('hide');
    try {
      await onHide(Array.from(selectedIds));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSelectAll}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-800 dark:text-blue-200 hover:text-blue-900 dark:hover:text-blue-100"
          title={allSelected ? 'Clear selection' : 'Select all visible findings'}
        >
          {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          {selectedCount} of {totalVisible} selected
        </button>
        <button
          type="button"
          onClick={() => setSelectedIds(new Set())}
          className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100"
        >
          <X className="h-3 w-3" /> Clear
        </button>
      </div>
      <div className="flex items-center gap-2">
        {onHide && (
          <button
            type="button"
            onClick={handleHide}
            disabled={pending !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {pending === 'hide' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            Hide {selectedCount}
          </button>
        )}
        {onStage && (
          <button
            type="button"
            onClick={handleStage}
            disabled={pending !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            {pending === 'stage' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckSquare className="h-3.5 w-3.5" />
            )}
            Stage {selectedCount} for recovery
          </button>
        )}
      </div>
    </div>
  );
}
