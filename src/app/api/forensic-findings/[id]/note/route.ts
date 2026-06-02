/**
 * PATCH /api/forensic-findings/[id]/note
 *
 * Updates the consultant_note on a finding. Body: { note: string | null }.
 * Empty string or null clears the note.
 *
 * The note is PRIVATE to the consultant — never auto-shared with the
 * client unless explicitly included in the PDF deliverable later. So
 * we don't need any sharing/visibility flags; just user-id auth.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

const MAX_NOTE_LENGTH = 4000;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const raw = (body as { note?: unknown })?.note;
  // Accept string or null; reject other types so we don't store nested
  // JSON, objects, etc. that would round-trip wrong.
  if (raw !== null && typeof raw !== 'string') {
    return NextResponse.json({ error: 'note must be a string or null' }, { status: 400 });
  }
  // Coalesce empty/whitespace string to null — UI treats both as 'no
  // note' so the DB should reflect that consistently.
  const cleaned: string | null =
    raw === null ? null : raw.trim() === '' ? null : raw.slice(0, MAX_NOTE_LENGTH);

  const supabase = createServiceClient();
  const updatedAt = cleaned === null ? null : new Date().toISOString();
  const { error } = await supabase
    .from('forensic_findings')
    .update({
      consultant_note: cleaned,
      consultant_note_updated_at: updatedAt,
    })
    .eq('id', params.id)
    .eq('user_id', user.id);
  if (error) {
    console.error('[forensic-findings/note] update failed:', error);
    return NextResponse.json({ error: 'Failed to save note' }, { status: 500 });
  }

  return NextResponse.json({
    id: params.id,
    consultant_note: cleaned,
    consultant_note_updated_at: updatedAt,
  });
}
