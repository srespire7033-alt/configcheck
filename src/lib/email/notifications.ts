import { createServiceClient } from '@/lib/db/client';

interface ScanNotificationData {
  scanId: string;
  orgId: string;
  orgName: string;
  overallScore: number;
  totalIssues: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  topIssues?: Array<{ title: string; severity: string }>;
  status: 'completed' | 'failed';
  errorMessage?: string;
}

/**
 * Send scan completion notification email.
 * Uses Resend if API key is available, otherwise logs to console.
 * Respects user's email notification preference.
 */
export async function sendScanNotification(userId: string, data: ScanNotificationData) {
  const supabase = createServiceClient();

  // Get user email, notification preference, and additional notification emails
  const { data: user, error } = await supabase
    .from('users')
    .select('email, full_name, email_notifications_enabled, notification_emails')
    .eq('id', userId)
    .single();

  if (error || !user?.email) {
    console.log(`[EMAIL] No email found for user ${userId}`, error?.message);
    return;
  }

  // Respect notification preference
  if (user.email_notifications_enabled === false) {
    console.log(`[EMAIL] Notifications disabled for ${user.email}, skipping`);
    return;
  }

  // Build recipient list: user's own email + any additional notification emails
  const recipients: string[] = [user.email];
  const extraEmails = (user.notification_emails as string[]) || [];
  for (const e of extraEmails) {
    if (e && !recipients.includes(e)) {
      recipients.push(e);
    }
  }

  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    console.log(`[EMAIL] ⚠️ RESEND_API_KEY not set — email would be sent to: ${recipients.join(', ')}`);
    console.log(`[EMAIL] Subject: Scan ${data.status} for ${data.orgName} | Score: ${data.overallScore}/100 | Issues: ${data.totalIssues}`);
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const name = user.full_name || 'there';

  // Resend free tier: use onboarding@resend.dev (can only send to account owner email)
  // Production: use verified domain email (e.g. notifications@configcheck.app)
  const fromAddress = process.env.EMAIL_FROM || 'ConfigCheck <onboarding@resend.dev>';

  const subject = data.status === 'completed'
    ? `ConfigCheck: ${data.orgName} scored ${data.overallScore}/100`
    : `ConfigCheck: Scan failed for ${data.orgName}`;

  const html = data.status === 'completed'
    ? buildCompletedEmail(name, data, appUrl)
    : buildFailedEmail(name, data, appUrl);

  try {
    console.log(`[EMAIL] Sending to ${recipients.join(', ')} from ${fromAddress}...`);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: fromAddress,
        to: recipients,
        subject,
        html,
      }),
    });

    const responseBody = await res.text();

    if (!res.ok) {
      console.error(`[EMAIL] ❌ Send failed (${res.status}):`, responseBody);
      throw new Error(`Email send failed (${res.status}): ${responseBody}`);
    } else {
      console.log(`[EMAIL] ✅ Sent to ${recipients.join(', ')}: ${subject}`);
      console.log(`[EMAIL] Resend response:`, responseBody);
    }
  } catch (err) {
    console.error('[EMAIL] ❌ Error:', err);
    throw err;
  }
}

/**
 * Send welcome email after signup.
 * Called from the onboarding completion flow.
 */
export async function sendWelcomeEmail(userId: string) {
  const supabase = createServiceClient();

  const { data: user, error } = await supabase
    .from('users')
    .select('email, full_name')
    .eq('id', userId)
    .single();

  if (error || !user?.email) {
    console.log(`[EMAIL] No email found for user ${userId}`, error?.message);
    return;
  }

  const resendKey = process.env.RESEND_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const name = user.full_name || 'there';
  const fromAddress = process.env.EMAIL_FROM || 'ConfigCheck <onboarding@resend.dev>';

  const subject = 'Welcome to ConfigCheck! 🚀';
  const html = buildWelcomeEmail(name, appUrl);

  if (!resendKey) {
    console.log(`[EMAIL] ⚠️ RESEND_API_KEY not set — welcome email would be sent to: ${user.email}`);
    console.log(`[EMAIL] Subject: ${subject}`);
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [user.email],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[EMAIL] ❌ Welcome email failed (${res.status}):`, body);
    } else {
      console.log(`[EMAIL] ✅ Welcome email sent to ${user.email}`);
    }
  } catch (err) {
    console.error('[EMAIL] ❌ Welcome email error:', err);
  }
}

function buildCompletedEmail(name: string, data: ScanNotificationData, appUrl: string): string {
  const scoreColor = data.overallScore >= 80 ? '#16a34a' : data.overallScore >= 60 ? '#d97706' : '#dc2626';
  const scoreBg = data.overallScore >= 80 ? '#f0fdf4' : data.overallScore >= 60 ? '#fffbeb' : '#fef2f2';
  const scoreLabel = data.overallScore >= 80 ? 'Healthy' : data.overallScore >= 60 ? 'Needs Attention' : 'Critical';

  const topIssuesHtml = data.topIssues && data.topIssues.length > 0
    ? `
      <div style="margin: 20px 0 0;">
        <p style="font-weight: 600; color: #1f2937; margin: 0 0 10px; font-size: 14px;">Top Issues to Address</p>
        ${data.topIssues.map(issue => `
          <div style="padding: 10px 14px; background: #ffffff; border-left: 3px solid ${issue.severity === 'critical' ? '#dc2626' : '#d97706'}; margin-bottom: 6px; border-radius: 0 6px 6px 0; border: 1px solid #e5e7eb; border-left: 3px solid ${issue.severity === 'critical' ? '#dc2626' : '#d97706'};">
            <span style="display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; margin-right: 8px; color: white; background: ${issue.severity === 'critical' ? '#dc2626' : '#d97706'};">${issue.severity}</span>
            <span style="color: #374151; font-size: 13px;">${issue.title}</span>
          </div>
        `).join('')}
      </div>
    `
    : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 0; background: #f9fafb;">
      <!-- Header -->
      <div style="background: #2563eb; padding: 28px 32px; border-radius: 12px 12px 0 0;">
        <table style="width: 100%;">
          <tr>
            <td>
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700;">⛨ ConfigCheck</h1>
              <p style="color: #bfdbfe; margin: 4px 0 0; font-size: 13px;">AI-Driven Config Audits for Salesforce Revenue Cloud</p>
            </td>
            <td style="text-align: right;">
              <span style="color: #bfdbfe; font-size: 12px;">Scan Complete ✓</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Body -->
      <div style="background: white; padding: 32px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #374151; margin: 0 0 20px; font-size: 15px;">Hi ${name},</p>
        <p style="color: #6b7280; margin: 0 0 24px; font-size: 14px;">Your health audit for <strong style="color: #1f2937;">${data.orgName}</strong> has completed. Here are the results:</p>

        <!-- Score -->
        <div style="text-align: center; margin: 24px 0;">
          <div style="display: inline-block; width: 100px; height: 100px; line-height: 100px; border-radius: 50%; background: ${scoreBg}; border: 3px solid ${scoreColor}; color: ${scoreColor}; font-size: 36px; font-weight: 800;">
            ${data.overallScore}
          </div>
          <p style="color: ${scoreColor}; margin: 8px 0 0; font-size: 14px; font-weight: 600;">${scoreLabel}</p>
          <p style="color: #6b7280; margin: 4px 0 0; font-size: 12px;">Health Score out of 100</p>
        </div>

        <!-- Issues breakdown -->
        <div style="background: #f9fafb; border-radius: 10px; padding: 18px 20px; margin: 24px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">Total Issues</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 700; font-size: 16px; color: #1f2937;">${data.totalIssues}</td>
            </tr>
            <tr style="border-top: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #dc2626; font-size: 13px;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #dc2626; margin-right: 6px;"></span>Critical
              </td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #dc2626; font-size: 14px;">${data.criticalCount}</td>
            </tr>
            <tr style="border-top: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #d97706; font-size: 13px;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #d97706; margin-right: 6px;"></span>Warnings
              </td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #d97706; font-size: 14px;">${data.warningCount}</td>
            </tr>
            <tr style="border-top: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #2563eb; font-size: 13px;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #2563eb; margin-right: 6px;"></span>Best Practices
              </td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #2563eb; font-size: 14px;">${data.infoCount}</td>
            </tr>
          </table>
        </div>

        <!-- Top issues -->
        ${topIssuesHtml}

        <!-- CTA button -->
        <div style="text-align: center; margin: 28px 0 8px;">
          <a href="${appUrl}/orgs/${data.orgId}" style="display: inline-block; padding: 14px 32px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">View Full Report</a>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding: 20px 32px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; background: #f9fafb;">
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">
          You received this because email notifications are enabled.
          <a href="${appUrl}/settings" style="color: #6b7280; text-decoration: underline;">Manage preferences</a>
        </p>
      </div>
    </div>
  `;
}

function buildFailedEmail(name: string, data: ScanNotificationData, appUrl: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 0; background: #f9fafb;">
      <!-- Header -->
      <div style="background: #dc2626; padding: 28px 32px; border-radius: 12px 12px 0 0;">
        <table style="width: 100%;">
          <tr>
            <td>
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700;">⛨ ConfigCheck</h1>
              <p style="color: #fecaca; margin: 4px 0 0; font-size: 13px;">AI-Driven Config Audits for Salesforce Revenue Cloud</p>
            </td>
            <td style="text-align: right;">
              <span style="color: #fecaca; font-size: 12px;">Scan Failed ✗</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Body -->
      <div style="background: white; padding: 32px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #374151; margin: 0 0 20px; font-size: 15px;">Hi ${name},</p>
        <p style="color: #6b7280; margin: 0 0 24px; font-size: 14px;">The scan for <strong style="color: #1f2937;">${data.orgName}</strong> was unable to complete.</p>

        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 16px 20px; margin: 20px 0;">
          <p style="color: #991b1b; margin: 0; font-size: 14px; font-weight: 500;">Error Details</p>
          <p style="color: #b91c1c; margin: 8px 0 0; font-size: 13px;">${data.errorMessage || 'An unexpected error occurred. This may be due to an expired Salesforce connection.'}</p>
        </div>

        <p style="color: #6b7280; margin: 20px 0 24px; font-size: 13px;">
          <strong>Common fixes:</strong><br/>
          • Reconnect your Salesforce org from the dashboard<br/>
          • Check if your org has API access enabled<br/>
          • Verify the connected user has CPQ permissions
        </p>

        <div style="text-align: center; margin: 28px 0 8px;">
          <a href="${appUrl}/dashboard" style="display: inline-block; padding: 14px 32px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Go to Dashboard</a>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding: 20px 32px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; background: #f9fafb;">
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">
          You received this because email notifications are enabled.
          <a href="${appUrl}/settings" style="color: #6b7280; text-decoration: underline;">Manage preferences</a>
        </p>
      </div>
    </div>
  `;
}

function buildWelcomeEmail(name: string, appUrl: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 0; background: #f9fafb;">
      <!-- Header -->
      <div style="background: #2563eb; padding: 28px 32px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 700;">⛨ ConfigCheck</h1>
        <p style="color: #bfdbfe; margin: 6px 0 0; font-size: 13px;">AI-Driven Config Audits for Salesforce Revenue Cloud</p>
      </div>

      <!-- Body -->
      <div style="background: white; padding: 32px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #1f2937; margin: 0 0 16px; font-size: 20px; font-weight: 700;">Welcome to ConfigCheck, ${name}!</h2>
        <p style="color: #6b7280; margin: 0 0 28px; font-size: 14px; line-height: 1.6;">
          You're all set to start auditing your Salesforce Revenue Cloud configurations. ConfigCheck helps you catch misconfigurations, enforce best practices, and keep your CPQ org healthy.
        </p>

        <!-- Quick Start Steps -->
        <div style="margin: 0 0 28px;">
          <p style="font-weight: 600; color: #1f2937; margin: 0 0 16px; font-size: 15px;">Quick Start Guide</p>

          <div style="margin-bottom: 12px;">
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 16px 20px;">
              <table style="width: 100%;">
                <tr>
                  <td style="width: 40px; vertical-align: top; font-size: 24px;">🔗</td>
                  <td>
                    <p style="color: #1f2937; margin: 0; font-size: 14px; font-weight: 600;">Step 1: Connect your Salesforce org</p>
                    <p style="color: #6b7280; margin: 4px 0 0; font-size: 13px;">Link your sandbox or production environment securely via OAuth.</p>
                  </td>
                </tr>
              </table>
            </div>
          </div>

          <div style="margin-bottom: 12px;">
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 16px 20px;">
              <table style="width: 100%;">
                <tr>
                  <td style="width: 40px; vertical-align: top; font-size: 24px;">🔍</td>
                  <td>
                    <p style="color: #1f2937; margin: 0; font-size: 14px; font-weight: 600;">Step 2: Run your first health scan</p>
                    <p style="color: #6b7280; margin: 4px 0 0; font-size: 13px;">Our AI engine analyzes your CPQ rules, bundles, pricing, and more.</p>
                  </td>
                </tr>
              </table>
            </div>
          </div>

          <div style="margin-bottom: 0;">
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 16px 20px;">
              <table style="width: 100%;">
                <tr>
                  <td style="width: 40px; vertical-align: top; font-size: 24px;">📊</td>
                  <td>
                    <p style="color: #1f2937; margin: 0; font-size: 14px; font-weight: 600;">Step 3: Review issues and generate reports</p>
                    <p style="color: #6b7280; margin: 4px 0 0; font-size: 13px;">Get actionable recommendations prioritized by severity.</p>
                  </td>
                </tr>
              </table>
            </div>
          </div>
        </div>

        <!-- CTA Button -->
        <div style="text-align: center; margin: 28px 0 8px;">
          <a href="${appUrl}/dashboard" style="display: inline-block; padding: 14px 32px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Go to Dashboard</a>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding: 20px 32px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; background: #f9fafb;">
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">
          You received this because you signed up for ConfigCheck.
          <a href="${appUrl}/settings" style="color: #6b7280; text-decoration: underline;">Manage preferences</a>
        </p>
      </div>
    </div>
  `;
}
