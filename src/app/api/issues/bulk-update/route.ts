/**
 * POST /api/issues/bulk-update
 *
 * Body: { issueIds: string[], status: 'open'|'acknowledged'|'resolved'|'ignored'|'false_positive'|'not_relevant' }
 *
 * Bulk equivalent of the existing single-issue PUT in /api/issues.
 * Used by the Issues tab BulkActionBar to acknowledge / resolve /
 * mark-not-relevant many issues at once.
 *
 * Mirrors the single-issue endpoint's side-effects:
 *   - resolved status sets resolved_at = now()
 *   - false_positive / not_relevant statuses upsert into
 *     check_suppressions so future scans skip the same check
 *     for the issue's org
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = new Set([
  'open',
  'acknowledged',
  'resolved',
  'ignored',
  'false_positive',
  'not_relevant',
]);
const MAX_BATCH = 500;

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const raw = (body as { issueIds?: unknown; status?: unknown }) || {};
  const issueIds = Array.isArray(raw.issueIds)
    ? raw.issueIds.filter((x): x is string => typeof x === 'string')
    : [];
  const status = typeof raw.status === 'string' ? raw.status : '';

  if (issueIds.length === 0 || issueIds.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `issueIds must be a string[] of length 1–${MAX_BATCH}` },
      { status: 400 }
    );
  }
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${Array.from(VALID_STATUSES).join(', ')}` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const updates: Record<string, unknown> = { status };
  if (status === 'resolved') updates.resolved_at = new Date().toISOString();

  const { error, count } = await supabase
    .from('issues')
    .update(updates, { count: 'exact' })
    .in('id', issueIds);
  if (error) {
    console.error('[issues/bulk-update] update failed:', error);
    return NextResponse.json({ error: 'Failed to update issues' }, { status: 500 });
  }

  // Mirror the single-issue suppression behavior — when bulk-marking
  // as false-positive or not-relevant, suppress those check_ids for
  // their respective orgs so future scans skip them. Pull the rows
  // we just updated to get (org_id, check_id) pairs.
  if (status === 'false_positive' || status === 'not_relevant') {
    const { data: rows } = await supabase
      .from('issues')
      .select('organization_id, check_id')
      .in('id', issueIds);
    const pairs = new Map<string, { organization_id: string; check_id: string }>();
    for (const r of rows ?? []) {
      const orgId = r.organization_id as string | null;
      const checkId = r.check_id as string | null;
      if (!orgId || !checkId) continue;
      pairs.set(`${orgId}::${checkId}`, { organization_id: orgId, check_id: checkId });
    }
    const reason =
      status === 'false_positive'
        ? 'User marked as false positive (bulk)'
        : 'User marked as not relevant (bulk)';
    const suppressions = Array.from(pairs.values()).map((p) => ({
      organization_id: p.organization_id,
      check_id: p.check_id,
      reason,
      suppressed_by: user.id,
    }));
    if (suppressions.length > 0) {
      const { error: suppressErr } = await supabase
        .from('check_suppressions')
        .upsert(suppressions, { onConflict: 'organization_id,check_id' });
      if (suppressErr) {
        console.error('[issues/bulk-update] suppression upsert failed:', suppressErr);
        // Non-fatal — issue status update already committed.
      }
    }
  }

  return NextResponse.json({
    requested: issueIds.length,
    updated: count ?? 0,
    status,
  });
}
