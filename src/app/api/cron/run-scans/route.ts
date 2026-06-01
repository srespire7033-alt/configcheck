import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createServiceClient } from '@/lib/db/client';
import { calculateNextRun } from '@/lib/schedule-helpers';
import { runScanInBackground } from '@/lib/scans/run-scan-in-background';
import type { ProductType } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

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

      // Pick the right product type based on installed packages, mirroring
      // the dashboard's auto-detection (CPQ+Billing > CPQ > ARM > fallback).
      const pkgs: string[] = Array.isArray(org.installed_packages) ? org.installed_packages : [];
      const productType: ProductType =
        pkgs.includes('cpq') && pkgs.includes('billing')
          ? 'cpq_billing'
          : pkgs.includes('cpq')
          ? 'cpq'
          : pkgs.includes('arm')
          ? 'arm'
          : (schedule.product_type as ProductType | undefined) || 'cpq';

      // Create a new scan record. Tag it with the schedule that triggered
      // it so the UI can show "last 5 runs" history per schedule.
      const { data: scan, error: scanError } = await supabase
        .from('scans')
        .insert({
          organization_id: schedule.organization_id,
          user_id: schedule.user_id,
          status: 'pending',
          scan_type: 'full',
          product_type: productType,
          triggered_by_schedule_id: schedule.id,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (scanError || !scan) {
        console.error(`Failed to create scan for schedule ${schedule.id}:`, scanError?.message);
        results.push({ scheduleId: schedule.id, status: 'scan_create_failed' });
        continue;
      }

      // Create a forensic_scans row up front so the chain mirrors the
      // user-triggered scan flow. Scheduled scans ALWAYS include forensic
      // — the whole product narrative around scheduling is "what got
      // worse this week," and the diff card only has data to show if
      // forensic runs alongside config every time.
      const { data: u } = await supabase
        .from('users')
        .select('plan, is_admin')
        .eq('id', schedule.user_id)
        .single();
      const userPlan = (u?.plan as string | undefined) ?? 'free';
      const userIsAdmin = u?.is_admin === true;
      const { data: forensicScan } = await supabase
        .from('forensic_scans')
        .insert({
          user_id: schedule.user_id,
          organization_id: schedule.organization_id,
          parent_scan_id: scan.id,
          status: 'queued',
          metadata: {
            plan: userPlan,
            is_admin: userIsAdmin,
            triggered_by_schedule_id: schedule.id,
          },
        })
        .select('id')
        .single();
      const forensicScanId = forensicScan?.id ?? null;

      // Run the scan inline via waitUntil. The previous fire-and-forget
      // POST to /api/scans was bouncing off getAuthUser (cookie-only auth),
      // so cron-triggered scans were stuck in pending forever. Calling
      // runScanInBackground directly bypasses the auth gate — we already
      // verified the schedule belongs to a real org above. Then chain
      // to the forensic engine the same way /api/scans does for
      // user-triggered scans.
      waitUntil(
        runScanInBackground(scan.id, org, productType)
          .then(async () => {
            if (!forensicScanId) return;
            const { runForensicScanInBackground } = await import('@/lib/forensics/run-forensic-scan');
            await runForensicScanInBackground({
              forensicScanId,
              organizationId: schedule.organization_id,
              userId: schedule.user_id,
              parentScanId: scan.id,
              plan: userPlan,
              isAdmin: userIsAdmin,
            });
          })
          .catch(async (error: unknown) => {
            console.error(`[CRON-SCAN ${scan.id}] Scan execution failed:`, error);
            await supabase
              .from('scans')
              .update({
                status: 'failed',
                error_message: error instanceof Error ? error.message : 'Scheduled scan failed unexpectedly',
                completed_at: new Date().toISOString(),
              })
              .eq('id', scan.id);
          })
      );

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
