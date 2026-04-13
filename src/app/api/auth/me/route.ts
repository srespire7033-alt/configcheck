import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 * Get current user profile
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, email, company_name, company_logo_url, report_branding_color, plan, email_notifications_enabled, created_at')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}

/**
 * PUT /api/auth/me
 * Update user profile (company name, branding)
 */
export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.company_name !== undefined) {
      updates.company_name = body.company_name;
    }
    if (body.report_branding_color !== undefined) {
      updates.report_branding_color = body.report_branding_color;
    }
    if (body.company_logo_url !== undefined) {
      updates.company_logo_url = body.company_logo_url;
    }
    if (body.email_notifications_enabled !== undefined) {
      updates.email_notifications_enabled = body.email_notifications_enabled;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', user.id);

    if (error) {
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
