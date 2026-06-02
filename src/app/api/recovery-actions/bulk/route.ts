import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { createRefreshableConnection } from '@/lib/salesforce/client';
import { verifyCommit } from '@/lib/forensics/commit-verifier';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  // 'stage' also accepts 'committed' so a user who hit Verify Failed on
  // the Committed tab can take the action back to Pending and redo the
  // entire upload flow. Timestamps reset so the audit trail reflects
  // the retry as a fresh attempt.
  stage:   { from: ['rejected', 'expired', 'committed'], to: 'pending' },
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
  let verifications: Array<{
    actionId: string;
    findingId: string;
    detectorId: string;
    verified: boolean;
    message: string;
  }> = [];
  if (eligible.length > 0) {
    // For commit transitions, run per-finding Salesforce verification
    // BEFORE updating the row so we can store the verification result
    // on metadata in a single write. v2 auto-attestation: we don't
    // block the commit on failure, but we surface it in the UI.
    let verificationByActionId: Map<string, { verified: boolean; verified_at: string; expected_value: string | number | null; actual_value: string | number | null; message: string }> | null = null;
    if (action === 'commit') {
      verificationByActionId = await runCommitVerifications(supabase, user.id, eligible);
      verifications = Array.from(verificationByActionId.entries()).map(([actionId, v]) => ({
        actionId,
        findingId: '',
        detectorId: '',
        verified: v.verified,
        message: v.message,
      }));
    }

    const nowIso = new Date().toISOString();
    // We update each row individually for the commit path so we can
    // merge the per-action verification result into its metadata. For
    // other transitions we batch — single UPDATE.
    if (action === 'commit' && verificationByActionId) {
      for (const id of eligible) {
        const verif = verificationByActionId.get(id);
        // Read existing metadata so we don't clobber other keys.
        const { data: row } = await supabase
          .from('recovery_actions')
          .select('metadata')
          .eq('id', id)
          .single();
        const existingMeta = (row?.metadata as Record<string, unknown> | null) ?? {};
        const newMeta = verif ? { ...existingMeta, commit_verification: verif } : existingMeta;
        const { data, error } = await supabase
          .from('recovery_actions')
          .update({
            approval_status: 'committed',
            committed_at: nowIso,
            committed_by: user.id,
            metadata: newMeta,
          })
          .eq('id', id)
          .eq('user_id', user.id)
          .select('id')
          .single();
        if (error) {
          // Don't bail on the whole batch — report per-id success/skip downstream.
          skipped.push({ id, reason: `commit_update_failed: ${error.message}` });
          continue;
        }
        if (data) updated.push(data as { id: string });
      }
    } else {
      const updatePayload: Record<string, unknown> = { approval_status: transition.to };
      if (transition.setTimestamp === 'approved_at') {
        updatePayload.approved_at = nowIso;
      } else if (action === 'stage') {
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
  }

  return NextResponse.json({
    action,
    requested: ids.length,
    updated: updated.length,
    skipped,
    verifications: verifications.length > 0 ? verifications : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Commit verification helper
// ─────────────────────────────────────────────────────────────────────

type SupabaseSrv = ReturnType<typeof createServiceClient>;

/**
 * For each recovery_action being committed, look up the finding +
 * its org, open a connection, run the per-detector verifier. Returns
 * a map of actionId → verification result so the caller can merge
 * into metadata.
 *
 * Groups by org so we don't open one connection per action. Failures
 * for any single action are isolated — they don't take down the
 * whole batch.
 */
async function runCommitVerifications(
  supabase: SupabaseSrv,
  userId: string,
  actionIds: string[]
): Promise<Map<string, {
  verified: boolean;
  verified_at: string;
  expected_value: string | number | null;
  actual_value: string | number | null;
  message: string;
}>> {
  const result = new Map<string, {
    verified: boolean;
    verified_at: string;
    expected_value: string | number | null;
    actual_value: string | number | null;
    message: string;
  }>();

  // Pull the actions + their findings + the finding's org.
  const { data: actionsWithFindings } = await supabase
    .from('recovery_actions')
    .select('id, finding_id, forensic_findings!inner(id, detector_id, organization_id, source_record_refs, metadata)')
    .in('id', actionIds)
    .eq('user_id', userId);

  type Row = {
    id: string;
    finding_id: string;
    forensic_findings: {
      id: string;
      detector_id: string;
      organization_id: string;
      source_record_refs: unknown;
      metadata: unknown;
    };
  };
  const rows = (actionsWithFindings as unknown as Row[] | null) ?? [];

  // Group by organization_id so each org opens one connection.
  const byOrg = new Map<string, Row[]>();
  for (const row of rows) {
    const orgId = row.forensic_findings.organization_id;
    const list = byOrg.get(orgId) ?? [];
    list.push(row);
    byOrg.set(orgId, list);
  }

  for (const orgIdKey of Array.from(byOrg.keys())) {
    const orgRows = byOrg.get(orgIdKey)!;
    let conn;
    try {
      ({ conn } = await createRefreshableConnection(orgIdKey));
    } catch (e) {
      // Org connection failed — mark all its actions as 'verification
      // not possible.' jsforce can throw an Error with empty .message
      // when a refresh token has been revoked; guard for that so the
      // DB note doesn't end in a dangling colon.
      console.error(`[recovery-actions/bulk] Salesforce connection failed for org ${orgIdKey}:`, e);
      const rawMsg = e instanceof Error ? e.message.trim() : '';
      const userMsg = rawMsg
        ? `Verification skipped — couldn't reach Salesforce: ${rawMsg}. Reconnect from org settings.`
        : `Verification skipped — Salesforce session may have expired. Reconnect from org settings.`;
      for (const row of orgRows) {
        result.set(row.id, {
          verified: false,
          verified_at: new Date().toISOString(),
          expected_value: null,
          actual_value: null,
          message: userMsg,
        });
      }
      continue;
    }

    for (const row of orgRows) {
      try {
        const verif = await verifyCommit(
          {
            id: row.forensic_findings.id,
            detector_id: row.forensic_findings.detector_id,
            source_record_refs: row.forensic_findings.source_record_refs,
            metadata: row.forensic_findings.metadata,
          },
          conn
        );
        if (verif) {
          result.set(row.id, verif);
        } else {
          result.set(row.id, {
            verified: false,
            verified_at: new Date().toISOString(),
            expected_value: null,
            actual_value: null,
            message: `No verifier available for detector ${row.forensic_findings.detector_id} — manual review only.`,
          });
        }
      } catch (e) {
        result.set(row.id, {
          verified: false,
          verified_at: new Date().toISOString(),
          expected_value: null,
          actual_value: null,
          message: `Verification error: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  return result;
}
