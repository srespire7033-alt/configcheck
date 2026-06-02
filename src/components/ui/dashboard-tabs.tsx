'use client';

/**
 * Dashboard tab strip — Hubbl-style horizontal nav with a red
 * underline on the active tab. Used by the org detail page to slice
 * a long vertical-scroll dashboard into focused sub-views.
 *
 * Design intent (matches Hubbl Diagnostics' /scan/[id] layout):
 *   - Single horizontal row of tab buttons
 *   - Active tab gets a 2px red underline + bold text
 *   - Inactive tabs are muted but still scannable
 *   - Each tab carries an optional count chip on the right (e.g. for
 *     the Issues tab: 'Issues (12)')
 *   - Tab IDs sync to the URL via ?tab=... so deep-links + browser
 *     back/forward work without re-engineering the page.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

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
   * Default true — only set false if the parent owns its own
   * URL state.
   */
  urlSync?: boolean;
}

export function DashboardTabs({ tabs, active, onChange, urlSync = true }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleClick = useCallback(
    (id: string) => {
      onChange(id);
      if (urlSync && searchParams) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', id);
        // history.replaceState avoids a Next router round-trip — keeps
        // the page mounted and just patches the URL bar. Critical because
        // our org page does heavy data loading on mount; navigating
        // would refetch everything.
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, '', newUrl);
      }
    },
    [onChange, urlSync, searchParams]
  );

  // Filter out hidden tabs. Memoization not worth it — list is tiny.
  const visibleTabs = tabs.filter((t) => !t.hidden);

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 mb-6 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max">
        {visibleTabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleClick(tab.id)}
              className={`relative px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'text-gray-900 dark:text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="flex items-center gap-2">
                <span className={isActive ? 'font-semibold' : ''}>{tab.label}</span>
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
              {/* Underline — red on active, transparent on others.
                  Sits exactly on the bottom border of the strip so the
                  tab's identity reads visually like a clicked physical
                  tab in a file folder. */}
              <span
                className={`absolute bottom-0 left-2 right-2 h-0.5 rounded-t ${
                  isActive ? 'bg-red-500 dark:bg-red-400' : 'bg-transparent'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
