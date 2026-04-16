import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { buildCronExpression, calculateNextRun } from '@/lib/schedule-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/schedules?orgId=<uuid>
 * List all schedules for an organization.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = request.nextUrl.searchParams.get('orgId');
  if (!orgId) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('scan_schedules')
    .select('*')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/**
 * POST /api/schedules
 * Create a new scan schedule.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    organizationId,
    scheduleType,
    timeOfDay,
    dayOfWeek,
    dayOfMonth,
    scheduledDate,
    timezone = 'Asia/Kolkata',
  } = body;

  if (!organizationId || !scheduleType || !timeOfDay) {
    return NextResponse.json(
      { error: 'organizationId, scheduleType, and timeOfDay are required' },
      { status: 400 }
    );
  }

  const scheduleInput = {
    schedule_type: scheduleType as 'once' | 'daily' | 'weekly' | 'monthly',
    time_of_day: timeOfDay,
    timezone,
    scheduled_date: scheduledDate || null,
    day_of_week: dayOfWeek ?? null,
    day_of_month: dayOfMonth ?? null,
  };

  const cronExpression = buildCronExpression(scheduleInput);
  const nextRunAt = calculateNextRun(scheduleInput);

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('scan_schedules')
    .insert({
      user_id: user.id,
      organization_id: organizationId,
      schedule_type: scheduleType,
      cron_expression: cronExpression,
      timezone,
      scheduled_date: scheduledDate || null,
      day_of_week: dayOfWeek ?? null,
      day_of_month: dayOfMonth ?? null,
      time_of_day: timeOfDay,
      enabled: true,
      next_run_at: nextRunAt,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

/**
 * PUT /api/schedules
 * Update an existing schedule.
 */
export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { scheduleId, enabled, timeOfDay, dayOfWeek, dayOfMonth, scheduledDate, timezone } = body;

  if (!scheduleId) {
    return NextResponse.json({ error: 'scheduleId is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Fetch existing schedule to merge updates
  const { data: existing, error: fetchError } = await supabase
    .from('scan_schedules')
    .select('*')
    .eq('id', scheduleId)
    .eq('user_id', user.id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof enabled === 'boolean') {
    updates.enabled = enabled;
  }

  // If time/schedule fields changed, recalculate cron and next_run_at
  const newTimeOfDay = timeOfDay ?? existing.time_of_day;
  const newDayOfWeek = dayOfWeek !== undefined ? dayOfWeek : existing.day_of_week;
  const newDayOfMonth = dayOfMonth !== undefined ? dayOfMonth : existing.day_of_month;
  const newScheduledDate = scheduledDate !== undefined ? scheduledDate : existing.scheduled_date;
  const newTimezone = timezone ?? existing.timezone;

  if (timeOfDay || dayOfWeek !== undefined || dayOfMonth !== undefined || scheduledDate !== undefined || timezone) {
    const scheduleInput = {
      schedule_type: existing.schedule_type as 'once' | 'daily' | 'weekly' | 'monthly',
      time_of_day: newTimeOfDay,
      timezone: newTimezone,
      scheduled_date: newScheduledDate,
      day_of_week: newDayOfWeek,
      day_of_month: newDayOfMonth,
    };
    updates.time_of_day = newTimeOfDay;
    updates.day_of_week = newDayOfWeek;
    updates.day_of_month = newDayOfMonth;
    updates.scheduled_date = newScheduledDate;
    updates.timezone = newTimezone;
    updates.cron_expression = buildCronExpression(scheduleInput);
    updates.next_run_at = calculateNextRun(scheduleInput);
  }

  const { data, error } = await supabase
    .from('scan_schedules')
    .update(updates)
    .eq('id', scheduleId)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/**
 * DELETE /api/schedules?scheduleId=<uuid>
 * Delete a schedule.
 */
export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const scheduleId = request.nextUrl.searchParams.get('scheduleId');
  if (!scheduleId) {
    return NextResponse.json({ error: 'scheduleId is required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('scan_schedules')
    .delete()
    .eq('id', scheduleId)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
