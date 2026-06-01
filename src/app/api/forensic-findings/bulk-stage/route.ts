import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { buildRecoveryPayload } from '@/lib/forensics/recovery-payload';

export const dynamic = 'force-dynamic';

/**
 * POST /api/forensic-findings/bulk-stage
 * Body: { findingIds: string[] }
 *
 * Stages multiple findings for recovery in one call. The attribution-
 * map "Stage all N" button hits this. Returns per-finding result so
 * the UI can report partial success (e.g., some already staged).
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { findingIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const findingIds = Array.isArray(body.findingIds)
    ? body.findingIds.filter((s): s is string => typeof s === 'string')
    : [];
  if (findingIds.length === 0) return NextResponse.json({ error: 'findingIds required' }, { status: 400 });

  const supabase = createServiceClient();

  // Pull all findings + existing recovery actions in two queries.
  const [{ data: findings }, { data: existingActions }] = await Promise.all([
    supabase
      .from('forensic_findings')
      .select('*')
      .in('id', findingIds)
      .eq('user_id', user.id),
    supabase
      .from('recovery_actions')
      .select('id, finding_id, approval_status')
      .in('finding_id', findingIds)
      .eq('user_id', user.id),
  ]);

  const existingByFindingId = new Map<string, { id: string; approval_status: string }>();
  for (const a of existingActions ?? []) {
    existingByFindingId.set(
      a.finding_id as string,
      { id: a.id as string, approval_status: a.approval_status as string }
    );
  }

  let staged = 0;
  let alreadyStaged = 0;
  let reset = 0;
  const errors: Array<{ findingId: string; reason: string }> = [];

  for (const finding of findings ?? []) {
    const existing = existingByFindingId.get(finding.id as string);
    if (existing && ['pending', 'approved', 'committed'].includes(existing.approval_status)) {
      alreadyStaged += 1;
      continue;
    }
    if (existing && ['rejected', 'expired'].includes(existing.approval_status)) {
      const { error } = await supabase
        .from('recovery_actions')
        .update({ approval_status: 'pending', approved_at: null, committed_at: null })
        .eq('id', existing.id);
      if (error) {
        errors.push({ findingId: finding.id as string, reason: error.message });
      } else {
        reset += 1;
      }
      continue;
    }
    // Fresh stage.
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
    const { error } = await supabase.from('recovery_actions').insert({
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
    });
    if (error) {
      // 23505 = unique violation from the partial unique index. Means
      // a concurrent stage already created an active row — treat as
      // 'already staged' rather than erroring.
      if ((error as { code?: string }).code === '23505') {
        alreadyStaged += 1;
      } else {
        errors.push({ findingId: finding.id as string, reason: error.message });
      }
    } else {
      staged += 1;
    }
  }

  return NextResponse.json({
    requested: findingIds.length,
    staged,
    already_staged: alreadyStaged,
    reset,
    errors,
  });
}
