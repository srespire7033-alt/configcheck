/**
 * POST   /api/forensic-findings/[id]/hide   — toggles hidden_at off↔on.
 * DELETE /api/forensic-findings/[id]/hide   — explicit unhide (clears hidden_at).
 *
 * 'Hidden' is a UX-noise concept (consultant dismisses a known false-
 * positive per-engagement), separate from status (open/resolved). A
 * hidden finding still exists in the DB and on the recovery queue if
 * it was already staged — it just disappears from default dashboard
 * counts and finding lists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

async function loadFinding(supabase: ReturnType<typeof createServiceClient>, id: string, userId: string) {
  const { data, error } = await supabase
    .from('forensic_findings')
    .select('id, hidden_at')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  return { data, error };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: finding, error: loadErr } = await loadFinding(supabase, params.id, user.id);
  if (loadErr || !finding) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 });
  }

  // Toggle: if hidden, unhide; if visible, hide.
  const nextHiddenAt = finding.hidden_at ? null : new Date().toISOString();

  const { error: updateErr } = await supabase
    .from('forensic_findings')
    .update({ hidden_at: nextHiddenAt })
    .eq('id', params.id)
    .eq('user_id', user.id);
  if (updateErr) {
    console.error('[forensic-findings/hide] update failed:', updateErr);
    return NextResponse.json({ error: 'Failed to update finding' }, { status: 500 });
  }

  return NextResponse.json({
    id: params.id,
    hidden: nextHiddenAt !== null,
    hidden_at: nextHiddenAt,
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  // Explicit unhide — exists so the UI's 'restore' button has a clean,
  // intention-revealing route to call rather than re-using POST.
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();
  const { error: updateErr } = await supabase
    .from('forensic_findings')
    .update({ hidden_at: null })
    .eq('id', params.id)
    .eq('user_id', user.id);
  if (updateErr) {
    console.error('[forensic-findings/hide DELETE] update failed:', updateErr);
    return NextResponse.json({ error: 'Failed to restore finding' }, { status: 500 });
  }

  return NextResponse.json({ id: params.id, hidden: false, hidden_at: null });
}
