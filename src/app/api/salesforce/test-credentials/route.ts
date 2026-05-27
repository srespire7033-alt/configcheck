import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth/get-user';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const SF_REDIRECT_URI = process.env.SALESFORCE_REDIRECT_URI!;

/**
 * POST /api/salesforce/test-credentials
 * Body: { clientId, loginUrl }
 *
 * Validates that:
 *   1. The login URL is a reachable HTTPS endpoint hosting Salesforce
 *      OAuth (returns 302 from /services/oauth2/authorize, not a 4xx or
 *      DNS failure).
 *   2. The Consumer Key exists in that org and references an OAuth-enabled
 *      External Client App.
 *   3. The redirect URI on the ECA matches OrgPrism's callback (this is
 *      the single most-common setup mistake — wrong callback URL).
 *
 * We do this WITHOUT requiring the user to actually sign in. Salesforce's
 * /services/oauth2/authorize endpoint responds to GET requests with one of
 * three patterns:
 *
 *   • Valid client_id + valid redirect_uri → 302 to /services/oauth2/login
 *     (the user's normal login page). No `error=` query param.
 *   • Invalid client_id → 200 HTML body containing
 *     "Authorization Error" + "Client Identifier ... isn't recognized"
 *   • Mismatched redirect_uri → 200 HTML body containing
 *     "redirect_uri must match configuration"
 *
 * We never send the Consumer Secret over this endpoint — secrets are
 * verified only when the user completes the full OAuth flow, and the
 * exchange happens server-side with the cookie-encrypted secret.
 *
 * Why authenticate this endpoint: we don't want random IPs probing the
 * SF API for valid client_ids via our infra. Authenticated users only,
 * rate-limited to a handful per minute.
 */

const CLIENT_ID_RE = /^3MVG9[A-Za-z0-9._]{50,150}$/;

export async function POST(request: NextRequest) {
  const limiter = rateLimit(request, { maxRequests: 10, windowMs: 60_000 });
  if (!limiter.success) return rateLimitResponse(limiter);

  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { clientId?: string; loginUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const clientId = (body.clientId ?? '').trim();
  const loginUrlRaw = (body.loginUrl ?? '').trim().replace(/\/+$/, '');

  // Format checks — fast feedback before we hit Salesforce at all.
  if (!CLIENT_ID_RE.test(clientId)) {
    return NextResponse.json({
      ok: false,
      stage: 'client_id_format',
      message: 'Consumer Key looks malformed. It should start with "3MVG9" and be ~85 characters long. Copy the full value from your External Client App.',
    });
  }
  let loginUrl: URL;
  try {
    loginUrl = new URL(loginUrlRaw);
  } catch {
    return NextResponse.json({
      ok: false,
      stage: 'login_url_format',
      message: 'Login URL must be a full HTTPS URL, e.g. https://yourcompany.my.salesforce.com',
    });
  }
  if (loginUrl.protocol !== 'https:') {
    return NextResponse.json({
      ok: false,
      stage: 'login_url_scheme',
      message: 'Login URL must use https://, not http://',
    });
  }
  if (!loginUrl.hostname.endsWith('.salesforce.com')) {
    return NextResponse.json({
      ok: false,
      stage: 'login_url_host',
      message: 'Login URL host must end in .salesforce.com — paste your org\'s My Domain URL from Setup → My Domain.',
    });
  }

  // Now ask Salesforce to render the authorize page. We send manual redirect
  // so we can inspect the response without following login flows.
  const authUrl = `${loginUrl.toString()}/services/oauth2/authorize`
    + `?response_type=code`
    + `&client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(SF_REDIRECT_URI)}`
    + `&scope=${encodeURIComponent('api refresh_token')}`
    + `&prompt=none`;

  let res: Response;
  try {
    res = await fetch(authUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'OrgPrism-credential-test/1.0' },
      // 10s timeout so a hung Salesforce endpoint can't tie up our function.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      stage: 'login_url_unreachable',
      message: `Couldn't reach ${loginUrl.hostname}. Double-check the domain — your org may not exist at that URL, or your My Domain may be misspelled.`,
      detail: err instanceof Error ? err.message.slice(0, 120) : undefined,
    });
  }

  // 302 with no `error=` param in Location → ECA exists and redirect_uri matches.
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location') || '';
    if (location.includes('error=')) {
      const errMatch = location.match(/error=([^&]+)/);
      const descMatch = location.match(/error_description=([^&]+)/);
      const errCode = errMatch ? decodeURIComponent(errMatch[1]) : 'unknown';
      const errDesc = descMatch ? decodeURIComponent(descMatch[1]).replace(/\+/g, ' ') : '';
      return NextResponse.json({
        ok: false,
        stage: 'salesforce_oauth_error',
        message: errDesc || `Salesforce rejected the request: ${errCode}`,
        salesforce_error: errCode,
      });
    }
    // Happy path
    return NextResponse.json({
      ok: true,
      message: 'Credentials look good. The Consumer Key exists in your org and the callback URL is configured correctly.',
    });
  }

  // 200 with HTML body — usually means Salesforce rendered an error page
  // (the Consumer Key doesn't exist, redirect URI mismatch, etc).
  if (res.status === 200) {
    const text = await res.text();
    if (/Client Identifier.*isn't recognized|invalid_client_id/i.test(text)) {
      return NextResponse.json({
        ok: false,
        stage: 'client_id_not_found',
        message: 'Your Consumer Key isn\'t recognized by this org. Make sure you copied it from the same org you\'re trying to connect, and that you saved the External Client App.',
      });
    }
    if (/redirect_uri must match|redirect_uri_mismatch/i.test(text)) {
      return NextResponse.json({
        ok: false,
        stage: 'redirect_uri_mismatch',
        message: `The callback URL on your External Client App doesn't match what OrgPrism expects. Set the Callback URL to: ${SF_REDIRECT_URI}`,
      });
    }
    if (/User must authenticate|Login.*Salesforce/i.test(text)) {
      // Salesforce rendered a login page rather than redirecting. Treat as success —
      // the ECA accepted the request and is asking for user auth, which is what we want.
      return NextResponse.json({
        ok: true,
        message: 'Credentials look good. The Consumer Key exists in your org and the callback URL is configured correctly.',
      });
    }
    return NextResponse.json({
      ok: false,
      stage: 'salesforce_unknown_response',
      message: 'Salesforce returned an unexpected response. Try saving your External Client App again and wait 5–10 minutes for changes to propagate.',
    });
  }

  return NextResponse.json({
    ok: false,
    stage: 'salesforce_http_error',
    message: `Salesforce returned HTTP ${res.status}. The ECA settings may not have finished propagating yet — wait 5–10 minutes after saving and try again.`,
  });
}
