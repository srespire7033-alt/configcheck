import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { checkQuota } from '@/lib/quota';
import { track } from '@/lib/analytics/track-server';
import { AnalyticsEvent } from '@/lib/analytics/events';
import type { ProductType } from '@/types';

// POST now just enqueues — the actual scan runs in /api/cron/process-queue.
// Previously scans ran via waitUntil() inside the POST function, which
// shared the Vercel function's 180s lifetime with the HTTP response. That
// architecture meant: scan failures couldn't outlive the function, parallel
// scans starved each other for the same event loop, and we couldn't retry.
// Now POST returns in <1s and a Vercel Cron worker drains the queue
// serially. See /api/cron/process-queue for the worker.
export const maxDuration = 30;

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

    const { organizationId, productType: requestedProductType } = await request.json();

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
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

    // Check scan quota
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

    // Create scan record (pending)
    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .insert({
        organization_id: organizationId,
        user_id: org.user_id,
        status: 'pending',
        scan_type: 'full',
        product_type: productType,
        started_at: new Date().toISOString(),
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

    // Scan is now sitting in the queue (status='pending'). The cron worker
    // at /api/cron/process-queue picks it up within ~60s and runs it.
    // Client polls GET /api/scans?scanId=xxx for status transitions.
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
