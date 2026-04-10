/**
 * Helper utilities for scan schedule calculations.
 */

interface ScheduleInput {
  schedule_type: 'once' | 'daily' | 'weekly' | 'monthly';
  time_of_day: string; // "HH:MM"
  timezone: string;
  scheduled_date?: string | null;
  day_of_week?: number | null; // 0=Sun, 6=Sat
  day_of_month?: number | null; // 1-31
}

/**
 * Build a cron expression from a schedule definition.
 */
export function buildCronExpression(schedule: ScheduleInput): string {
  const [hour, minute] = schedule.time_of_day.split(':').map(Number);

  switch (schedule.schedule_type) {
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${schedule.day_of_week ?? 1}`;
    case 'monthly':
      return `${minute} ${hour} ${schedule.day_of_month ?? 1} * *`;
    case 'once':
      // One-time schedules still need a cron for consistency; use daily pattern
      return `${minute} ${hour} * * *`;
    default:
      return `${minute} ${hour} * * *`;
  }
}

/**
 * Calculate the next run time for a schedule.
 * Returns an ISO string in UTC.
 */
export function calculateNextRun(schedule: ScheduleInput): string {
  const now = new Date();
  const [hour, minute] = schedule.time_of_day.split(':').map(Number);

  // We compute in UTC offset from the timezone.
  // For simplicity we use a lookup of common offsets.
  const offsetMinutes = getTimezoneOffsetMinutes(schedule.timezone);

  // Target time today in UTC: desired local time minus offset
  const todayTarget = new Date(now);
  todayTarget.setUTCHours(hour - Math.floor(offsetMinutes / 60), minute - (offsetMinutes % 60), 0, 0);

  switch (schedule.schedule_type) {
    case 'once': {
      if (schedule.scheduled_date) {
        const date = new Date(schedule.scheduled_date);
        date.setUTCHours(hour - Math.floor(offsetMinutes / 60), minute - (offsetMinutes % 60), 0, 0);
        return date.toISOString();
      }
      // If no date, schedule for today/tomorrow
      if (todayTarget > now) return todayTarget.toISOString();
      todayTarget.setUTCDate(todayTarget.getUTCDate() + 1);
      return todayTarget.toISOString();
    }

    case 'daily': {
      if (todayTarget > now) return todayTarget.toISOString();
      todayTarget.setUTCDate(todayTarget.getUTCDate() + 1);
      return todayTarget.toISOString();
    }

    case 'weekly': {
      const targetDay = schedule.day_of_week ?? 1; // default Monday
      const currentDay = getLocalDayOfWeek(now, offsetMinutes);
      let daysUntil = targetDay - currentDay;
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0 && todayTarget <= now) daysUntil = 7;
      const next = new Date(todayTarget);
      next.setUTCDate(next.getUTCDate() + daysUntil);
      return next.toISOString();
    }

    case 'monthly': {
      const targetDom = schedule.day_of_month ?? 1;
      const result = new Date(todayTarget);
      result.setUTCDate(targetDom);
      // If we're past that day this month, go to next month
      if (result <= now) {
        result.setUTCMonth(result.getUTCMonth() + 1);
        result.setUTCDate(targetDom);
      }
      return result.toISOString();
    }

    default:
      return todayTarget.toISOString();
  }
}

/**
 * Get the local day of the week (0=Sun) given a UTC date and timezone offset.
 */
function getLocalDayOfWeek(date: Date, offsetMinutes: number): number {
  const localTime = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  return localTime.getUTCDay();
}

/**
 * Get timezone offset in minutes from UTC (positive = east of UTC).
 * E.g. Asia/Kolkata = +330, America/New_York = -300 (EST) or -240 (EDT).
 */
function getTimezoneOffsetMinutes(timezone: string): number {
  const offsets: Record<string, number> = {
    'UTC': 0,
    'Asia/Kolkata': 330,
    'America/New_York': -300,
    'America/Chicago': -360,
    'America/Denver': -420,
    'America/Los_Angeles': -480,
    'Europe/London': 0,
    'Europe/Berlin': 60,
    'Asia/Tokyo': 540,
    'Australia/Sydney': 600,
  };

  return offsets[timezone] ?? 330; // Default to IST
}

/**
 * Generate a human-readable description of the schedule.
 */
export function describeSchedule(schedule: {
  schedule_type: string;
  time_of_day: string;
  day_of_week?: number | null;
  day_of_month?: number | null;
  scheduled_date?: string | null;
  timezone: string;
}): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Format time for display
  const [h, m] = schedule.time_of_day.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 || 12;
  const timeStr = `${displayHour}:${m.toString().padStart(2, '0')} ${ampm}`;

  switch (schedule.schedule_type) {
    case 'daily':
      return `Daily at ${timeStr}`;
    case 'weekly':
      return `Every ${dayNames[schedule.day_of_week ?? 1]} at ${timeStr}`;
    case 'monthly':
      return `Monthly on day ${schedule.day_of_month ?? 1} at ${timeStr}`;
    case 'once': {
      if (schedule.scheduled_date) {
        const d = new Date(schedule.scheduled_date);
        return `Once on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${timeStr}`;
      }
      return `Once at ${timeStr}`;
    }
    default:
      return `At ${timeStr}`;
  }
}
