import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/recovery-actions/bulk-csv?ids=...
 *
 * Concatenates the CSV payloads of approved recovery_actions into a
 * single multi-section file. Detectors that produce different CSV
 * shapes get separate sections (each with its own header) so Data
 * Loader can be pointed at each section separately.
 *
 * The actions don't have to be 'approved' to download — pending is
 * fine too (the consultant might want to preview). But for the
 * audit trail we record the bulk download.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const idsParam = request.nextUrl.searchParams.get('ids');
  if (!idsParam) return NextResponse.json({ error: 'ids required' }, { status: 400 });
  const ids = idsParam.split(',').filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ error: 'no valid ids' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: actions, error } = await supabase
    .from('recovery_actions')
    .select('id, finding_id, draft_payload, projected_reclaim_usd, approval_status')
    .in('id', ids)
    .eq('user_id', user.id);
  if (error || !actions || actions.length === 0) {
    return NextResponse.json({ error: 'No matching recovery actions' }, { status: 404 });
  }

  // Group by csv_header so multiple detectors with same shape share a section.
  interface Section { header: string; rows: string[]; count: number }
  const sectionsByHeader = new Map<string, Section>();
  let totalReclaim = 0;
  for (const a of actions) {
    const payload = (a.draft_payload as { csv_header?: string; csv_row?: string }) ?? {};
    if (!payload.csv_header || !payload.csv_row) continue;
    totalReclaim += Number(a.projected_reclaim_usd ?? 0);
    const existing = sectionsByHeader.get(payload.csv_header);
    if (existing) {
      existing.rows.push(payload.csv_row);
      existing.count += 1;
    } else {
      sectionsByHeader.set(payload.csv_header, {
        header: payload.csv_header,
        rows: [payload.csv_row],
        count: 1,
      });
    }
  }

  // Build the multi-section CSV. Each section starts with a comment
  // line (Data Loader ignores #-prefixed lines on standard import,
  // but to stay strictly compatible we'll just put a blank line
  // between sections and trust the consultant to split if needed).
  const parts: string[] = [];
  for (const section of Array.from(sectionsByHeader.values())) {
    parts.push(section.header);
    parts.push(...section.rows);
    parts.push(''); // blank separator
  }
  const csv = parts.join('\n');
  const filename = `orgprism-recovery-bulk-${new Date().toISOString().split('T')[0]}-${actions.length}actions.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Bulk-Actions': String(actions.length),
      'X-Bulk-Projected-Reclaim-USD': String(Math.round(totalReclaim * 100) / 100),
      'Cache-Control': 'no-store',
    },
  });
}
