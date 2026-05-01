import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth/get-user';
import { createServiceClient } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/test
 * Body: { email: string }
 *
 * Fires a one-shot test email to a recipient via Resend so the user
 * can confirm the address actually receives notifications. On success
 * we mark that recipient as `verified` in notification_settings so the
 * UI can show a green badge.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let email: string;
  try {
    const body = await request.json();
    email = (body.email || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM || 'ConfigCheck <onboarding@resend.dev>';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (!resendKey) {
    return NextResponse.json(
      { error: 'Email sending is not configured. Ask the admin to set RESEND_API_KEY.' },
      { status: 503 },
    );
  }

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;padding:24px;background:#f6f8fb;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
      <div style="font-size:14px;font-weight:600;color:#5b9bf3;letter-spacing:.04em;text-transform:uppercase;">ConfigCheck</div>
      <h1 style="margin:8px 0 16px;font-size:22px;color:#0f172a;">Test notification</h1>
      <p style="color:#475569;font-size:14px;line-height:1.5;">
        This is a one-time test message from ConfigCheck. If you're seeing this,
        notifications to <strong>${email}</strong> are working correctly. You'll
        receive real notifications here when scans complete or critical issues
        are found.
      </p>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
        Sent at ${new Date().toUTCString()}.<br/>
        Manage notifications: <a href="${appUrl}/settings?tab=notifications" style="color:#5b9bf3;">${appUrl}/settings</a>
      </p>
    </div>
  </body></html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [email],
        subject: 'ConfigCheck — test notification',
        html,
      }),
    });
    const responseBody = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `Resend rejected the send: ${responseBody.slice(0, 240)}` },
        { status: 502 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Send failed' },
      { status: 500 },
    );
  }

  // Mark this recipient as verified in notification_settings so the UI
  // can show the green badge. Done best-effort — a successful send is
  // the primary signal; verification flag is just visual.
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('users')
      .select('notification_settings')
      .eq('id', user.id)
      .maybeSingle();
    const settings = (data?.notification_settings as { recipients?: Array<{ email: string; verified?: boolean; last_notified_at?: string | null }> } | null) || {};
    const recipients = Array.isArray(settings.recipients) ? [...settings.recipients] : [];
    const idx = recipients.findIndex((r) => r.email === email);
    const now = new Date().toISOString();
    if (idx >= 0) {
      recipients[idx] = { ...recipients[idx], verified: true, last_notified_at: now };
    } else {
      recipients.push({ email, verified: true, last_notified_at: now });
    }
    await supabase
      .from('users')
      .update({ notification_settings: { ...settings, recipients } })
      .eq('id', user.id);
  } catch (err) {
    console.error('[notifications/test] failed to record verification:', err);
  }

  return NextResponse.json({ success: true });
}
