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

import { CheckSquare, EyeOff, Square, X, Loader2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

/**
 * Optional custom action — overrides the default 'Stage / Hide' pair.
 * Used by the Issues tab to render Acknowledge / Resolve / Not relevant
 * instead of the forensic-findings actions.
 */
export interface BulkAction {
  key: string;
  label: string;
  icon?: LucideIcon;
  variant: 'primary' | 'secondary' | 'destructive';
  onClick: (ids: string[]) => Promise<void>;
}

interface Props {
  selectedCount: number;
  totalVisible: number;
  /** All items currently visible (after filter). Used by 'Select all visible'. */
  allVisibleIds: string[];
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  /** Default: hits /api/forensic-findings/bulk-stage with the selected IDs. Pass `actions` to override. */
  onStage?: (ids: string[]) => Promise<void>;
  /** Default: hits /api/forensic-findings/bulk-hide with the selected IDs. Pass `actions` to override. */
  onHide?: (ids: string[]) => Promise<void>;
  /** When provided, replaces the default Stage/Hide buttons with custom actions. */
  actions?: BulkAction[];
  /** Singular noun used in 'Stage N for recovery' (default 'finding'). */
  noun?: string;
}

export function BulkActionBar({
  selectedCount,
  totalVisible,
  allVisibleIds,
  selectedIds,
  setSelectedIds,
  onStage,
  onHide,
  actions,
  noun = 'finding',
}: Props) {
  const [pending, setPending] = useState<string | null>(null);
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

  async function handleCustomAction(action: BulkAction) {
    if (pending) return;
    setPending(action.key);
    try {
      await action.onClick(Array.from(selectedIds));
    } finally {
      setPending(null);
    }
  }

  // Variant class map — kept inline so the action style stays close
  // to where it's rendered.
  const variantClass: Record<BulkAction['variant'], string> = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary:
      'border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700',
    destructive:
      'bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200',
  };

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
      <div className="flex items-center gap-2 flex-wrap">
        {actions ? (
          // Custom-actions mode: render whatever the caller passes.
          actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => handleCustomAction(a)}
                disabled={pending !== null}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 ${variantClass[a.variant]}`}
              >
                {pending === a.key ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : Icon ? (
                  <Icon className="h-3.5 w-3.5" />
                ) : null}
                {a.label} {selectedCount}
              </button>
            );
          })
        ) : (
          // Default findings-mode: legacy Stage + Hide buttons.
          <>
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
                Hide {selectedCount} {noun}{selectedCount === 1 ? '' : 's'}
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
          </>
        )}
      </div>
    </div>
  );
}
