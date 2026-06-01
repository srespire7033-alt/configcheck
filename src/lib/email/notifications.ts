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
  // Production: use verified domain email (e.g. notifications@orgprism.app)
  const fromAddress = process.env.EMAIL_FROM || 'OrgPrism <onboarding@resend.dev>';

  const subject = data.status === 'completed'
    ? `OrgPrism: ${data.orgName} scored ${data.overallScore}/100`
    : `OrgPrism: Scan failed for ${data.orgName}`;

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
  const fromAddress = process.env.EMAIL_FROM || 'OrgPrism <onboarding@resend.dev>';

  const subject = 'Welcome to OrgPrism — let\'s audit your first org';
  const html = buildWelcomeEmail(name, appUrl);
  const text = buildWelcomeEmailText(name, appUrl);

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
        text,
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
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em;">◆ OrgPrism</h1>
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
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em;">◆ OrgPrism</h1>
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

// ─────────────────────────────────────────────────────────────────────
// Forensic scan completion email
// ─────────────────────────────────────────────────────────────────────

export interface ForensicNotificationData {
  forensicScanId: string;
  orgId: string;
  orgName: string;
  status: 'completed' | 'partial' | 'failed';
  // Headline
  totalVerifiedUsd: number;
  findingCount: number;
  // Top breakdowns (already sorted by $ desc upstream)
  topDetectors: Array<{ id: string; label: string; finding_count: number; gap_usd: number }>;
  topFindings: Array<{ detector_id: string; title: string; gap_usd: number }>;
  // Optional diff vs previous scan
  diff?: {
    net_delta_usd: number;
    net_delta_pct: number;
    new_count: number;
    escalated_count: number;
    resolved_count: number;
    improved_count: number;
    from_scan_date: string | null;
  };
  // Optional pricing discipline
  pricingDiscipline?: {
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    avg_discount_pct: number;
    override_pct: number;
  };
  errorMessage?: string;
}

const DETECTOR_LABELS: Record<string, string> = {
  'REN-001': 'Renewal uplift suppressed',
  'REN-002': 'Renewal below current list',
  'DSC-FOR-001': 'Promo discount roll-off',
  'QL-FOR-001': 'Bundle option charged at $0',
  'ORD-FOR-001': 'Order activated, no billing schedule',
  'ORD-FOR-002': 'Q↔O variance (new business)',
  'ORD-FOR-003': 'Q↔O variance (amendment)',
};

/**
 * Send a forensic-scan-specific completion email — $-shaped, with
 * top detectors, top findings, and a since-last-scan delta.
 *
 * Different shape from sendScanNotification (which is the config-scan
 * score-and-issues email). Both can fire from the same scan run when
 * forensic is opted in; users get two emails.
 */
export async function sendForensicScanNotification(userId: string, data: ForensicNotificationData) {
  const supabase = createServiceClient();

  const { data: user, error } = await supabase
    .from('users')
    .select('email, full_name, email_notifications_enabled, notification_emails')
    .eq('id', userId)
    .single();
  if (error || !user?.email) {
    console.log(`[EMAIL] No email for user ${userId}`, error?.message);
    return;
  }
  if (user.email_notifications_enabled === false) {
    console.log(`[EMAIL] Forensic notifications disabled for ${user.email}, skipping`);
    return;
  }

  // Skip the "you have no leakage" email — not actionable + would
  // spam users with clean orgs every scan cycle.
  if (data.status === 'completed' && data.findingCount === 0 && !data.diff) {
    console.log(`[EMAIL] Skipping clean-scan notification for ${data.orgName}`);
    return;
  }

  const recipients: string[] = [user.email];
  const extras = (user.notification_emails as string[]) || [];
  for (const e of extras) if (e && !recipients.includes(e)) recipients.push(e);

  const resendKey = process.env.RESEND_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const name = user.full_name || 'there';
  const fromAddress = process.env.EMAIL_FROM || 'OrgPrism <onboarding@resend.dev>';

  const subject = buildForensicSubject(data);
  const html = data.status === 'failed'
    ? buildForensicFailedEmail(name, data, appUrl)
    : buildForensicCompletedEmail(name, data, appUrl);

  if (!resendKey) {
    console.log(`[EMAIL] ⚠️ RESEND_API_KEY not set — forensic email would go to: ${recipients.join(', ')}`);
    console.log(`[EMAIL] Subject: ${subject}`);
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({ from: fromAddress, to: recipients, subject, html }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[EMAIL] ❌ Forensic email failed (${res.status}):`, body);
    } else {
      console.log(`[EMAIL] ✅ Forensic email sent to ${recipients.join(', ')}: ${subject}`);
    }
  } catch (err) {
    console.error('[EMAIL] ❌ Forensic email error:', err);
  }
}

function buildForensicSubject(data: ForensicNotificationData): string {
  // Precedence rationale:
  //   1. Failures always lead with failure (action required).
  //   2. Large diffs come next — the "what changed" narrative is more
  //      valuable than a static $ headline for return scans. Recovering
  //      to zero is the strongest positive subject we can show.
  //   3. Only when there's no diff drama do we fall back to "audit
  //      clean" or "$ leaking."
  if (data.status === 'failed') return `OrgPrism: Forensic scan failed for ${data.orgName}`;
  if (data.diff && data.diff.net_delta_usd > 1000) {
    return `OrgPrism: ${data.orgName} leaking ${fmtMoneyEmail(data.diff.net_delta_usd)} more than last scan`;
  }
  if (data.diff && data.diff.net_delta_usd < -1000) {
    return `OrgPrism: ${data.orgName} recovered ${fmtMoneyEmail(Math.abs(data.diff.net_delta_usd))} since last scan`;
  }
  if (data.findingCount === 0) return `OrgPrism: ${data.orgName} audit clean — no leakage found`;
  return `OrgPrism: ${fmtMoneyEmail(data.totalVerifiedUsd)} in verified leakage for ${data.orgName}`;
}

function fmtMoneyEmail(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (Math.abs(n) < 1) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}

function buildForensicCompletedEmail(name: string, data: ForensicNotificationData, appUrl: string): string {
  const headerBg = data.findingCount === 0 ? '#16a34a' : '#4F46E5';
  const headerLabel = data.findingCount === 0 ? 'Audit Clean ✓' : 'Forensic Audit Complete ✓';
  const headerSubtitle = data.findingCount === 0
    ? `No revenue leakage detected.`
    : `${data.findingCount.toLocaleString()} finding${data.findingCount === 1 ? '' : 's'} across ${data.topDetectors.length} detector${data.topDetectors.length === 1 ? '' : 's'}.`;

  // Diff block
  const diffBlock = data.diff
    ? (() => {
        const d = data.diff!;
        const positive = d.net_delta_usd > 1;
        const negative = d.net_delta_usd < -1;
        const color = positive ? '#dc2626' : negative ? '#16a34a' : '#6b7280';
        const arrow = positive ? '↑' : negative ? '↓' : '·';
        const msg = positive
          ? `${arrow} ${fmtMoneyEmail(d.net_delta_usd)} more than last scan (+${d.net_delta_pct.toFixed(1)}%)`
          : negative
            ? `${arrow} ${fmtMoneyEmail(Math.abs(d.net_delta_usd))} recovered (${d.net_delta_pct.toFixed(1)}%)`
            : `No net change since last scan`;
        return `
          <div style="background: #f9fafb; border-left: 4px solid ${color}; border-radius: 6px; padding: 14px 18px; margin: 16px 0;">
            <p style="margin: 0; font-size: 13px; font-weight: 600; color: ${color};">${msg}</p>
            <p style="margin: 4px 0 0; font-size: 11px; color: #6b7280;">
              ↑${d.new_count} new · ↑${d.escalated_count} escalated · ✓${d.resolved_count} resolved · ↓${d.improved_count} improved
            </p>
          </div>
        `;
      })()
    : '';

  // Top detectors table
  const detectorsHtml = data.topDetectors.length > 0
    ? `
      <div style="margin: 20px 0 0;">
        <p style="font-weight: 600; color: #1f2937; margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Top Detectors by $</p>
        <table style="width: 100%; border-collapse: collapse;">
          ${data.topDetectors.slice(0, 5).map((d) => `
            <tr style="border-bottom: 1px solid #f3f4f6;">
              <td style="padding: 8px 0; font-size: 12px;">
                <span style="font-family: ui-monospace, monospace; color: #4F46E5; font-weight: 600;">${d.id}</span>
                <span style="color: #6b7280; margin-left: 8px;">${DETECTOR_LABELS[d.id] ?? d.label}</span>
              </td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; font-size: 13px;">${fmtMoneyEmail(d.gap_usd)}</td>
              <td style="padding: 8px 0; text-align: right; font-size: 11px; color: #9ca3af; padding-left: 8px;">(${d.finding_count})</td>
            </tr>
          `).join('')}
        </table>
      </div>
    ` : '';

  // Top findings
  const findingsHtml = data.topFindings.length > 0
    ? `
      <div style="margin: 24px 0 0;">
        <p style="font-weight: 600; color: #1f2937; margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Top Findings</p>
        ${data.topFindings.slice(0, 5).map((f) => `
          <div style="padding: 10px 14px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 6px;">
            <table style="width: 100%;"><tr>
              <td style="font-size: 12px; color: #374151;">
                <span style="font-family: ui-monospace, monospace; color: #4F46E5; font-weight: 600; font-size: 10px; background: #eef2ff; padding: 2px 6px; border-radius: 3px; margin-right: 8px;">${f.detector_id}</span>
                ${f.title}
              </td>
              <td style="text-align: right; font-size: 13px; font-weight: 600; color: #1f2937; white-space: nowrap; padding-left: 10px;">${fmtMoneyEmail(f.gap_usd)}</td>
            </tr></table>
          </div>
        `).join('')}
      </div>
    ` : '';

  // Pricing discipline
  const pdHtml = data.pricingDiscipline
    ? `
      <div style="background: #f9fafb; border-radius: 10px; padding: 14px 18px; margin: 24px 0;">
        <p style="font-weight: 600; color: #1f2937; margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Pricing Discipline</p>
        <p style="margin: 0; font-size: 14px; color: #374151;">
          Grade: <span style="font-weight: 700; color: ${gradeColorForEmail(data.pricingDiscipline.grade)};">${data.pricingDiscipline.grade}</span>
          · Avg discount ${data.pricingDiscipline.avg_discount_pct.toFixed(1)}%
          · Manual override ${data.pricingDiscipline.override_pct.toFixed(1)}%
        </p>
      </div>
    ` : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; background: #f9fafb;">
      <!-- Header -->
      <div style="background: ${headerBg}; padding: 28px 32px; border-radius: 12px 12px 0 0;">
        <table style="width: 100%;">
          <tr>
            <td>
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em;">◆ OrgPrism</h1>
              <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 13px;">Revenue Forensics — ${data.orgName}</p>
            </td>
            <td style="text-align: right;">
              <span style="color: rgba(255,255,255,0.85); font-size: 12px;">${headerLabel}</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Body -->
      <div style="background: white; padding: 32px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #374151; margin: 0 0 8px; font-size: 15px;">Hi ${name},</p>
        <p style="color: #6b7280; margin: 0 0 20px; font-size: 14px;">${headerSubtitle}</p>

        ${data.findingCount > 0 ? `
        <!-- Headline figure -->
        <div style="text-align: center; padding: 24px 16px; background: linear-gradient(135deg, #eef2ff 0%, #ddd6fe 100%); border-radius: 12px; margin: 16px 0;">
          <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Verified Annual Leakage</p>
          <p style="margin: 8px 0 0; font-size: 36px; font-weight: 800; color: #4F46E5; letter-spacing: -0.02em;">${fmtMoneyEmail(data.totalVerifiedUsd)}</p>
        </div>
        ` : ''}

        ${diffBlock}

        ${detectorsHtml}

        ${findingsHtml}

        ${pdHtml}

        <!-- CTAs -->
        <div style="text-align: center; margin: 28px 0 8px;">
          <a href="${appUrl}/orgs/${data.orgId}" style="display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; margin-right: 8px;">View Full Audit</a>
          <a href="${appUrl}/api/orgs/${data.orgId}/executive-report" style="display: inline-block; padding: 12px 24px; background: #1f2937; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;">Download Client PDF</a>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding: 20px 32px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; background: #f9fafb;">
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">
          You received this because forensic scan notifications are enabled.
          <a href="${appUrl}/settings" style="color: #6b7280; text-decoration: underline;">Manage preferences</a>
        </p>
      </div>
    </div>
  `;
}

function buildForensicFailedEmail(name: string, data: ForensicNotificationData, appUrl: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 0; background: #f9fafb;">
      <div style="background: #dc2626; padding: 28px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700;">◆ OrgPrism</h1>
        <p style="color: #fecaca; margin: 4px 0 0; font-size: 13px;">Forensic scan failed — ${data.orgName}</p>
      </div>
      <div style="background: white; padding: 32px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #374151; margin: 0 0 16px; font-size: 15px;">Hi ${name},</p>
        <p style="color: #6b7280; margin: 0 0 16px; font-size: 14px;">The forensic scan for <strong style="color: #1f2937;">${data.orgName}</strong> did not complete.</p>
        ${data.errorMessage ? `
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 18px; margin: 16px 0;">
          <p style="color: #b91c1c; margin: 0; font-size: 13px; font-family: ui-monospace, monospace;">${data.errorMessage}</p>
        </div>
        ` : ''}
        <p style="color: #6b7280; margin: 16px 0; font-size: 13px;">
          Likely causes: expired Salesforce token, network timeout, or org disconnected. Reconnecting the org typically resolves this.
        </p>
        <div style="text-align: center; margin: 24px 0 8px;">
          <a href="${appUrl}/orgs/${data.orgId}" style="display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;">Reconnect & Retry</a>
        </div>
      </div>
      <div style="padding: 20px 32px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; background: #f9fafb;">
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">
          <a href="${appUrl}/settings" style="color: #6b7280; text-decoration: underline;">Manage notification preferences</a>
        </p>
      </div>
    </div>
  `;
}

function gradeColorForEmail(g: 'A' | 'B' | 'C' | 'D' | 'F'): string {
  return { A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#ea580c', F: '#dc2626' }[g];
}

function buildWelcomeEmail(name: string, appUrl: string): string {
  const firstName = name.split(' ')[0] || name;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Welcome to OrgPrism</title>
</head>
<body style="margin:0; padding:0; background:#f4f5f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased;">
  <!-- Preheader (hidden preview text in inbox) -->
  <div style="display:none; font-size:1px; color:#f4f5f7; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
    Connect your Salesforce org in 60 seconds and run your first CPQ audit.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; background:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 1px 3px rgba(16,24,40,0.06), 0 1px 2px rgba(16,24,40,0.04);">

          <!-- Brand bar -->
          <tr>
            <td style="padding:24px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#1E40AF; width:32px; height:32px; border-radius:8px; text-align:center; color:#ffffff; font-weight:700; font-size:16px; line-height:32px;">◆</td>
                        <td style="padding-left:10px; vertical-align:middle; font-size:15px; font-weight:600; color:#0f172a; letter-spacing:-0.01em;">OrgPrism</td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="font-size:12px; color:#64748b;">Welcome aboard</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="padding:32px 32px 8px;">
              <h1 style="margin:0 0 12px; font-size:26px; line-height:1.25; font-weight:700; color:#0f172a; letter-spacing:-0.02em;">
                Welcome, ${firstName}.
              </h1>
              <p style="margin:0; font-size:15px; line-height:1.6; color:#475569;">
                Thanks for signing up for OrgPrism. You're minutes away from your first AI-driven audit of a Salesforce Revenue Cloud org — the same checks senior CPQ architects run manually, automated end-to-end.
              </p>
            </td>
          </tr>

          <!-- Primary CTA -->
          <tr>
            <td style="padding:24px 32px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#0f172a; border-radius:8px;">
                    <a href="${appUrl}/dashboard" style="display:inline-block; padding:12px 22px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none; line-height:1;">
                      Connect your first org →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:10px 0 0; font-size:12px; color:#94a3b8;">Sandbox or production — OAuth, read-only, takes 60 seconds.</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="padding:28px 32px 0;"><div style="height:1px; background:#e2e8f0; line-height:1px; font-size:0;">&nbsp;</div></td></tr>

          <!-- Steps -->
          <tr>
            <td style="padding:24px 32px 8px;">
              <p style="margin:0 0 16px; font-size:12px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.08em;">How it works</p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                <tr>
                  <td style="width:32px; vertical-align:top; padding-top:2px;">
                    <div style="width:26px; height:26px; border-radius:50%; background:#eff6ff; color:#2563eb; text-align:center; line-height:26px; font-size:13px; font-weight:700;">1</div>
                  </td>
                  <td style="padding-left:14px;">
                    <p style="margin:0; font-size:14px; font-weight:600; color:#0f172a;">Connect your Salesforce org</p>
                    <p style="margin:4px 0 0; font-size:13px; color:#64748b; line-height:1.55;">Read-only OAuth connection. No changes are ever made to your org.</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                <tr>
                  <td style="width:32px; vertical-align:top; padding-top:2px;">
                    <div style="width:26px; height:26px; border-radius:50%; background:#eff6ff; color:#2563eb; text-align:center; line-height:26px; font-size:13px; font-weight:700;">2</div>
                  </td>
                  <td style="padding-left:14px;">
                    <p style="margin:0; font-size:14px; font-weight:600; color:#0f172a;">Run a health scan</p>
                    <p style="margin:4px 0 0; font-size:13px; color:#64748b; line-height:1.55;">We analyze price rules, product rules, bundles, discount schedules, approvals, and 40+ other areas.</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:32px; vertical-align:top; padding-top:2px;">
                    <div style="width:26px; height:26px; border-radius:50%; background:#eff6ff; color:#2563eb; text-align:center; line-height:26px; font-size:13px; font-weight:700;">3</div>
                  </td>
                  <td style="padding-left:14px;">
                    <p style="margin:0; font-size:14px; font-weight:600; color:#0f172a;">Share a branded PDF report</p>
                    <p style="margin:4px 0 0; font-size:13px; color:#64748b; line-height:1.55;">Export a white-labeled audit with severity, impact, and remediation — ready to hand to your client.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="padding:28px 32px 0;"><div style="height:1px; background:#e2e8f0; line-height:1px; font-size:0;">&nbsp;</div></td></tr>

          <!-- Founder note -->
          <tr>
            <td style="padding:24px 32px 8px;">
              <p style="margin:0 0 12px; font-size:14px; line-height:1.65; color:#334155;">
                If anything feels off, or there's a check you wish OrgPrism ran, just reply to this email — it comes straight to my inbox.
              </p>
              <p style="margin:0; font-size:14px; color:#0f172a;">— Maulik<br><span style="color:#64748b; font-size:13px;">Founder, OrgPrism</span></p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 32px 28px;">
              <div style="border-top:1px solid #e2e8f0; padding-top:18px; text-align:center;">
                <p style="margin:0 0 6px; font-size:12px; color:#94a3b8;">
                  You're receiving this because you signed up for OrgPrism.
                </p>
                <p style="margin:0; font-size:12px; color:#94a3b8;">
                  <a href="${appUrl}/settings" style="color:#64748b; text-decoration:underline;">Manage email preferences</a>
                  &nbsp;·&nbsp;
                  <a href="${appUrl}/dashboard" style="color:#64748b; text-decoration:underline;">Open dashboard</a>
                </p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

function buildWelcomeEmailText(name: string, appUrl: string): string {
  const firstName = name.split(' ')[0] || name;
  return `Welcome, ${firstName}.

Thanks for signing up for OrgPrism. You're minutes away from your first AI-driven audit of a Salesforce Revenue Cloud org — the same checks senior CPQ architects run manually, automated end-to-end.

Connect your first org: ${appUrl}/dashboard
(Sandbox or production — OAuth, read-only, takes 60 seconds.)

How it works:

  1. Connect your Salesforce org
     Read-only OAuth connection. No changes are ever made to your org.

  2. Run a health scan
     We analyze price rules, product rules, bundles, discount schedules,
     approvals, and 40+ other areas.

  3. Share a branded PDF report
     Export a white-labeled audit with severity, impact, and remediation —
     ready to hand to your client.

If anything feels off, or there's a check you wish OrgPrism ran, just reply to this email — it comes straight to my inbox.

— Maulik
Founder, OrgPrism

---
You're receiving this because you signed up for OrgPrism.
Manage email preferences: ${appUrl}/settings
Open dashboard: ${appUrl}/dashboard
`;
}

interface InvitationEmailData {
  recipientEmail: string;
  inviterName: string;
  teamName: string;
  role: string;
  inviteToken: string;
}

/**
 * Send team invitation email with link to /invite/{token}.
 * Falls back to console log if RESEND_API_KEY is not set.
 */
export async function sendInvitationEmail(data: InvitationEmailData) {
  const resendKey = process.env.RESEND_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const fromAddress = process.env.EMAIL_FROM || 'OrgPrism <onboarding@resend.dev>';
  const inviteUrl = `${appUrl}/invite/${data.inviteToken}`;
  const subject = `${data.inviterName} invited you to join ${data.teamName} on OrgPrism`;
  const html = buildInvitationEmail(data, inviteUrl);
  const text = buildInvitationEmailText(data, inviteUrl);

  if (!resendKey) {
    console.log(`[EMAIL] ⚠️ RESEND_API_KEY not set — invitation email would be sent to: ${data.recipientEmail}`);
    console.log(`[EMAIL] Subject: ${subject}`);
    console.log(`[EMAIL] Invite URL: ${inviteUrl}`);
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
        to: [data.recipientEmail],
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[EMAIL] ❌ Invitation email failed (${res.status}):`, body);
    } else {
      console.log(`[EMAIL] ✅ Invitation email sent to ${data.recipientEmail}`);
    }
  } catch (err) {
    console.error('[EMAIL] ❌ Invitation email error:', err);
  }
}

function buildInvitationEmail(data: InvitationEmailData, inviteUrl: string): string {
  const roleLabel = data.role.charAt(0).toUpperCase() + data.role.slice(1);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>You're invited to ${data.teamName}</title>
</head>
<body style="margin:0; padding:0; background:#f4f5f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased;">
  <div style="display:none; font-size:1px; color:#f4f5f7; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
    Join ${data.teamName} on OrgPrism as a ${roleLabel}.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; background:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 1px 3px rgba(16,24,40,0.06), 0 1px 2px rgba(16,24,40,0.04);">
          <tr>
            <td style="padding:24px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#1E40AF; width:32px; height:32px; border-radius:8px; text-align:center; color:#ffffff; font-weight:700; font-size:16px; line-height:32px;">◆</td>
                        <td style="padding-left:10px; vertical-align:middle; font-size:15px; font-weight:600; color:#0f172a; letter-spacing:-0.01em;">OrgPrism</td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="font-size:12px; color:#64748b;">Team invitation</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px;">
              <h1 style="margin:0 0 12px; font-size:24px; line-height:1.25; font-weight:700; color:#0f172a; letter-spacing:-0.02em;">
                You've been invited to ${data.teamName}.
              </h1>
              <p style="margin:0 0 8px; font-size:15px; line-height:1.6; color:#475569;">
                <strong style="color:#0f172a;">${data.inviterName}</strong> has invited you to join the <strong style="color:#0f172a;">${data.teamName}</strong> team on OrgPrism as a <strong style="color:#0f172a;">${roleLabel}</strong>.
              </p>
              <p style="margin:0; font-size:15px; line-height:1.6; color:#475569;">
                You'll be able to view scans, share audit reports, and collaborate on remediation work for connected Salesforce orgs.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#0f172a; border-radius:8px;">
                    <a href="${inviteUrl}" style="display:inline-block; padding:12px 22px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none; line-height:1;">
                      Accept invitation →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:10px 0 0; font-size:12px; color:#94a3b8;">If you don't have a OrgPrism account, you can create one in seconds.</p>
            </td>
          </tr>
          <tr><td style="padding:28px 32px 0;"><div style="height:1px; background:#e2e8f0; line-height:1px; font-size:0;">&nbsp;</div></td></tr>
          <tr>
            <td style="padding:24px 32px 32px;">
              <p style="margin:0 0 8px; font-size:12px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.08em;">If the button doesn't work</p>
              <p style="margin:0; font-size:13px; line-height:1.55; color:#475569; word-break:break-all;">
                Copy and paste this link into your browser: <a href="${inviteUrl}" style="color:#2563eb; text-decoration:underline;">${inviteUrl}</a>
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0; font-size:12px; color:#94a3b8;">If you didn't expect this invitation, you can safely ignore this email.</p>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

function buildInvitationEmailText(data: InvitationEmailData, inviteUrl: string): string {
  const roleLabel = data.role.charAt(0).toUpperCase() + data.role.slice(1);
  return `You've been invited to ${data.teamName}.

${data.inviterName} has invited you to join the ${data.teamName} team on OrgPrism as a ${roleLabel}.

You'll be able to view scans, share audit reports, and collaborate on remediation work for connected Salesforce orgs.

Accept the invitation: ${inviteUrl}

If you don't have a OrgPrism account, you can create one in seconds.

If you didn't expect this invitation, you can safely ignore this email.

— OrgPrism
`;
}
