'use client';

/**
 * Dashboard tab strip — Hubbl-style horizontal nav with red underline
 * on the active tab. Used by the org detail page to slice a long
 * vertical-scroll dashboard into focused sub-views.
 *
 * Tabs are drag-to-reorder via dnd-kit. The user's preferred order is
 * persisted in localStorage under STORAGE_KEY so it survives refresh
 * and follows them across orgs (a consultant's workflow is usually
 * consistent regardless of which client's org they're auditing).
 *
 * Graceful schema evolution: if the stored order references a tab ID
 * that no longer exists in code (we removed it), it's filtered out at
 * read time. If new tab IDs exist in code that aren't in the stored
 * order (we added one), they're appended at the end. So stored
 * preferences never block tab list changes.
 *
 * Reset order link appears only when the user has customized — keeps
 * the UI quiet until there's actually something to reset.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RotateCcw, GripHorizontal } from 'lucide-react';

const STORAGE_KEY = 'orgprism-tab-order-v1';

export interface DashboardTab {
  id: string;
  label: string;
  /** Optional small count/badge shown to the right of the label. */
  count?: number | string | null;
  /** Hide this tab when its underlying section has no data. */
  hidden?: boolean;
}

interface Props {
  tabs: DashboardTab[];
  active: string;
  onChange: (id: string) => void;
  /**
   * When set, the active tab is synced to ?tab=<id> in the URL.
   * Default true — only set false if the parent owns its own URL state.
   */
  urlSync?: boolean;
}

function readStoredOrder(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    // Defensive: must be string[]. Anything else gets discarded so a
    // corrupted localStorage entry doesn't crash the dashboard.
    if (!parsed.every((x) => typeof x === 'string')) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

function writeStoredOrder(order: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // localStorage can throw (quota exceeded, privacy mode). Silent
    // failure is fine — the user just loses the persisted order; the
    // dashboard still works.
  }
}

function clearStoredOrder(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Apply stored order to tabs, gracefully handling tab adds/removes. */
function applyStoredOrder(tabs: DashboardTab[], stored: string[] | null): DashboardTab[] {
  if (!stored) return tabs;
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const ordered: DashboardTab[] = [];
  // First: stored IDs that still exist in code, in stored order.
  for (const id of stored) {
    const t = byId.get(id);
    if (t) {
      ordered.push(t);
      byId.delete(id);
    }
  }
  // Then: any new tabs that weren't in the stored order, in their
  // original code-defined order (so future additions are visible).
  for (const t of tabs) {
    if (byId.has(t.id)) ordered.push(t);
  }
  return ordered;
}

function SortableTabButton({
  tab,
  isActive,
  onClick,
}: {
  tab: DashboardTab;
  isActive: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative group"
    >
      <button
        type="button"
        onClick={onClick}
        className={`relative px-4 py-3 text-base font-semibold transition-colors whitespace-nowrap ${
          isActive
            ? 'text-gray-900 dark:text-white'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
        }`}
        aria-current={isActive ? 'page' : undefined}
      >
        <span className="flex items-center gap-2">
          {/* Drag handle — visible on hover. Listeners attached only here
              so click-to-activate doesn't fight the drag gesture. */}
          <span
            {...attributes}
            {...listeners}
            className="opacity-0 group-hover:opacity-60 hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
            title="Drag to reorder"
            // Drag handle must stop click from bubbling to the tab button
            // so the user doesn't switch tabs while starting to drag.
            onClick={(e) => e.stopPropagation()}
          >
            <GripHorizontal className="h-3.5 w-3.5" />
          </span>
          <span className={isActive ? 'font-bold' : ''}>{tab.label}</span>
          {tab.count !== undefined && tab.count !== null && (
            <span
              className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-semibold ${
                isActive
                  ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
              }`}
            >
              {tab.count}
            </span>
          )}
        </span>
        <span
          className={`absolute bottom-0 left-2 right-2 h-0.5 rounded-t ${
            isActive ? 'bg-red-500 dark:bg-red-400' : 'bg-transparent'
          }`}
        />
      </button>
    </div>
  );
}

export function DashboardTabs({ tabs, active, onChange, urlSync = true }: Props) {
  const searchParams = useSearchParams();
  // We track the user's preferred order in component state, hydrated
  // from localStorage on mount. SSR can't read localStorage so we
  // start with the default order and patch in the saved order on
  // mount — small flash of default-order on first paint is acceptable
  // (and most users won't have customized).
  const [storedOrder, setStoredOrder] = useState<string[] | null>(null);
  useEffect(() => {
    setStoredOrder(readStoredOrder());
  }, []);

  const orderedTabs = useMemo(
    () => applyStoredOrder(tabs, storedOrder).filter((t) => !t.hidden),
    [tabs, storedOrder]
  );
  const hasCustomOrder = useMemo(() => {
    if (!storedOrder) return false;
    // Customized only if the stored order differs from default order
    // when both are filtered to overlapping IDs.
    const defaultIds = tabs.map((t) => t.id);
    const storedIds = storedOrder.filter((id) => defaultIds.includes(id));
    if (storedIds.length !== defaultIds.length) return true;
    return defaultIds.some((id, i) => storedIds[i] !== id);
  }, [storedOrder, tabs]);

  const handleClick = useCallback(
    (id: string) => {
      onChange(id);
      if (urlSync && searchParams) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', id);
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, '', newUrl);
      }
    },
    [onChange, urlSync, searchParams]
  );

  // dnd-kit sensors: PointerSensor for mouse/touch with a small
  // activation distance so a quick click on the drag handle doesn't
  // start a drag accidentally. Keyboard sensor for accessibility.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active: activeItem, over } = event;
    if (!over || activeItem.id === over.id) return;
    const oldIndex = orderedTabs.findIndex((t) => t.id === activeItem.id);
    const newIndex = orderedTabs.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(orderedTabs, oldIndex, newIndex);
    const nextIds = next.map((t) => t.id);
    setStoredOrder(nextIds);
    writeStoredOrder(nextIds);
  }

  function handleReset() {
    clearStoredOrder();
    setStoredOrder(null);
  }

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
      <div className="flex items-center justify-between gap-2">
        <div className="overflow-x-auto flex-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedTabs.map((t) => t.id)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex items-center gap-1 min-w-max">
                {orderedTabs.map((tab) => (
                  <SortableTabButton
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === active}
                    onClick={() => handleClick(tab.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        {hasCustomOrder && (
          <button
            onClick={handleReset}
            className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            title="Restore the default tab order"
          >
            <RotateCcw className="h-3 w-3" />
            Reset order
          </button>
        )}
      </div>
    </div>
  );
}
