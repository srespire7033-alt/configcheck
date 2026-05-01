'use client';

import { useState } from 'react';
import { Clock, Repeat, Calendar, CalendarDays, Trash2, CalendarPlus, Check, Pause, AlertTriangle, Play, Loader2 } from 'lucide-react';
import type { DBScanSchedule } from '@/types';

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
          return (
            <div
              key={schedule.id}
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
          );
        })}
      </div>
    </div>
  );
}
