'use client';

import { useState } from 'react';
import { Clock, Repeat, Calendar, CalendarDays, Trash2, CalendarPlus, Check, Pause } from 'lucide-react';
import type { DBScanSchedule } from '@/types';

interface ScheduleListProps {
  schedules: DBScanSchedule[];
  onToggle: (scheduleId: string, enabled: boolean) => void;
  onDelete: (scheduleId: string) => void;
  onCreateClick: () => void;
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

function formatNextRun(nextRunAt: string | null): string {
  if (!nextRunAt) return 'N/A';
  const date = new Date(nextRunAt);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) return 'Overdue';

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffHours < 1) return `In ${diffMins} min`;
  if (diffHours < 24) return `In ${diffHours}h ${diffMins}m`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function ScheduleList({ schedules, onToggle, onDelete, onCreateClick }: ScheduleListProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function handleDeleteClick(scheduleId: string) {
    if (confirmDeleteId === scheduleId) {
      onDelete(scheduleId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(scheduleId);
    }
  }

  if (schedules.length === 0) {
    return (
      <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8 text-center">
        <div className="inline-flex p-3 bg-blue-50 dark:bg-blue-900/30 rounded-xl mb-3">
          <CalendarPlus className="w-7 h-7 text-blue-400" />
        </div>
        <p className="text-gray-600 dark:text-gray-300 font-medium mb-1">No scheduled scans</p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">Set up automated scans to monitor your CPQ config.</p>
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
          return (
            <div key={schedule.id} className="px-6 py-4 flex items-center gap-4">
              {/* Icon */}
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                schedule.enabled ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-gray-50 dark:bg-gray-800'
              }`}>
                <Icon className={`w-5 h-5 ${schedule.enabled ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
              </div>

              {/* Description */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${schedule.enabled ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                  {describeSchedule(schedule)}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  Next run: {schedule.enabled ? formatNextRun(schedule.next_run_at) : 'Paused'}
                  {schedule.last_run_at && (
                    <> &bull; Last ran {new Date(schedule.last_run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
                  )}
                </p>
              </div>

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
                <span className={`flex items-center justify-center w-4 h-4 rounded-full ${
                  schedule.enabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}>
                  {schedule.enabled
                    ? <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                    : <Pause className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                  }
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
