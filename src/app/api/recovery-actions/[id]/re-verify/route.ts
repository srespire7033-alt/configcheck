import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { createRefreshableConnection } from '@/lib/salesforce/client';
import { verifyCommit } from '@/lib/forensics/commit-verifier';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/recovery-actions/[id]/re-verify
 *
 * Re-runs the per-detector commit verifier against the affected
 * Salesforce record. Updates metadata.commit_verification but does
 * NOT change approval_status — this is "I uploaded a fix; check
 * again," not a state transition.
 *
 * Returns the fresh verification result so the UI can update inline.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(_req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();

  // Load action + its finding + the finding's org for the connection.
  const { data: action, error } = await supabase
    .from('recovery_actions')
    .select('id, finding_id, metadata, forensic_findings!inner(id, detector_id, organization_id, source_record_refs, metadata)')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();
  if (error || !action) {
    return NextResponse.json({ error: 'Recovery action not found' }, { status: 404 });
  }

  const finding = (action as unknown as {
    forensic_findings: {
      id: string;
      detector_id: string;
      organization_id: string;
      source_record_refs: unknown;
      metadata: unknown;
    };
  }).forensic_findings;

  // Open a connection to the finding's org.
  let conn;
  try {
    ({ conn } = await createRefreshableConnection(finding.organization_id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Connection failed';
    return NextResponse.json(
      { error: `Could not connect to Salesforce: ${msg}` },
      { status: 502 }
    );
  }

  const verif = await verifyCommit(
    {
      id: finding.id,
      detector_id: finding.detector_id,
      source_record_refs: finding.source_record_refs,
      metadata: finding.metadata,
    },
    conn
  );

  if (!verif) {
    return NextResponse.json(
      { error: `No verifier available for detector ${finding.detector_id}` },
      { status: 400 }
    );
  }

  // Merge into existing metadata so we don't clobber other keys.
  const existingMeta = (action.metadata as Record<string, unknown> | null) ?? {};
  const newMeta = { ...existingMeta, commit_verification: verif };
  await supabase
    .from('recovery_actions')
    .update({ metadata: newMeta })
    .eq('id', params.id)
    .eq('user_id', user.id);

  return NextResponse.json({ verification: verif });
}
