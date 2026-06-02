'use client';

/**
 * FindingsFilter — search + effort + severity + hidden filters, with
 * a useFindingsFilter hook for parents that want to apply the same
 * filter logic to their data. URL-synced so deep-links + browser
 * back/forward work.
 *
 * URL params are SCOPED per filter instance (paramScope) — multiple
 * filter bars on the same page (Revenue Leakage + Governance +
 * Pipeline) don't clobber each other's state. Default scope is
 * 'f' so single-filter pages get short, readable URLs like
 * ?f_search=Q-180&f_effort=low,medium.
 *
 * Filtering is CLIENT-SIDE — all findings are already in memory.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X, Eye, EyeOff } from 'lucide-react';
import { getDetectorEffort, type EffortLevel } from '@/lib/forensics/types';

type Severity = 'critical' | 'warning' | 'info';

interface MinimalFinding {
  id: string;
  detector_id: string;
  title: string;
  /** Accepted as widened string so DB-typed responses ('string') flow through.
   *  At filter time we coerce to the Severity enum and ignore unknown values. */
  severity?: string;
  /** Optional — when set, finding is server-side hidden. */
  hidden_at?: string | null;
}

interface UseFilterOptions {
  /** URL-param scope; defaults to 'f'. Use distinct scopes when multiple bars share a page. */
  paramScope?: string;
  /** Whether to sync to URL via history.replaceState. Default true. */
  urlSync?: boolean;
}

function readUrlParam(scope: string, key: string): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get(`${scope}_${key}`);
}

function writeUrlParams(scope: string, updates: Record<string, string | null>): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates)) {
    const fullKey = `${scope}_${key}`;
    if (value === null || value === '') params.delete(fullKey);
    else params.set(fullKey, value);
  }
  const qs = params.toString();
  const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
  window.history.replaceState({}, '', newUrl);
}

function parseEffortCsv(v: string | null): Set<EffortLevel> {
  if (!v) return new Set();
  const valid: EffortLevel[] = ['low', 'medium', 'high'];
  const parts = v.split(',').filter((x): x is EffortLevel => valid.includes(x as EffortLevel));
  return new Set(parts);
}

function parseSeverityCsv(v: string | null): Set<Severity> {
  if (!v) return new Set();
  const valid: Severity[] = ['critical', 'warning', 'info'];
  const parts = v.split(',').filter((x): x is Severity => valid.includes(x as Severity));
  return new Set(parts);
}

/**
 * Hook: takes the raw findings + returns filtered findings + state
 * setters. Parent renders <FindingsFilterBar> with the returned state.
 */
export function useFindingsFilter<T extends MinimalFinding>(
  findings: T[],
  options: UseFilterOptions = {}
) {
  const { paramScope = 'f', urlSync = true } = options;

  // Initial state from URL — only runs on first render. SSR-safe via
  // window check. We keep React state as the source of truth after
  // hydration; URL is a mirror written via replaceState on changes.
  const [initialized, setInitialized] = useState(false);
  const [search, setSearchState] = useState('');
  const [effortFilter, setEffortFilterState] = useState<Set<EffortLevel>>(new Set());
  const [severityFilter, setSeverityFilterState] = useState<Set<Severity>>(new Set());
  const [showHidden, setShowHiddenState] = useState(false);

  // Hydrate from URL on mount. Done in useEffect so SSR doesn't
  // throw on window access.
  useEffect(() => {
    if (initialized || !urlSync) {
      setInitialized(true);
      return;
    }
    setSearchState(readUrlParam(paramScope, 'search') ?? '');
    setEffortFilterState(parseEffortCsv(readUrlParam(paramScope, 'effort')));
    setSeverityFilterState(parseSeverityCsv(readUrlParam(paramScope, 'severity')));
    setShowHiddenState(readUrlParam(paramScope, 'hidden') === '1');
    setInitialized(true);
  }, [initialized, urlSync, paramScope]);

  // Wrapped setters that also patch the URL.
  const setSearch = useCallback(
    (s: string) => {
      setSearchState(s);
      if (urlSync) writeUrlParams(paramScope, { search: s || null });
    },
    [urlSync, paramScope]
  );
  const setEffortFilter = useCallback(
    (next: Set<EffortLevel>) => {
      setEffortFilterState(next);
      if (urlSync) {
        const csv = Array.from(next).sort().join(',');
        writeUrlParams(paramScope, { effort: csv || null });
      }
    },
    [urlSync, paramScope]
  );
  const setSeverityFilter = useCallback(
    (next: Set<Severity>) => {
      setSeverityFilterState(next);
      if (urlSync) {
        const csv = Array.from(next).sort().join(',');
        writeUrlParams(paramScope, { severity: csv || null });
      }
    },
    [urlSync, paramScope]
  );
  const setShowHidden = useCallback(
    (next: boolean) => {
      setShowHiddenState(next);
      if (urlSync) writeUrlParams(paramScope, { hidden: next ? '1' : null });
    },
    [urlSync, paramScope]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return findings.filter((f) => {
      // Hidden state — when showHidden=false, exclude findings whose
      // hidden_at is set. Findings without the field (not yet
      // server-tagged) are treated as visible.
      if (!showHidden && f.hidden_at) return false;
      if (term) {
        const hay = `${f.title} ${f.detector_id}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (effortFilter.size > 0) {
        const effort = getDetectorEffort(f.detector_id);
        if (!effortFilter.has(effort)) return false;
      }
      if (severityFilter.size > 0) {
        // Coerce DB-string severity to enum at filter time. Anything
        // that isn't critical/warning/info gets treated as 'not matching'
        // so unknown values don't sneak through a severity filter.
        const validSeverities: Severity[] = ['critical', 'warning', 'info'];
        const sev = f.severity as Severity | undefined;
        if (!sev || !validSeverities.includes(sev) || !severityFilter.has(sev)) {
          return false;
        }
      }
      return true;
    });
  }, [findings, search, effortFilter, severityFilter, showHidden]);

  const toggleEffort = useCallback(
    (level: EffortLevel) => {
      const next = new Set(effortFilter);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      setEffortFilter(next);
    },
    [effortFilter, setEffortFilter]
  );

  const toggleSeverity = useCallback(
    (sev: Severity) => {
      const next = new Set(severityFilter);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      setSeverityFilter(next);
    },
    [severityFilter, setSeverityFilter]
  );

  const clearAll = useCallback(() => {
    setSearch('');
    setEffortFilter(new Set());
    setSeverityFilter(new Set());
    setShowHidden(false);
  }, [setSearch, setEffortFilter, setSeverityFilter, setShowHidden]);

  const isActive =
    search.trim() !== '' ||
    effortFilter.size > 0 ||
    severityFilter.size > 0 ||
    showHidden;

  return {
    filtered,
    search,
    setSearch,
    effortFilter,
    toggleEffort,
    severityFilter,
    toggleSeverity,
    showHidden,
    setShowHidden,
    clearAll,
    isActive,
  };
}

interface FilterBarProps {
  search: string;
  setSearch: (s: string) => void;
  effortFilter: Set<EffortLevel>;
  toggleEffort: (level: EffortLevel) => void;
  severityFilter: Set<Severity>;
  toggleSeverity: (sev: Severity) => void;
  showHidden: boolean;
  setShowHidden: (next: boolean) => void;
  clearAll: () => void;
  isActive: boolean;
  totalCount: number;
  filteredCount: number;
  /** Whether to show the severity chips. Hide them on surfaces where severity isn't passed through. */
  showSeverity?: boolean;
  /** Whether to show the 'show hidden' toggle. Hide on surfaces where hidden_at isn't tracked. */
  showHiddenToggle?: boolean;
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
    label: 'Med',
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

const SEVERITY_CHIPS: Array<{ key: Severity; label: string; activeClass: string }> = [
  {
    key: 'critical',
    label: 'Critical',
    activeClass:
      'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 ring-red-300 dark:ring-red-700',
  },
  {
    key: 'warning',
    label: 'Warning',
    activeClass:
      'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 ring-orange-300 dark:ring-orange-700',
  },
  {
    key: 'info',
    label: 'Info',
    activeClass:
      'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 ring-blue-300 dark:ring-blue-700',
  },
];

export function FindingsFilterBar({
  search,
  setSearch,
  effortFilter,
  toggleEffort,
  severityFilter,
  toggleSeverity,
  showHidden,
  setShowHidden,
  clearAll,
  isActive,
  totalCount,
  filteredCount,
  showSeverity = true,
  showHiddenToggle = true,
  placeholder = 'Search findings…',
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4 pb-3 border-b border-gray-100 dark:border-gray-800">
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
          Effort
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

      {/* Severity chips */}
      {showSeverity && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 mr-1">
            Severity
          </span>
          {SEVERITY_CHIPS.map((c) => {
            const isOn = severityFilter.has(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggleSeverity(c.key)}
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
      )}

      {/* Show hidden toggle */}
      {showHiddenToggle && (
        <button
          type="button"
          onClick={() => setShowHidden(!showHidden)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full ring-1 ring-inset transition-colors ${
            showHidden
              ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 ring-purple-300 dark:ring-purple-700'
              : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 ring-gray-200 dark:ring-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
          aria-pressed={showHidden}
          title={showHidden ? 'Currently showing hidden findings too' : 'Show hidden findings'}
        >
          {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {showHidden ? 'Showing hidden' : 'Hidden'}
        </button>
      )}

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
