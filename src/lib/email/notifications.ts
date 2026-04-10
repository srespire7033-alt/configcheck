import { createServiceClient } from '@/lib/db/client';

interface ScanNotificationData {
  scanId: string;
  orgName: string;
  overallScore: number;
  totalIssues: number;
  criticalCount: number;
  warningCount: number;
  status: 'completed' | 'failed';
  errorMessage?: string;
}

/**
 * Send scan completion notification email.
 * Uses Resend if API key is available, otherwise logs to console.
 */
export async function sendScanNotification(userId: string, data: ScanNotificationData) {
  const supabase = createServiceClient();

  // Get user email
  const { data: user, error } = await supabase
    .from('users')
    .select('email, full_name')
    .eq('id', userId)
    .single();

  if (error || !user?.email) {
    console.log('No email found for user', userId);
    return;
  }

  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    // Log notification instead of sending email
    console.log(`[EMAIL] To: ${user.email} | Scan ${data.status} for ${data.orgName} | Score: ${data.overallScore}/100 | Issues: ${data.totalIssues}`);
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const name = user.full_name || 'there';

  const subject = data.status === 'completed'
    ? `ConfigCheck: ${data.orgName} scored ${data.overallScore}/100`
    : `ConfigCheck: Scan failed for ${data.orgName}`;

  const html = data.status === 'completed'
    ? buildCompletedEmail(name, data, appUrl)
    : buildFailedEmail(name, data, appUrl);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'ConfigCheck <notifications@configcheck.app>',
        to: [user.email],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      console.error('Email send failed:', await res.text());
    }
  } catch (err) {
    console.error('Email error:', err);
  }
}

function buildCompletedEmail(name: string, data: ScanNotificationData, appUrl: string): string {
  const scoreColor = data.overallScore >= 80 ? '#16a34a' : data.overallScore >= 60 ? '#d97706' : '#dc2626';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #1f2937; margin: 0;">Scan Complete</h2>
        <p style="color: #6b7280; margin: 4px 0 0;">${data.orgName}</p>
      </div>
      <div style="text-align: center; margin: 24px 0;">
        <div style="display: inline-block; width: 80px; height: 80px; line-height: 80px; border-radius: 50%; background: ${scoreColor}15; color: ${scoreColor}; font-size: 28px; font-weight: 700;">
          ${data.overallScore}
        </div>
        <p style="color: #6b7280; margin: 8px 0 0;">out of 100</p>
      </div>
      <div style="background: #f9fafb; border-radius: 12px; padding: 16px; margin: 20px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; color: #6b7280;">Total Issues</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${data.totalIssues}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #dc2626;">Critical</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #dc2626;">${data.criticalCount}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #d97706;">Warnings</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #d97706;">${data.warningCount}</td>
          </tr>
        </table>
      </div>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${appUrl}/orgs/${data.scanId}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none; font-weight: 500;">View Full Report</a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 32px;">
        You received this because you have scheduled scans enabled on ConfigCheck.
      </p>
    </div>
  `;
}

function buildFailedEmail(name: string, data: ScanNotificationData, appUrl: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #dc2626; margin: 0;">Scan Failed</h2>
        <p style="color: #6b7280; margin: 4px 0 0;">${data.orgName}</p>
      </div>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin: 20px 0;">
        <p style="color: #991b1b; margin: 0; font-size: 14px;">${data.errorMessage || 'An unexpected error occurred during the scan. This may be due to an expired Salesforce connection.'}</p>
      </div>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${appUrl}/dashboard" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none; font-weight: 500;">Go to Dashboard</a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 32px;">
        You received this because you have scheduled scans enabled on ConfigCheck.
      </p>
    </div>
  `;
}
