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
    .select('id, email, full_name, phone, job_title, location, company_name, company_logo_url, report_branding_color, timezone, plan, email_notifications_enabled, notification_emails, created_at')
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

    const allowedFields = [
      'full_name', 'phone', 'job_title', 'location',
      'company_name', 'company_logo_url', 'report_branding_color',
      'timezone', 'email_notifications_enabled', 'notification_emails',
    ];
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    // Validate notification_emails: max 5, valid email format
    if (updates.notification_emails) {
      const emails = updates.notification_emails as string[];
      if (!Array.isArray(emails) || emails.length > 5) {
        return NextResponse.json({ error: 'Maximum 5 notification emails allowed' }, { status: 400 });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const e of emails) {
        if (!emailRegex.test(e)) {
          return NextResponse.json({ error: `Invalid email: ${e}` }, { status: 400 });
        }
      }
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
