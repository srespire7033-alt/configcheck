import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/forensic-findings/[id]/recovery-csv
 *
 * Generates a Data-Loader-friendly CSV with the records to remediate plus
 * suggested new values per record. The user reviews + uploads in Data
 * Loader themselves — keeps us out of the data-corruption blast zone for
 * v1. v2 will swap this for direct write via Composite REST behind the
 * same "approve" UX.
 *
 * Also records a recovery_actions row (action_type='csv_export', status
 * 'approved') so we can audit later who exported what.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: finding, error } = await supabase
    .from('forensic_findings')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();
  if (error || !finding) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Build the CSV. Per-detector schema since different findings imply
  // different remediation shapes. For REN-001, the recovery is a price
  // patch on the renewal Quote Line.
  let csv: string;
  let filename: string;
  const refs = (finding.source_record_refs ?? {}) as {
    primary_record?: { type: string; id: string; name: string; financials?: Record<string, number | string> };
    supporting_records?: Array<{ type: string; id: string; name: string; financials?: Record<string, number | string> }>;
  };
  const meta = (finding.metadata ?? {}) as Record<string, unknown>;

  if (finding.detector_id === 'REN-001') {
    const upliftPct = (meta.uplift_pct_entitled as number) ?? 0;
    const originalPerUnit = (meta.original_price_per_unit as number) ?? 0;
    const fraction = upliftPct > 1 ? upliftPct / 100 : upliftPct;
    const correctedPerUnit = originalPerUnit * (1 + fraction);
    const subscriptionRef = refs.supporting_records?.find((r) => r.type === 'SBQQ__Subscription__c');
    const contractRef = refs.supporting_records?.find((r) => r.type === 'Contract');

    csv = [
      // Data Loader compatible header row — match SF API field names.
      'Id,SBQQ__NetPrice__c,RecoveryNotes',
      [
        refs.primary_record?.id ?? '',
        correctedPerUnit.toFixed(2),
        `"Corrected per-unit price = original ${originalPerUnit} × (1 + ${upliftPct}% uplift entitled by Contract ${contractRef?.name ?? ''}, Subscription ${subscriptionRef?.name ?? ''})"`,
      ].join(','),
    ].join('\n');
    filename = `recovery-REN-001-${refs.primary_record?.name ?? params.id}.csv`;
  } else {
    // Generic shape for detectors we haven't customized yet.
    csv = [
      'Id,RecordType,Title,GapUsd,Currency,Notes',
      [
        refs.primary_record?.id ?? '',
        refs.primary_record?.type ?? '',
        `"${finding.title}"`,
        finding.gap_usd,
        finding.currency_iso_code,
        `"${finding.description ?? ''}"`,
      ].join(','),
    ].join('\n');
    filename = `recovery-${finding.detector_id}-${params.id}.csv`;
  }

  // Audit: record the export. We don't block on the insert — UX is
  // download-first, audit after.
  void supabase
    .from('recovery_actions')
    .insert({
      finding_id: finding.id,
      user_id: user.id,
      action_type: 'csv_export',
      draft_payload: { csv_filename: filename, gap_usd: finding.gap_usd },
      projected_reclaim_usd: finding.gap_usd,
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .then(() => {});

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
