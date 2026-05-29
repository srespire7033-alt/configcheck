import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/avatar — multipart upload of the current user's profile
 *   image. Validates type + size, writes to the `avatars` Supabase Storage
 *   bucket under <userId>/avatar-<ts>.<ext>, then patches users.avatar_url.
 *   Existing avatar files for the user are deleted on success so a heavy
 *   user doesn't accumulate orphans.
 *
 * DELETE /api/auth/avatar — clears avatar_url and removes the user's
 *   files from storage. Use case: revert to initials.
 *
 * Auth is enforced via getAuthUser (Supabase cookie session). Writes use
 * the service-role client because:
 *   - the avatars bucket has RLS that ties uploads to auth.uid() — that
 *     would also work, but we already have a service client throughout
 *     the codebase and validating in the route gives consistent error
 *     responses;
 *   - we want to atomically delete previous-version files in the user's
 *     folder regardless of who owned them.
 */

// Whitelist mirrors the storage bucket's allowed_mime_types so users
// don't upload PDFs/SVGs that the browser would render weirdly. WebP +
// GIF are allowed; SVG is excluded on purpose (vector + inline scripts
// are an XSS surface and Supabase Storage doesn't sanitize on serve).
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

function extFromContentType(ct: string): string {
  if (ct === 'image/png') return 'png';
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'jpg';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/gif') return 'gif';
  return 'bin';
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get('file');
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ error: 'No file provided in `file` field' }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type "${file.type}". Use PNG, JPG, WebP, or GIF.` },
      { status: 415 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 2 MB.` },
      { status: 413 }
    );
  }

  const supabase = createServiceClient();

  // Path convention: avatars bucket → <userId>/avatar-<ts>.<ext>. Including
  // the timestamp in the filename guarantees the public URL changes on
  // every upload, so browsers don't serve a stale cached image after a
  // change.
  const ext = extFromContentType(file.type);
  const ts = Date.now();
  const path = `${user.id}/avatar-${ts}.${ext}`;

  // Sweep previous files in this user's folder first so we don't leak
  // storage when someone re-uploads. Errors here are non-fatal — the new
  // upload still wins.
  try {
    const { data: existing } = await supabase.storage.from('avatars').list(user.id, { limit: 100 });
    if (existing && existing.length > 0) {
      const paths = existing.map((o) => `${user.id}/${o.name}`);
      await supabase.storage.from('avatars').remove(paths);
    }
  } catch (err) {
    console.error('[avatar] previous-file sweep failed (non-fatal):', err);
  }

  // Upload the new file
  const arrayBuf = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(path, new Uint8Array(arrayBuf), {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    });
  if (uploadErr) {
    console.error('[avatar] upload failed:', uploadErr);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }

  // Get public URL and persist to users.avatar_url
  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  const avatarUrl = pub?.publicUrl;
  if (!avatarUrl) {
    return NextResponse.json({ error: 'Could not resolve public URL' }, { status: 500 });
  }

  const { error: updateErr } = await supabase
    .from('users')
    .update({ avatar_url: avatarUrl })
    .eq('id', user.id);
  if (updateErr) {
    console.error('[avatar] users.avatar_url update failed:', updateErr);
    return NextResponse.json({ error: 'Failed to save avatar URL' }, { status: 500 });
  }

  return NextResponse.json(
    { success: true, avatar_url: avatarUrl },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();

  // Wipe storage files for this user
  try {
    const { data: existing } = await supabase.storage.from('avatars').list(user.id, { limit: 100 });
    if (existing && existing.length > 0) {
      const paths = existing.map((o) => `${user.id}/${o.name}`);
      await supabase.storage.from('avatars').remove(paths);
    }
  } catch (err) {
    console.error('[avatar] delete sweep failed (non-fatal):', err);
  }

  // Clear the column
  await supabase.from('users').update({ avatar_url: null }).eq('id', user.id);

  return NextResponse.json({ success: true });
}
