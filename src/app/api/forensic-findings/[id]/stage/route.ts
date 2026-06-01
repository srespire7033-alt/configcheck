import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { buildRecoveryPayload } from '@/lib/forensics/recovery-payload';

export const dynamic = 'force-dynamic';

/**
 * POST /api/forensic-findings/[id]/stage
 *
 * Stages a finding for recovery — creates a pending recovery_action row
 * with the CSV payload computed at stage time (so future data shifts
 * don't change what the consultant approved).
 *
 * Idempotent: re-staging a finding that already has a pending/approved
 * action returns the existing row instead of creating a duplicate.
 * Re-staging a rejected action lets the consultant 'un-reject' by
 * resetting it to pending.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(_request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: finding, error } = await supabase
    .from('forensic_findings')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();
  if (error || !finding) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 });
  }

  // Look for an existing action on this finding. Idempotency rules:
  //   pending   → return as-is (no duplicate)
  //   approved  → return as-is (can't un-approve via stage)
  //   committed → return as-is (terminal)
  //   rejected  → reset to pending (user un-rejected)
  //   expired   → reset to pending
  const { data: existing } = await supabase
    .from('recovery_actions')
    .select('*')
    .eq('finding_id', finding.id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    if (['pending', 'approved', 'committed'].includes(existing.approval_status as string)) {
      return NextResponse.json({ action: existing, status: 'already_staged' });
    }
    // Rejected or expired → reset.
    const { data: updated, error: updateErr } = await supabase
      .from('recovery_actions')
      .update({ approval_status: 'pending', approved_at: null, committed_at: null })
      .eq('id', existing.id)
      .select()
      .single();
    if (updateErr || !updated) {
      return NextResponse.json({ error: 'Failed to reset action' }, { status: 500 });
    }
    return NextResponse.json({ action: updated, status: 'reset_to_pending' });
  }

  // Fresh stage — compute payload + insert.
  const payload = buildRecoveryPayload({
    id: finding.id as string,
    detector_id: finding.detector_id as string,
    gap_usd: Number(finding.gap_usd ?? 0),
    recoverability_score: Number(finding.recoverability_score ?? 1),
    currency_iso_code: (finding.currency_iso_code as string) ?? 'USD',
    title: (finding.title as string) ?? '',
    description: (finding.description as string | null) ?? null,
    source_record_refs: finding.source_record_refs,
    metadata: finding.metadata,
  });

  const { data: created, error: insertErr } = await supabase
    .from('recovery_actions')
    .insert({
      finding_id: finding.id,
      user_id: user.id,
      action_type: 'csv_export',
      approval_status: 'pending',
      draft_payload: {
        csv_header: payload.csvHeader,
        csv_row: payload.csvRow,
        action_label: payload.actionLabel,
        filename: payload.filename,
      },
      projected_reclaim_usd: payload.projectedReclaimUsd,
    })
    .select()
    .single();
  if (insertErr || !created) {
    return NextResponse.json({ error: 'Failed to stage action' }, { status: 500 });
  }
  return NextResponse.json({ action: created, status: 'staged' });
}
