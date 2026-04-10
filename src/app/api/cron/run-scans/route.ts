import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { calculateNextRun } from '@/lib/schedule-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/run-scans
 * Called by Vercel Cron every hour. Finds due schedules and triggers scans.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date().toISOString();

  // Find all enabled schedules that are due
  const { data: dueSchedules, error: fetchError } = await supabase
    .from('scan_schedules')
    .select('*')
    .eq('enabled', true)
    .lte('next_run_at', now);

  if (fetchError) {
    console.error('Failed to fetch due schedules:', fetchError.message);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!dueSchedules || dueSchedules.length === 0) {
    return NextResponse.json({ message: 'No schedules due', processed: 0 });
  }

  const results: Array<{ scheduleId: string; status: string; scanId?: string }> = [];

  for (const schedule of dueSchedules) {
    try {
      // Get the organization to verify it still exists and get user_id
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', schedule.organization_id)
        .single();

      if (orgError || !org) {
        console.error(`Org not found for schedule ${schedule.id}`);
        results.push({ scheduleId: schedule.id, status: 'org_not_found' });
        continue;
      }

      // Create a new scan record
      const { data: scan, error: scanError } = await supabase
        .from('scans')
        .insert({
          organization_id: schedule.organization_id,
          user_id: schedule.user_id,
          status: 'pending',
          scan_type: 'full',
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (scanError || !scan) {
        console.error(`Failed to create scan for schedule ${schedule.id}:`, scanError?.message);
        results.push({ scheduleId: schedule.id, status: 'scan_create_failed' });
        continue;
      }

      // Trigger the scan via internal fetch to reuse existing scan logic
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      fetch(`${appUrl}/api/scans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: schedule.organization_id }),
      }).catch((err) => {
        console.error(`Background scan trigger failed for schedule ${schedule.id}:`, err);
      });

      // Update the schedule: set last_run_at and calculate next_run_at
      const updateData: Record<string, unknown> = {
        last_run_at: now,
        updated_at: now,
      };

      if (schedule.schedule_type === 'once') {
        // One-time schedule: disable after running
        updateData.enabled = false;
        updateData.next_run_at = null;
      } else {
        // Recurring: calculate next run
        updateData.next_run_at = calculateNextRun({
          schedule_type: schedule.schedule_type,
          time_of_day: schedule.time_of_day,
          timezone: schedule.timezone,
          scheduled_date: schedule.scheduled_date,
          day_of_week: schedule.day_of_week,
          day_of_month: schedule.day_of_month,
        });
      }

      await supabase
        .from('scan_schedules')
        .update(updateData)
        .eq('id', schedule.id);

      results.push({ scheduleId: schedule.id, status: 'triggered', scanId: scan.id });
    } catch (err) {
      console.error(`Error processing schedule ${schedule.id}:`, err);
      results.push({ scheduleId: schedule.id, status: 'error' });
    }
  }

  return NextResponse.json({
    message: `Processed ${results.length} schedule(s)`,
    processed: results.length,
    results,
  });
}
