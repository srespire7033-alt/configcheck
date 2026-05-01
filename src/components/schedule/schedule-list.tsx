'use client';

import { useState } from 'react';
import { Clock, Repeat, Calendar, CalendarDays, Trash2, CalendarPlus, Check, Pause, AlertTriangle, Play, Loader2, History, ChevronDown, ChevronRight, CheckCircle2, XCircle, Hourglass } from 'lucide-react';
import { formatTimeAgo } from '@/lib/utils';
import type { DBScanSchedule } from '@/types';

interface ScheduleRunRow {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  overall_score: number | null;
  total_issues: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface ScheduleListProps {
  schedules: DBScanSchedule[];
  onToggle: (scheduleId: string, enabled: boolean) => void;
  onDelete: (scheduleId: string) => void;
  onCreateClick: () => void;
  // Optional: parent provides "Run Now" action so an overdue schedule
  // has an inline recovery path. If not provided, the Run Now button
  // is hidden.
  onRunNow?: (scheduleId: string) => Promise<void> | void;
}

const TYPE_ICONS: Record<string, typeof Clock> = {
  daily: Clock,
  weekly: Repeat,
  monthly: CalendarDays,
  once: Calendar,
};

function describeSchedule(schedule: DBScanSchedule): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const [h, m] = schedule.time_of_day.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 || 12;
  const timeStr = `${displayHour}:${m.toString().padStart(2, '0')} ${ampm}`;

  switch (schedule.schedule_type) {
    case 'daily':
      return `Every day at ${timeStr}`;
    case 'weekly':
      return `Every ${dayNames[schedule.day_of_week ?? 1]} at ${timeStr}`;
    case 'monthly':
      return `Monthly on day ${schedule.day_of_month ?? 1} at ${timeStr}`;
    case 'once': {
      if (schedule.scheduled_date) {
        const d = new Date(schedule.scheduled_date);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return `Once on ${dateStr} at ${timeStr}`;
      }
      return `Once at ${timeStr}`;
    }
    default:
      return `At ${timeStr}`;
  }
}

interface NextRunStatus {
  label: string;
  // True when the scheduler should already have fired but hasn't —
  // the calling row will render in an error state and offer "Run now".
  overdue: boolean;
}

function describeNextRun(nextRunAt: string | null): NextRunStatus {
  if (!nextRunAt) return { label: 'N/A', overdue: false };
  const date = new Date(nextRunAt);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) {
    // How overdue? Anything < 5 min is essentially "running now / catching up";
    // beyond that we surface it as a problem.
    const overdueMs = Math.abs(diffMs);
    const overdueMins = Math.floor(overdueMs / 60_000);
    if (overdueMins < 5) return { label: 'Catching up…', overdue: false };
    if (overdueMins < 60) return { label: `Overdue by ${overdueMins} min`, overdue: true };
    const overdueHours = Math.floor(overdueMins / 60);
    if (overdueHours < 24) return { label: `Overdue by ${overdueHours}h`, overdue: true };
    const overdueDays = Math.floor(overdueHours / 24);
    return { label: `Overdue by ${overdueDays} day${overdueDays !== 1 ? 's' : ''}`, overdue: true };
  }

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffHours < 1) return { label: `In ${diffMins} min`, overdue: false };
  if (diffHours < 24) return { label: `In ${diffHours}h ${diffMins}m`, overdue: false };

  return {
    label: date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    overdue: false,
  };
}

export function ScheduleList({ schedules, onToggle, onDelete, onCreateClick, onRunNow }: ScheduleListProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  // Per-schedule run-history state. Lazy-loaded the first time the user
  // expands a row so we don't fan out N queries on initial render.
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyByScheduleId, setHistoryByScheduleId] = useState<Record<string, ScheduleRunRow[]>>({});
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);

  async function toggleHistory(scheduleId: string) {
    if (expandedHistoryId === scheduleId) {
      setExpandedHistoryId(null);
      return;
    }
    setExpandedHistoryId(scheduleId);
    if (!historyByScheduleId[scheduleId]) {
      setHistoryLoadingId(scheduleId);
      try {
        const res = await fetch(`/api/schedules/${scheduleId}/runs?limit=5`, { cache: 'no-store' });
        if (res.ok) {
          const data: ScheduleRunRow[] = await res.json();
          setHistoryByScheduleId((prev) => ({ ...prev, [scheduleId]: data }));
        } else {
          setHistoryByScheduleId((prev) => ({ ...prev, [scheduleId]: [] }));
        }
      } catch {
        setHistoryByScheduleId((prev) => ({ ...prev, [scheduleId]: [] }));
      } finally {
        setHistoryLoadingId(null);
      }
    }
  }

  function handleDeleteClick(scheduleId: string) {
    if (confirmDeleteId === scheduleId) {
      onDelete(scheduleId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(scheduleId);
    }
  }

  async function handleRunNow(scheduleId: string) {
    if (!onRunNow) return;
    setRunningId(scheduleId);
    try {
      await onRunNow(scheduleId);
    } finally {
      setRunningId(null);
    }
  }

  if (schedules.length === 0) {
    return (
      <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8 text-center">
        <div className="inline-flex p-3 bg-blue-50 dark:bg-blue-900/30 rounded-xl mb-3">
          <CalendarPlus className="w-7 h-7 text-blue-400" />
        </div>
        <p className="text-gray-600 dark:text-gray-300 font-medium mb-1">No scheduled scans</p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">Set up automated scans to monitor your configuration.</p>
        <button
          onClick={onCreateClick}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition"
        >
          Create Schedule
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Scheduled Scans</h3>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {schedules.map((schedule) => {
          const Icon = TYPE_ICONS[schedule.schedule_type] || Clock;
          const nextRun = describeNextRun(schedule.next_run_at);
          const isOverdue = schedule.enabled && nextRun.overdue;
          const isRunning = runningId === schedule.id;
          const isHistoryOpen = expandedHistoryId === schedule.id;
          const historyRows = historyByScheduleId[schedule.id];
          return (
            <div key={schedule.id}>
            <div
              className={`px-6 py-4 flex items-center gap-4 transition-colors ${
                isOverdue ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''
              }`}
            >
              {/* Icon */}
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  isOverdue
                    ? 'bg-amber-100 dark:bg-amber-900/40'
                    : schedule.enabled
                    ? 'bg-blue-50 dark:bg-blue-900/30'
                    : 'bg-gray-50 dark:bg-gray-800'
                }`}
              >
                {isOverdue ? (
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                ) : (
                  <Icon className={`w-5 h-5 ${schedule.enabled ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
                )}
              </div>

              {/* Description */}
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium ${
                    schedule.enabled ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {describeSchedule(schedule)}
                </p>
                <p
                  className={`text-xs mt-0.5 ${
                    isOverdue
                      ? 'text-amber-700 dark:text-amber-400 font-medium'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {isOverdue && (
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {nextRun.label}
                    </span>
                  )}
                  {!isOverdue && (
                    <>Next run: {schedule.enabled ? nextRun.label : 'Paused'}</>
                  )}
                  {schedule.last_run_at && (
                    <span className="text-gray-400 dark:text-gray-500"> &bull; Last ran {new Date(schedule.last_run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  )}
                </p>
              </div>

              {/* Run Now — only shown when overdue and parent provided handler */}
              {isOverdue && onRunNow && (
                <button
                  onClick={() => handleRunNow(schedule.id)}
                  disabled={isRunning}
                  title="Run this scan now"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 flex-shrink-0 border bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800 hover:bg-amber-200 dark:hover:bg-amber-900/60 disabled:opacity-60"
                >
                  {isRunning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  {isRunning ? 'Starting…' : 'Run now'}
                </button>
              )}

              {/* Toggle */}
              <button
                onClick={() => onToggle(schedule.id, !schedule.enabled)}
                title={schedule.enabled ? 'Disable schedule' : 'Enable schedule'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 flex-shrink-0 border ${
                  schedule.enabled
                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                    : 'bg-gray-50 dark:bg-gray-800 text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-500'
                }`}
              >
                <span
                  className={`flex items-center justify-center w-4 h-4 rounded-full ${
                    schedule.enabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  {schedule.enabled ? (
                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                  ) : (
                    <Pause className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                  )}
                </span>
                {schedule.enabled ? 'Active' : 'Paused'}
              </button>

              {/* History toggle — opens last-5-runs panel below the row.
                  Lazy-loaded so we don't fetch N histories on initial render. */}
              <button
                onClick={() => toggleHistory(schedule.id)}
                title={isHistoryOpen ? 'Hide run history' : 'Show recent runs'}
                className={`p-2 rounded-lg transition flex-shrink-0 inline-flex items-center gap-1 ${
                  isHistoryOpen
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                    : 'text-gray-400 hover:text-blue-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                <History className="w-4 h-4" />
                {isHistoryOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>

              {/* Delete */}
              <button
                onClick={() => handleDeleteClick(schedule.id)}
                className={`p-2 rounded-lg transition flex-shrink-0 ${
                  confirmDeleteId === schedule.id
                    ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50'
                    : 'text-gray-400 hover:text-red-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
                title={confirmDeleteId === schedule.id ? 'Click again to confirm' : 'Delete schedule'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {/* Run history panel — shown when expanded */}
            {isHistoryOpen && (
              <RunHistoryPanel
                loading={historyLoadingId === schedule.id}
                rows={historyRows}
              />
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Renders the last-N runs of a schedule. Each row shows status (succeeded /
 * failed / running / pending), score, severity counts, duration, and the
 * error message inline if it failed.
 */
function RunHistoryPanel({
  loading,
  rows,
}: {
  loading: boolean;
  rows: ScheduleRunRow[] | undefined;
}) {
  if (loading) {
    return (
      <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-800/60 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading recent runs…
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-800/60 text-xs text-gray-500 dark:text-gray-400">
        No scheduled runs yet. The next run will appear here once the scheduler triggers it.
      </div>
    );
  }
  return (
    <div className="bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-800/60">
      <div className="px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800/60">
        Recent runs ({rows.length})
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800/60">
        {rows.map((r) => {
          const StatusIcon =
            r.status === 'completed'
              ? CheckCircle2
              : r.status === 'failed'
              ? XCircle
              : Hourglass;
          const statusCls =
            r.status === 'completed'
              ? 'text-green-600 dark:text-green-400'
              : r.status === 'failed'
              ? 'text-red-600 dark:text-red-400'
              : 'text-gray-400 dark:text-gray-500';
          const ranAt = r.completed_at || r.started_at || r.created_at;
          const durationStr = r.duration_ms
            ? r.duration_ms < 60000
              ? `${Math.round(r.duration_ms / 1000)}s`
              : `${Math.floor(r.duration_ms / 60000)}m ${Math.round((r.duration_ms % 60000) / 1000)}s`
            : null;
          return (
            <li key={r.id} className="px-6 py-2.5 flex items-center gap-3 text-xs">
              <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusCls}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-medium capitalize ${statusCls}`}>{r.status}</span>
                  <span className="text-gray-400">{formatTimeAgo(ranAt)}</span>
                  {durationStr && (
                    <span className="text-gray-400">&middot; {durationStr}</span>
                  )}
                  {r.status === 'completed' && r.overall_score !== null && (
                    <>
                      <span className="text-gray-400">&middot;</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        Score {r.overall_score}
                      </span>
                      {r.total_issues > 0 && (
                        <span className="text-gray-400">
                          ({r.critical_count}C / {r.warning_count}W / {r.info_count}I)
                        </span>
                      )}
                    </>
                  )}
                </div>
                {r.status === 'failed' && r.error_message && (
                  <div className="text-red-600 dark:text-red-400 mt-0.5 truncate" title={r.error_message}>
                    {r.error_message}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
