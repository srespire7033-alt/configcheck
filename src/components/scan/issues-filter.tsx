'use client';

/**
 * IssuesFilter — search + severity + status filters for the Issues tab.
 *
 * Sibling of FindingsFilterBar but typed for the Issue shape (no
 * detector_id, no effort, has status + category instead). Same look
 * and URL-persistence pattern so the dashboard feels consistent.
 *
 * Filtering runs client-side via useMemo — issues are already loaded
 * on the org page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

type Severity = 'critical' | 'warning' | 'info';
type IssueStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored' | 'false_positive' | 'not_relevant';

interface MinimalIssue {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  status?: string;
}

const PARAM_SCOPE = 'iss';

function readUrl(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(`${PARAM_SCOPE}_${key}`);
}

function writeUrl(updates: Record<string, string | null>): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(updates)) {
    const key = `${PARAM_SCOPE}_${k}`;
    if (v === null || v === '') params.delete(key);
    else params.set(key, v);
  }
  const qs = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

function parseSet<T extends string>(v: string | null, valid: T[]): Set<T> {
  if (!v) return new Set();
  return new Set(v.split(',').filter((x): x is T => valid.includes(x as T)));
}

export function useIssuesFilter<T extends MinimalIssue>(issues: T[]) {
  const [initialized, setInitialized] = useState(false);
  const [search, setSearchState] = useState('');
  const [severityFilter, setSeverityFilterState] = useState<Set<Severity>>(new Set());
  const [statusFilter, setStatusFilterState] = useState<Set<IssueStatus>>(new Set());

  useEffect(() => {
    if (initialized) return;
    setSearchState(readUrl('search') ?? '');
    setSeverityFilterState(parseSet<Severity>(readUrl('severity'), ['critical', 'warning', 'info']));
    setStatusFilterState(
      parseSet<IssueStatus>(readUrl('status'), ['open', 'acknowledged', 'resolved', 'ignored', 'false_positive', 'not_relevant'])
    );
    setInitialized(true);
  }, [initialized]);

  const setSearch = useCallback((s: string) => {
    setSearchState(s);
    writeUrl({ search: s || null });
  }, []);
  const setSeverityFilter = useCallback((next: Set<Severity>) => {
    setSeverityFilterState(next);
    writeUrl({ severity: Array.from(next).sort().join(',') || null });
  }, []);
  const setStatusFilter = useCallback((next: Set<IssueStatus>) => {
    setStatusFilterState(next);
    writeUrl({ status: Array.from(next).sort().join(',') || null });
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return issues.filter((i) => {
      if (term) {
        const hay = `${i.title} ${i.description ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (severityFilter.size > 0) {
        if (!severityFilter.has(i.severity as Severity)) return false;
      }
      if (statusFilter.size > 0) {
        if (!i.status || !statusFilter.has(i.status as IssueStatus)) return false;
      }
      return true;
    });
  }, [issues, search, severityFilter, statusFilter]);

  const toggleSeverity = useCallback(
    (s: Severity) => {
      const next = new Set(severityFilter);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      setSeverityFilter(next);
    },
    [severityFilter, setSeverityFilter]
  );

  const toggleStatus = useCallback(
    (st: IssueStatus) => {
      const next = new Set(statusFilter);
      if (next.has(st)) next.delete(st);
      else next.add(st);
      setStatusFilter(next);
    },
    [statusFilter, setStatusFilter]
  );

  const clearAll = useCallback(() => {
    setSearch('');
    setSeverityFilter(new Set());
    setStatusFilter(new Set());
  }, [setSearch, setSeverityFilter, setStatusFilter]);

  const isActive = search.trim() !== '' || severityFilter.size > 0 || statusFilter.size > 0;

  return {
    filtered,
    search,
    setSearch,
    severityFilter,
    toggleSeverity,
    statusFilter,
    toggleStatus,
    clearAll,
    isActive,
  };
}

const SEVERITY_CHIPS: Array<{ key: Severity; label: string; activeClass: string }> = [
  { key: 'critical', label: 'Critical', activeClass: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 ring-red-300 dark:ring-red-700' },
  { key: 'warning', label: 'Warning', activeClass: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 ring-orange-300 dark:ring-orange-700' },
  { key: 'info', label: 'Info', activeClass: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 ring-blue-300 dark:ring-blue-700' },
];

const STATUS_CHIPS: Array<{ key: IssueStatus; label: string; activeClass: string }> = [
  { key: 'open', label: 'Open', activeClass: 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 ring-gray-400 dark:ring-gray-600' },
  { key: 'acknowledged', label: 'Acknowledged', activeClass: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 ring-amber-300 dark:ring-amber-700' },
  { key: 'resolved', label: 'Resolved', activeClass: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 ring-emerald-300 dark:ring-emerald-700' },
];

interface BarProps {
  search: string;
  setSearch: (s: string) => void;
  severityFilter: Set<Severity>;
  toggleSeverity: (s: Severity) => void;
  statusFilter: Set<IssueStatus>;
  toggleStatus: (st: IssueStatus) => void;
  clearAll: () => void;
  isActive: boolean;
  totalCount: number;
  filteredCount: number;
}

export function IssuesFilterBar({
  search,
  setSearch,
  severityFilter,
  toggleSeverity,
  statusFilter,
  toggleStatus,
  clearAll,
  isActive,
  totalCount,
  filteredCount,
}: BarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40">
      <div className="relative flex-1 min-w-[220px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search issues by title or description…"
          className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-700/40"
          aria-label="Search issues"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 mr-1">Severity</span>
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

      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 mr-1">Status</span>
        {STATUS_CHIPS.map((c) => {
          const isOn = statusFilter.has(c.key);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggleStatus(c.key)}
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

      <div className="flex items-center gap-2 ml-auto">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {isActive
            ? `${filteredCount} of ${totalCount} shown`
            : `${totalCount} issue${totalCount === 1 ? '' : 's'}`}
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
