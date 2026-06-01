import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * POST /api/recovery-actions/bulk
 * Body: { ids: string[], action: 'approve' | 'reject' | 'commit' | 'stage' }
 *
 * Enforces the recovery state machine:
 *   pending  → approved   (approve)
 *   pending  → rejected   (reject)
 *   approved → committed  (commit)        ← consultant uploaded the CSV to SF
 *   rejected → pending    (re-stage)      ← consultant changed their mind
 *   expired  → pending    (re-stage)
 *
 * Returns per-id results so the UI can report partial success.
 */
type Action = 'approve' | 'reject' | 'commit' | 'stage';

const TRANSITIONS: Record<Action, { from: string[]; to: string; setTimestamp?: 'approved_at' | 'committed_at' }> = {
  approve: { from: ['pending'], to: 'approved', setTimestamp: 'approved_at' },
  reject:  { from: ['pending'], to: 'rejected' },
  commit:  { from: ['approved'], to: 'committed', setTimestamp: 'committed_at' },
  stage:   { from: ['rejected', 'expired'], to: 'pending' },
};

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { ids?: string[]; action?: Action };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((s): s is string => typeof s === 'string') : [];
  const action = body.action;
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 });
  if (!action || !TRANSITIONS[action]) {
    return NextResponse.json({ error: `action must be one of: ${Object.keys(TRANSITIONS).join(', ')}` }, { status: 400 });
  }

  const supabase = createServiceClient();
  const transition = TRANSITIONS[action];

  // Pull current statuses for these IDs scoped to the caller.
  const { data: currentRows } = await supabase
    .from('recovery_actions')
    .select('id, approval_status')
    .in('id', ids)
    .eq('user_id', user.id);

  const eligible: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const currentById = new Map<string, string>();
  for (const r of currentRows ?? []) {
    currentById.set(r.id as string, r.approval_status as string);
  }
  for (const id of ids) {
    const cur = currentById.get(id);
    if (!cur) {
      skipped.push({ id, reason: 'not_found_or_not_owned' });
      continue;
    }
    if (!transition.from.includes(cur)) {
      skipped.push({ id, reason: `current_status_is_${cur}` });
      continue;
    }
    eligible.push(id);
  }

  let updated: Array<{ id: string }> = [];
  if (eligible.length > 0) {
    const updatePayload: Record<string, unknown> = { approval_status: transition.to };
    if (transition.setTimestamp === 'approved_at') {
      updatePayload.approved_at = new Date().toISOString();
    } else if (transition.setTimestamp === 'committed_at') {
      updatePayload.committed_at = new Date().toISOString();
      updatePayload.committed_by = user.id;
    } else if (action === 'stage') {
      // Reset timestamps when going back to pending.
      updatePayload.approved_at = null;
      updatePayload.committed_at = null;
    }
    const { data, error } = await supabase
      .from('recovery_actions')
      .update(updatePayload)
      .in('id', eligible)
      .eq('user_id', user.id)
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    updated = (data ?? []) as Array<{ id: string }>;
  }

  return NextResponse.json({
    action,
    requested: ids.length,
    updated: updated.length,
    skipped,
  });
}
