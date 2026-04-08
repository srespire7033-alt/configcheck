import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logo
 * Upload company logo to Supabase Storage
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('logo') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Only PNG, SVG, JPEG, and WebP files are allowed' }, { status: 400 });
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'File must be under 2MB' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Create bucket if it doesn't exist (idempotent)
    await supabase.storage.createBucket('logos', {
      public: true,
      fileSizeLimit: 2 * 1024 * 1024,
      allowedMimeTypes: allowedTypes,
    });

    // Upload file with user ID as filename
    const ext = file.name.split('.').pop() || 'png';
    const fileName = `${user.id}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true, // Overwrite if exists
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('logos')
      .getPublicUrl(fileName);

    const logoUrl = urlData.publicUrl;

    // Save URL to user profile
    await supabase
      .from('users')
      .update({ company_logo_url: logoUrl })
      .eq('id', user.id);

    return NextResponse.json({ url: logoUrl });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    console.error('Logo upload error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
