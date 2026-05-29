import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 * Get current user profile
 */
export async function GET(request: NextRequest) {
  const limiter = rateLimit(request, { maxRequests: 60, windowMs: 60_000 });
  if (!limiter.success) return rateLimitResponse(limiter);

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, phone, job_title, location, company_name, company_logo_url, report_branding_color, timezone, plan, is_admin, email_notifications_enabled, notification_emails, notification_settings, onboarding_completed, referral_source, role, company_size, checklist_dismissed, checklist_progress, revenue_assumptions, created_at')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}

/**
 * PUT /api/auth/me
 * Update user profile (company name, branding)
 */
export async function PUT(request: NextRequest) {
  const limiter = rateLimit(request, { maxRequests: 60, windowMs: 60_000 });
  if (!limiter.success) return rateLimitResponse(limiter);

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
      'notification_settings',
      'onboarding_completed', 'referral_source', 'role', 'company_size',
      'checklist_dismissed', 'checklist_progress',
      'revenue_assumptions',
    ];

    // Sanitize revenue_assumptions to known shape so we don't accept
    // arbitrary JSON into the column.
    if (body.revenue_assumptions !== undefined) {
      const ra = body.revenue_assumptions;
      if (ra === null) {
        updates.revenue_assumptions = null;
      } else if (typeof ra === 'object' && ra !== null) {
        const validIndustries = ['saas', 'manufacturing', 'services', 'financial', 'b2c', 'other'];
        const cleaned: Record<string, unknown> = {};
        if (typeof ra.industry === 'string' && validIndustries.includes(ra.industry)) {
          cleaned.industry = ra.industry;
        }
        if (typeof ra.use_median === 'boolean') {
          cleaned.use_median = ra.use_median;
        }
        if (typeof ra.confidence_min_sample === 'number' && ra.confidence_min_sample > 0) {
          cleaned.confidence_min_sample = Math.floor(ra.confidence_min_sample);
        }
        updates.revenue_assumptions = Object.keys(cleaned).length > 0 ? cleaned : null;
      } else {
        return NextResponse.json({ error: 'revenue_assumptions must be an object or null' }, { status: 400 });
      }
    }
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
    const { data: updated, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', user.id)
      .select('id, email, full_name, phone, job_title, location, company_name, company_logo_url, report_branding_color, timezone, plan, is_admin, email_notifications_enabled, notification_emails, notification_settings, onboarding_completed, referral_source, role, company_size, checklist_dismissed, checklist_progress, revenue_assumptions, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }

    return NextResponse.json({ success: true, user: updated }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
