import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { checkQuota } from '@/lib/quota';
import { runScanInBackground } from '@/lib/scans/run-scan-in-background';
import { track } from '@/lib/analytics/track-server';
import { AnalyticsEvent } from '@/lib/analytics/events';
import type { ProductType } from '@/types';

// Vercel function lifetime cap. On Hobby this silently caps at 60s; on Pro
// it can go to 300. Scans run in waitUntil() below — they share this
// lifetime with the HTTP response, so anything past maxDuration is killed.
// We also have a latent queue-worker architecture at
// /api/cron/process-queue ready to activate when the project moves to Pro
// (where minute-frequency crons are allowed); see commit history.
export const maxDuration = 60;

/**
 * POST /api/scans
 * Start a new health check scan for an org.
 * Creates the scan record, returns scanId immediately,
 * then runs the scan in the background via waitUntil.
 * Client polls GET /api/scans?scanId=xxx for status updates.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { organizationId, productType: requestedProductType, portfolioRunId } = await request.json();

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
    }

    // Portfolio runs bypass the serial gate AND the per-call quota check
    // because the orchestrator validates both up-front in a single
    // transaction-shaped block before fanning out. Without this bypass, a
    // 5-org portfolio run would 409 on scans 2-5 (serial gate) and double-
    // count quota. We verify the run actually belongs to the caller before
    // honoring the bypass.
    let isPortfolioRun = false;
    if (portfolioRunId) {
      const svc = createServiceClient();
      const { data: run } = await svc
        .from('portfolio_runs')
        .select('id, user_id, status')
        .eq('id', portfolioRunId)
        .eq('user_id', user.id)
        .single();
      if (!run) {
        return NextResponse.json({ error: 'portfolio_run not found or not owned' }, { status: 403 });
      }
      if (run.status !== 'pending' && run.status !== 'running') {
        return NextResponse.json({ error: 'portfolio_run is no longer accepting scans' }, { status: 409 });
      }
      isPortfolioRun = true;
    }

    const supabase = createServiceClient();

    // Get org details (verify ownership)
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .eq('user_id', user.id)
      .single();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Resolve product type. Honor an explicit caller-provided value when it's
    // valid; otherwise auto-pick from the org's already-detected packages so a
    // direct API call doesn't fail on ARM-only orgs (which have nothing in
    // SBQQ__/blng__ namespaces and used to default to 'cpq' and bail).
    const VALID: readonly ProductType[] = ['cpq', 'cpq_billing', 'arm'] as const;
    let productType: ProductType;
    if (VALID.includes(requestedProductType)) {
      productType = requestedProductType;
    } else {
      const installed: string[] = (org.installed_packages as string[] | null) || [];
      const hasCPQ = installed.includes('cpq');
      const hasBilling = installed.includes('billing');
      const hasARM = installed.includes('arm');
      if (hasCPQ && hasBilling) productType = 'cpq_billing';
      else if (hasCPQ) productType = 'cpq';
      else if (hasARM) productType = 'arm';
      else productType = 'cpq'; // pre-detection fallback; scan will surface a clear error if neither stack is present
    }

    // Per-user serial gate. Running multiple scans concurrently on the same
    // Vercel function instance starves the event loop for the issues-batch
    // insert (and Gemini API calls), so all sibling scans die at the 60s
    // timeout boundary with "Failed to save issues (batch 1)". The dashboard
    // already runs Scan-all sequentially, but multi-tab users and direct API
    // clients can still trigger the storm. We reject overlapping scans here
    // with 409 so callers know to wait — quota is NOT consumed for rejects.
    //
    // Portfolio runs skip this gate because each scan spawns in its OWN
    // function instance (the orchestrator fires N fetches), not the same
    // one. Per-user Gemini throttle still serializes AI bursts naturally.
    if (!isPortfolioRun) {
      const { data: inflight } = await supabase
        .from('scans')
        .select('id')
        .eq('user_id', user.id)
        .in('status', ['pending', 'running'])
        .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
        .limit(1);
      if (inflight && inflight.length > 0) {
        void track(AnalyticsEvent.SCAN_BLOCKED_INFLIGHT, {
          userId: user.id,
          properties: { existing_scan_id: inflight[0].id },
        });
        return NextResponse.json({
          error: 'scan_in_progress',
          message: 'Another scan is already running for your account. Please wait for it to finish before starting a new one.',
          existingScanId: inflight[0].id,
        }, { status: 409 });
      }
    }

    // Quota: portfolio runs validate quota up-front in the orchestrator,
    // so a per-call check here would double-count. Single-org scans
    // continue to check normally.
    if (!isPortfolioRun) {
      const quota = await checkQuota(user.id, 'scans');
      if (!quota.allowed) {
        return NextResponse.json({
          error: 'scan_limit_reached',
          message: `You've used all ${quota.limit} scans for this month. Your limit resets on ${quota.resetDate}.`,
          limit: quota.limit,
          used: quota.used,
          resetDate: quota.resetDate,
        }, { status: 429 });
      }
    }

    // Create scan record (pending). When part of a portfolio run, tag the
    // metadata with the run id so the polling endpoint can resolve scan
    // status by run without an extra join.
    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .insert({
        organization_id: organizationId,
        user_id: org.user_id,
        status: 'pending',
        scan_type: 'full',
        product_type: productType,
        started_at: new Date().toISOString(),
        metadata: isPortfolioRun ? { portfolio_run_id: portfolioRunId } : {},
      })
      .select()
      .single();

    if (scanError || !scan) {
      return NextResponse.json({ error: 'Failed to create scan' }, { status: 500 });
    }

    void track(AnalyticsEvent.SCAN_STARTED, {
      userId: user.id,
      properties: { product_type: productType, scan_id: scan.id },
    });

    // Run the scan in the background via waitUntil — keeps the Vercel
    // function alive until the scan finishes, up to maxDuration. Client
    // polls GET /api/scans?scanId=xxx for status transitions.
    waitUntil(
      runScanInBackground(scan.id, org, productType).catch(async (error) => {
        console.error('[SCAN] Scan execution failed:', error);
        const svc = createServiceClient();
        const failUpdate = {
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Scan failed unexpectedly',
          completed_at: new Date().toISOString(),
        };
        const { error: updateErr } = await svc.from('scans').update(failUpdate).eq('id', scan.id);
        if (updateErr) console.error('[SCAN] Failed to mark scan as failed:', updateErr);
      })
    );

    return NextResponse.json({ scanId: scan.id, status: 'pending' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/scans?scanId=xxx
 * Get scan status and results
 */
export async function GET(request: NextRequest) {
  const scanId = request.nextUrl.searchParams.get('scanId');
  // Accept both `orgId` (legacy) and `organizationId` (the POST endpoint's
  // param name) — keeping both keeps existing callers working while letting
  // new code stay consistent with POST.
  const orgId =
    request.nextUrl.searchParams.get('orgId') ||
    request.nextUrl.searchParams.get('organizationId');

  const supabase = createServiceClient();

  if (scanId) {
    const { data: scan, error } = await supabase
      .from('scans')
      .select('*')
      .eq('id', scanId)
      .single();

    if (error || !scan) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    }

    return NextResponse.json(scan, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  }

  if (orgId) {
    const { data: scans, error } = await supabase
      .from('scans')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch scans' }, { status: 500 });
    }

    return NextResponse.json(scans, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  }

  return NextResponse.json({ error: 'scanId or organizationId required' }, { status: 400 });
}
