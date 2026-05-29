import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { checkQuota } from '@/lib/quota';
import { classifyStaleness, DEFAULT_STALENESS_DAYS } from '@/lib/portfolio/staleness';
import { track } from '@/lib/analytics/track-server';
import { AnalyticsEvent } from '@/lib/analytics/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/portfolio-runs
 *
 * Orchestrates a multi-org portfolio comparison. Takes the user's
 * selected orgs, decides which need a fresh scan vs cached, validates
 * quota up-front, then fires N parallel POST /api/scans calls (each
 * with portfolioRunId so the serial gate is bypassed). Returns the run
 * id; the client navigates to /portfolio/runs/[id] and polls status.
 *
 * Request body:
 *   {
 *     organizationIds: string[];           // 2-20 orgs
 *     forceRescanOrgIds?: string[];        // override staleness → always scan
 *     skipScanOrgIds?: string[];           // override staleness → always cache
 *     stalenessThresholdDays?: number;     // default 7
 *     notifyOnComplete?: boolean;          // email when run finishes
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const organizationIds: string[] = Array.isArray(body.organizationIds) ? body.organizationIds : [];
    const forceRescanOrgIds: string[] = Array.isArray(body.forceRescanOrgIds) ? body.forceRescanOrgIds : [];
    const skipScanOrgIds: string[] = Array.isArray(body.skipScanOrgIds) ? body.skipScanOrgIds : [];
    const thresholdDays: number =
      typeof body.stalenessThresholdDays === 'number' && body.stalenessThresholdDays > 0
        ? body.stalenessThresholdDays
        : DEFAULT_STALENESS_DAYS;
    const notifyOnComplete: boolean = body.notifyOnComplete === true;

    if (organizationIds.length < 2) {
      return NextResponse.json({ error: 'Pick at least 2 orgs to compare' }, { status: 400 });
    }
    if (organizationIds.length > 20) {
      return NextResponse.json({ error: 'Maximum 20 orgs per portfolio run' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Ownership + last_scan_at lookup in one go. We use last_scan_at on
    // organizations (kept in sync by the scan engine) rather than joining
    // scans — it's the single source of truth and skips an extra round-trip.
    const { data: orgs, error: orgsErr } = await supabase
      .from('organizations')
      .select('id, name, last_scan_at, connection_status')
      .in('id', organizationIds)
      .eq('user_id', user.id);

    if (orgsErr || !orgs || orgs.length === 0) {
      return NextResponse.json({ error: 'No accessible organizations found' }, { status: 404 });
    }
    if (orgs.length !== organizationIds.length) {
      return NextResponse.json(
        { error: `Found ${orgs.length} of ${organizationIds.length} requested orgs — check ownership.` },
        { status: 403 }
      );
    }

    // Classify staleness, then apply user overrides.
    const verdicts = classifyStaleness(
      orgs.map((o) => ({ org_id: o.id as string, last_scan_at: o.last_scan_at as string | null })),
      thresholdDays
    );
    const needsScanSet = new Set<string>();
    for (const v of verdicts) {
      if (v.bucket !== 'fresh') needsScanSet.add(v.org_id);
    }
    for (const id of forceRescanOrgIds) needsScanSet.add(id);
    for (const id of skipScanOrgIds) needsScanSet.delete(id);

    // For orgs that will use cached: each MUST have at least one completed
    // scan or the comparison will silently miss data. Reject up-front
    // rather than show an empty column in the matrix.
    const cachedOrgIds = orgs.map((o) => o.id as string).filter((id) => !needsScanSet.has(id));
    if (cachedOrgIds.length > 0) {
      const { data: latestScansForCached } = await supabase
        .from('scans')
        .select('organization_id, id')
        .eq('status', 'completed')
        .in('organization_id', cachedOrgIds);
      const haveScanFor = new Set((latestScansForCached ?? []).map((s) => s.organization_id as string));
      const missing = cachedOrgIds.filter((id) => !haveScanFor.has(id));
      if (missing.length > 0) {
        const missingNames = orgs.filter((o) => missing.includes(o.id as string)).map((o) => o.name as string);
        return NextResponse.json(
          {
            error: 'cached_scan_missing',
            message: `These orgs have no completed scan to use as cache: ${missingNames.join(', ')}. Re-scan them or remove from the comparison.`,
            org_ids: missing,
          },
          { status: 400 }
        );
      }
    }

    // Quota: check ONCE for the total number of scans needed. Blocks
    // up-front so partial portfolio runs (some scanned, some failed quota)
    // don't happen.
    const needCount = needsScanSet.size;
    if (needCount > 0) {
      const quota = await checkQuota(user.id, 'scans');
      // Admin / unlimited plans return limit=null. Treat that as
      // unbounded — any quota check passes.
      const remaining = quota.limit === null ? Number.POSITIVE_INFINITY : Math.max(0, quota.limit - quota.used);
      if (remaining < needCount) {
        return NextResponse.json(
          {
            error: 'insufficient_scan_quota',
            message: `This run needs ${needCount} scans but you have ${remaining} of ${quota.limit} remaining this month. Reduce the comparison, skip stale orgs (use cached), or upgrade your plan.`,
            needed: needCount,
            remaining,
            limit: quota.limit,
            used: quota.used,
            resetDate: quota.resetDate,
          },
          { status: 429 }
        );
      }
    }

    // Resolve cached scan IDs in the same org order so the run's scan_ids
    // array stays aligned with organization_ids. For orgs being re-scanned
    // we'll fill in the new scan ids below.
    const cachedScanIdByOrg = new Map<string, string>();
    if (cachedOrgIds.length > 0) {
      // Latest completed scan per org. We could use DISTINCT ON in raw SQL
      // but a plain query + JS reduce is clearer here.
      const { data: cachedRows } = await supabase
        .from('scans')
        .select('id, organization_id, created_at')
        .eq('status', 'completed')
        .in('organization_id', cachedOrgIds)
        .order('created_at', { ascending: false });
      for (const r of (cachedRows ?? []) as Array<{ id: string; organization_id: string }>) {
        if (!cachedScanIdByOrg.has(r.organization_id)) cachedScanIdByOrg.set(r.organization_id, r.id);
      }
    }

    // Insert the portfolio_runs row with scan_ids initially empty. We
    // populate scan_ids after firing the scan kickoffs below — that order
    // lets us return early if any kickoff fails.
    const initialStatus = needCount > 0 ? 'running' : 'completed';
    const { data: run, error: runErr } = await supabase
      .from('portfolio_runs')
      .insert({
        user_id: user.id,
        organization_ids: organizationIds,
        scan_ids: [], // filled in below
        status: initialStatus,
        notify_on_complete: notifyOnComplete,
        metadata: {
          staleness_threshold_days: thresholdDays,
          cached_org_ids: cachedOrgIds,
          scanned_org_ids: Array.from(needsScanSet),
          verdicts,
        },
      })
      .select()
      .single();

    if (runErr || !run) {
      return NextResponse.json({ error: 'Failed to create portfolio run' }, { status: 500 });
    }

    // Fan out: fire N parallel calls to /api/scans for each org that
    // needs a fresh scan. Each fetch spawns its OWN Vercel function
    // instance — the orchestrator's request stays sub-second.
    //
    // We forward the auth cookie so the spawned function authenticates as
    // the same user. Internal-internal hop, same origin.
    const origin = request.nextUrl.origin;
    const cookie = request.headers.get('cookie') ?? '';
    const scanIdsByOrg = new Map<string, string>();
    const kickoffErrors: Array<{ org_id: string; error: string }> = [];

    const orgsToScan = orgs.filter((o) => needsScanSet.has(o.id as string));
    const kickoffs = await Promise.allSettled(
      orgsToScan.map(async (o) => {
        const res = await fetch(`${origin}/api/scans`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({
            organizationId: o.id,
            portfolioRunId: run.id,
          }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.message || errBody.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        return { org_id: o.id as string, scan_id: data.scanId as string };
      })
    );
    for (let i = 0; i < kickoffs.length; i++) {
      const r = kickoffs[i];
      const o = orgsToScan[i];
      if (r.status === 'fulfilled') {
        scanIdsByOrg.set(r.value.org_id, r.value.scan_id);
      } else {
        kickoffErrors.push({
          org_id: o.id as string,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }

    // Assemble scan_ids in the same order as organization_ids.
    const scanIds: (string | null)[] = organizationIds.map((orgId) =>
      cachedScanIdByOrg.get(orgId) ?? scanIdsByOrg.get(orgId) ?? null
    );

    // If even one scan failed to kick off, mark the run as 'partial' so
    // the progress page can show the partial state. We don't roll back —
    // the user can still see the orgs that DID start.
    const anyKickoffFailed = kickoffErrors.length > 0;
    const finalStatus =
      needCount === 0 ? 'completed' : anyKickoffFailed && scanIdsByOrg.size === 0 ? 'failed' : 'running';

    await supabase
      .from('portfolio_runs')
      .update({
        scan_ids: scanIds,
        status: finalStatus,
        metadata: {
          ...(run.metadata ?? {}),
          kickoff_errors: kickoffErrors.length > 0 ? kickoffErrors : undefined,
        },
        ...(finalStatus === 'completed' ? { completed_at: new Date().toISOString() } : {}),
      })
      .eq('id', run.id);

    void track(AnalyticsEvent.PORTFOLIO_RUN_STARTED, {
      userId: user.id,
      properties: {
        run_id: run.id,
        org_count: organizationIds.length,
        scan_count: needCount,
        cached_count: cachedOrgIds.length,
      },
    });

    return NextResponse.json({
      runId: run.id,
      status: finalStatus,
      scans_kicked_off: scanIdsByOrg.size,
      scans_cached: cachedOrgIds.length,
      kickoff_errors: kickoffErrors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[portfolio-runs POST] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
