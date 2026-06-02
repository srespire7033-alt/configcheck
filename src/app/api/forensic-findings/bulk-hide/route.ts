/**
 * POST   /api/forensic-findings/bulk-hide   — hide many findings at once
 * DELETE /api/forensic-findings/bulk-hide   — bulk restore (unhide)
 *
 * Body: { findingIds: string[] }
 *
 * Atomic single-roundtrip equivalent of calling /[id]/hide N times.
 * Used by the BulkActionBar when a consultant selects multiple
 * findings in a review session and dismisses them in one click.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

const MAX_BATCH = 500;

function parseFindingIds(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { findingIds?: unknown }).findingIds;
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((x): x is string => typeof x === 'string');
  if (ids.length === 0 || ids.length > MAX_BATCH) return null;
  return ids;
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const ids = parseFindingIds(body);
  if (!ids) {
    return NextResponse.json(
      { error: `findingIds must be a string[] of length 1–${MAX_BATCH}` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const { error, count } = await supabase
    .from('forensic_findings')
    .update({ hidden_at: now }, { count: 'exact' })
    .in('id', ids)
    .eq('user_id', user.id)
    // Only hide ones that aren't already hidden so the count returns
    // 'how many we actually changed' (not 'how many matched the IN').
    .is('hidden_at', null);
  if (error) {
    console.error('[bulk-hide] update failed:', error);
    return NextResponse.json({ error: 'Failed to hide findings' }, { status: 500 });
  }

  return NextResponse.json({
    requested: ids.length,
    hidden: count ?? 0,
    already_hidden: ids.length - (count ?? 0),
  });
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const ids = parseFindingIds(body);
  if (!ids) {
    return NextResponse.json(
      { error: `findingIds must be a string[] of length 1–${MAX_BATCH}` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { error, count } = await supabase
    .from('forensic_findings')
    .update({ hidden_at: null }, { count: 'exact' })
    .in('id', ids)
    .eq('user_id', user.id)
    .not('hidden_at', 'is', null);
  if (error) {
    console.error('[bulk-hide DELETE] update failed:', error);
    return NextResponse.json({ error: 'Failed to restore findings' }, { status: 500 });
  }

  return NextResponse.json({ requested: ids.length, restored: count ?? 0 });
}
