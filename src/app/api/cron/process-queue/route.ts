import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { runScanInBackground } from '@/lib/scans/run-scan-in-background';
import type { ProductType } from '@/types';

export const dynamic = 'force-dynamic';
// One scan invocation can take up to ~3 minutes between Salesforce queries,
// 150+ analysis checks, DB writes, and the AI summary. 300 is Vercel Pro's
// hard ceiling; we set 290 to leave a small buffer for the response.
export const maxDuration = 290;

/**
 * Vercel Cron worker — runs every minute via vercel.json.
 *
 * Two responsibilities, in order:
 *   1. Reset "stuck" scans. Any row still status='running' for more than
 *      STUCK_AFTER_MS is presumed dead (function crashed, deploy bumped,
 *      etc.) and gets flipped back to 'pending' so the next tick can
 *      retry it. Caps retry to a small number so genuinely broken scans
 *      fail loudly instead of looping forever.
 *   2. Claim one 'pending' scan and run it inline. We use an
 *      optimistic-update pattern (UPDATE ... WHERE status='pending') so
 *      two cron ticks landing in the same second can't both claim the
 *      same row. Whichever update returns 0 rows simply exits.
 *
 * Only one scan runs per cron tick. With a 60-second cron interval, that
 * caps throughput at ~60 scans/hour — plenty for current load. If we
 * outgrow it we can either shorten the interval, run multiple claims per
 * tick, or move to a real queue service (Inngest/Trigger.dev).
 *
 * Auth: Bearer ${CRON_SECRET}. Set the env var in Vercel and add the same
 * value to the cron job header in vercel.json. The Vercel Cron runner
 * automatically sends the Authorization header — no extra wiring needed.
 */

const STUCK_AFTER_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRIES = 2;

export async function GET(request: NextRequest) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>. Reject anything
  // else so the endpoint isn't a public DoS surface.
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const tickStart = Date.now();
  const result: Record<string, unknown> = { ticked_at: new Date().toISOString() };

  // ── Step 1: rescue stuck scans ────────────────────────────────────
  try {
    const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
    const { data: stuck } = await supabase
      .from('scans')
      .select('id, retry_count')
      .eq('status', 'running')
      .lt('started_at', cutoff);

    const stuckIds: string[] = [];
    const giveUpIds: string[] = [];
    for (const s of stuck ?? []) {
      const retries = (s as { retry_count?: number }).retry_count ?? 0;
      if (retries >= MAX_RETRIES) giveUpIds.push(s.id);
      else stuckIds.push(s.id);
    }

    if (stuckIds.length > 0) {
      await supabase.rpc('increment_scan_retry', { scan_ids: stuckIds }).then(
        () => undefined,
        // RPC may not exist yet — fall back to a non-atomic update with the
        // current retry_count fetched above. Best-effort; if it races with
        // another tick the worst case is the same scan gets retried once
        // extra, which is harmless given MAX_RETRIES=2 also caps loss.
        async () => {
          for (const s of stuck ?? []) {
            if (stuckIds.includes(s.id)) {
              await supabase
                .from('scans')
                .update({ status: 'pending', retry_count: ((s as { retry_count?: number }).retry_count ?? 0) + 1 })
                .eq('id', s.id)
                .eq('status', 'running');
            }
          }
        }
      );
    }
    if (giveUpIds.length > 0) {
      await supabase
        .from('scans')
        .update({
          status: 'failed',
          error_message: `Scan exceeded ${MAX_RETRIES} retry attempts and was abandoned.`,
          completed_at: new Date().toISOString(),
        })
        .in('id', giveUpIds);
    }
    result.rescued = stuckIds.length;
    result.abandoned = giveUpIds.length;
  } catch (err) {
    console.error('[cron/process-queue] rescue step failed:', err);
    result.rescue_error = err instanceof Error ? err.message : 'unknown';
  }

  // ── Step 2: claim and run one pending scan ────────────────────────
  type Candidate = { id: string; organization_id: string };
  let candidate: Candidate | null = null;
  try {
    const { data } = await supabase
      .from('scans')
      .select('id, organization_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    candidate = (data as Candidate | null) ?? null;
  } catch (err) {
    console.error('[cron/process-queue] candidate select failed:', err);
    return NextResponse.json({ ...result, error: 'candidate_select_failed' });
  }

  if (!candidate) {
    result.processed = false;
    result.tick_ms = Date.now() - tickStart;
    return NextResponse.json(result);
  }

  // Optimistic claim: only succeed if the row is still pending.
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from('scans')
    .update({ status: 'running', started_at: claimedAt })
    .eq('id', candidate.id)
    .eq('status', 'pending')
    .select('id, organization_id, product_type')
    .maybeSingle();

  if (claimErr || !claimed) {
    // Another worker beat us to it, or the row vanished. Either way we move on.
    result.processed = false;
    result.claim_skipped = true;
    return NextResponse.json(result);
  }

  // Load the full org row — runScanInBackground expects it.
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', claimed.organization_id)
    .single();

  if (orgErr || !org) {
    await supabase
      .from('scans')
      .update({
        status: 'failed',
        error_message: 'Organization not found at scan time (deleted?)',
        completed_at: new Date().toISOString(),
      })
      .eq('id', claimed.id);
    return NextResponse.json({ ...result, processed: true, scan_id: claimed.id, outcome: 'org_missing' });
  }

  result.scan_id = claimed.id;
  result.processed = true;

  try {
    await runScanInBackground(claimed.id, org, (claimed.product_type as ProductType) ?? 'cpq');
    result.outcome = 'completed';
  } catch (err) {
    console.error('[cron/process-queue] scan execution failed:', err);
    const msg = err instanceof Error ? err.message : 'Scan execution failed';
    await supabase
      .from('scans')
      .update({
        status: 'failed',
        error_message: msg,
        completed_at: new Date().toISOString(),
      })
      .eq('id', claimed.id);
    result.outcome = 'failed';
    result.error = msg.slice(0, 200);
  }

  result.tick_ms = Date.now() - tickStart;
  return NextResponse.json(result);
}
