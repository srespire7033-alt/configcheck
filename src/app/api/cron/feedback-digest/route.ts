import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/feedback-digest
 *
 * Weekly digest emailed to admins listing the check_ids that users are
 * marking as false_positive or not_relevant. Closes the feedback loop on
 * check quality — without this, suppression data piles up in the DB and
 * nobody ever sees it, so bad checks keep getting shipped.
 *
 * Scheduled in vercel.json to fire Mondays at 09:00 UTC (`0 9 * * 1`).
 * Bearer-authed via CRON_SECRET, same pattern as /api/cron/process-queue.
 *
 * If no suppressions happened in the last 7 days, returns 204 without
 * sending email — silence is golden.
 *
 * Recipients come from ADMIN_EMAILS (comma-separated env var). Falls
 * back to console log when RESEND_API_KEY is unset (dev mode).
 */
interface CheckRow {
  check_id: string;
  org_count: number;
  total_count: number;
  sample_title: string | null;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Pull last 7 days of suppressions. The table itself is small even at
  // scale (one row per org/check_id), so we can aggregate client-side.
  const { data: suppressions, error: supErr } = await supabase
    .from('check_suppressions')
    .select('organization_id, check_id, reason, created_at')
    .gte('created_at', since);

  if (supErr) {
    console.error('[feedback-digest] suppression query failed:', supErr);
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }

  if (!suppressions || suppressions.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  // Aggregate: per check_id, count distinct orgs and total events.
  const byCheck = new Map<string, { orgs: Set<string>; total: number }>();
  for (const row of suppressions) {
    const bucket = byCheck.get(row.check_id) ?? { orgs: new Set<string>(), total: 0 };
    bucket.orgs.add(row.organization_id);
    bucket.total += 1;
    byCheck.set(row.check_id, bucket);
  }

  // Grab a representative issue title for each check_id so admins can read
  // the digest without cross-referencing the codebase. Picks the most
  // recent issue with that check_id since titles can shift slightly over
  // time as checks evolve.
  const checkIds = Array.from(byCheck.keys());
  const { data: sampleIssues } = await supabase
    .from('issues')
    .select('check_id, title')
    .in('check_id', checkIds)
    .order('created_at', { ascending: false });
  const titleMap = new Map<string, string>();
  for (const issue of sampleIssues ?? []) {
    if (!titleMap.has(issue.check_id)) titleMap.set(issue.check_id, issue.title);
  }

  const rows: CheckRow[] = Array.from(byCheck.entries())
    .map(([check_id, v]) => ({
      check_id,
      org_count: v.orgs.size,
      total_count: v.total,
      sample_title: titleMap.get(check_id) ?? null,
    }))
    .sort((a, b) => b.org_count - a.org_count || b.total_count - a.total_count);

  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (adminEmails.length === 0) {
    console.log('[feedback-digest] ADMIN_EMAILS not set — skipping send. Digest contents:', rows);
    return NextResponse.json({ sent: false, reason: 'no_admins', rows: rows.length });
  }

  const subject = `OrgPrism — ${rows.length} check${rows.length === 1 ? '' : 's'} flagged this week`;
  const html = buildDigestHtml(rows);
  const text = buildDigestText(rows);

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log(`[feedback-digest] RESEND_API_KEY not set — would have sent to: ${adminEmails.join(', ')}`);
    console.log(`[feedback-digest] Digest:`, rows);
    return NextResponse.json({ sent: false, reason: 'no_resend_key', rows: rows.length });
  }

  const fromAddress = process.env.EMAIL_FROM || 'OrgPrism <onboarding@resend.dev>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: fromAddress,
        to: adminEmails,
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[feedback-digest] Resend failed (${res.status}):`, body);
      return NextResponse.json({ sent: false, reason: 'resend_failed', detail: body.slice(0, 200) }, { status: 500 });
    }
    return NextResponse.json({ sent: true, recipients: adminEmails.length, rows: rows.length });
  } catch (err) {
    console.error('[feedback-digest] send threw:', err);
    return NextResponse.json({ sent: false, reason: 'send_error' }, { status: 500 });
  }
}

function buildDigestHtml(rows: CheckRow[]): string {
  const tableRows = rows
    .map((r) => `
      <tr>
        <td style="padding:10px 14px; border-bottom:1px solid #e5e7eb; font-family:monospace; font-size:13px; color:#111827; vertical-align:top;">${r.check_id}</td>
        <td style="padding:10px 14px; border-bottom:1px solid #e5e7eb; font-size:14px; color:#374151; vertical-align:top;">${(r.sample_title ?? '<em>no recent issue</em>').replace(/</g, '&lt;')}</td>
        <td style="padding:10px 14px; border-bottom:1px solid #e5e7eb; text-align:right; font-size:14px; color:#111827; font-weight:600;">${r.org_count}</td>
        <td style="padding:10px 14px; border-bottom:1px solid #e5e7eb; text-align:right; font-size:14px; color:#6b7280;">${r.total_count}</td>
      </tr>
    `)
    .join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0; padding:24px; background:#f4f5f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#111827;">
  <div style="max-width:640px; margin:0 auto; background:#fff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">
    <div style="padding:24px 28px; border-bottom:1px solid #e5e7eb;">
      <h1 style="margin:0; font-size:18px; color:#111827;">Weekly check-quality digest</h1>
      <p style="margin:6px 0 0 0; font-size:13px; color:#6b7280;">Checks that users marked as false-positive or not-relevant in the last 7 days. Sorted by distinct-org count.</p>
    </div>
    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:10px 14px; text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; color:#6b7280; letter-spacing:0.04em;">Check</th>
          <th style="padding:10px 14px; text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; color:#6b7280; letter-spacing:0.04em;">Sample title</th>
          <th style="padding:10px 14px; text-align:right; font-size:11px; font-weight:600; text-transform:uppercase; color:#6b7280; letter-spacing:0.04em;">Orgs</th>
          <th style="padding:10px 14px; text-align:right; font-size:11px; font-weight:600; text-transform:uppercase; color:#6b7280; letter-spacing:0.04em;">Total</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div style="padding:16px 28px; background:#f9fafb; font-size:12px; color:#6b7280; border-top:1px solid #e5e7eb;">
      Checks marked by 3+ distinct orgs are strong candidates for refinement or removal.
    </div>
  </div>
</body></html>`;
}

function buildDigestText(rows: CheckRow[]): string {
  const lines = rows.map(
    (r) => `${r.check_id.padEnd(14)} ${r.org_count} org(s), ${r.total_count} total — ${r.sample_title ?? '(no recent issue)'}`
  );
  return `Weekly check-quality digest

${lines.join('\n')}

Checks marked by 3+ distinct orgs are strong candidates for refinement.
`;
}
