'use client';

/**
 * FindingsFilter — search + effort-chip filter, with a useFindingsFilter
 * hook for parents that want to apply the same filter logic to their
 * data. Encapsulates the filtering state so each finding-list surface
 * (Revenue Leakage theme cards, Governance/Pipeline top-findings,
 * future Issues tab) gets consistent behavior with zero duplication.
 *
 * Filtering is CLIENT-SIDE — we already have all the findings in
 * memory (verifiedLeakage.top_findings is pre-loaded by the org page).
 * Server-side filtering would add a roundtrip for what is essentially
 * a string match + Set membership check.
 */

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { getDetectorEffort, type EffortLevel } from '@/lib/forensics/types';

interface MinimalFinding {
  id: string;
  detector_id: string;
  title: string;
}

export interface FindingsFilterState {
  search: string;
  effortFilter: Set<EffortLevel>;
}

/**
 * Hook: takes the raw findings + returns filtered findings + the
 * filter state setters. Parent renders <FindingsFilterBar> with the
 * returned state and uses `filtered` for downstream rendering.
 */
export function useFindingsFilter<T extends MinimalFinding>(findings: T[]) {
  const [search, setSearch] = useState('');
  const [effortFilter, setEffortFilter] = useState<Set<EffortLevel>>(new Set());

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return findings.filter((f) => {
      if (term) {
        const hay = `${f.title} ${f.detector_id}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (effortFilter.size > 0) {
        const effort = getDetectorEffort(f.detector_id);
        if (!effortFilter.has(effort)) return false;
      }
      return true;
    });
  }, [findings, search, effortFilter]);

  function toggleEffort(level: EffortLevel) {
    setEffortFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function clearAll() {
    setSearch('');
    setEffortFilter(new Set());
  }

  const isActive = search.trim() !== '' || effortFilter.size > 0;

  return {
    filtered,
    search,
    setSearch,
    effortFilter,
    toggleEffort,
    clearAll,
    isActive,
  };
}

interface FilterBarProps {
  search: string;
  setSearch: (s: string) => void;
  effortFilter: Set<EffortLevel>;
  toggleEffort: (level: EffortLevel) => void;
  clearAll: () => void;
  isActive: boolean;
  totalCount: number;
  filteredCount: number;
  /** Optional placeholder for the search input. Default 'Search findings…'. */
  placeholder?: string;
}

const EFFORT_CHIPS: Array<{ key: EffortLevel; label: string; activeClass: string }> = [
  {
    key: 'low',
    label: 'Low',
    activeClass:
      'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 ring-emerald-300 dark:ring-emerald-700',
  },
  {
    key: 'medium',
    label: 'Medium',
    activeClass:
      'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 ring-amber-300 dark:ring-amber-700',
  },
  {
    key: 'high',
    label: 'High',
    activeClass:
      'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 ring-rose-300 dark:ring-rose-700',
  },
];

export function FindingsFilterBar({
  search,
  setSearch,
  effortFilter,
  toggleEffort,
  clearAll,
  isActive,
  totalCount,
  filteredCount,
  placeholder = 'Search findings…',
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {/* Search input */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-700/40"
          aria-label="Search findings"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Effort chips */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 mr-1">
          Effort:
        </span>
        {EFFORT_CHIPS.map((c) => {
          const isOn = effortFilter.has(c.key);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggleEffort(c.key)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-full ring-1 ring-inset transition-colors ${
                isOn
                  ? c.activeClass
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 ring-gray-200 dark:ring-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              aria-pressed={isOn}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Count + clear */}
      <div className="flex items-center gap-2 ml-auto">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {isActive
            ? `${filteredCount} of ${totalCount} shown`
            : `${totalCount} finding${totalCount === 1 ? '' : 's'}`}
        </span>
        {isActive && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
