import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizationUrl } from '@/lib/salesforce/client';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

// Default flow — uses server-side env credentials.
// Pass ?orgId=<uuid> when reconnecting a disconnected org so OAuth points
// at that org's My Domain instead of login.salesforce.com (Salesforce
// blocks cross-org OAuth flows for external client apps, so a dev org
// like *.develop.my.salesforce.com must auth against itself).
export async function GET(request: NextRequest) {
  try {
    const orgId = request.nextUrl.searchParams.get('orgId');
    let loginUrl: string | undefined;
    let customClientId: string | undefined;

    if (orgId) {
      const user = await getAuthUser(request);
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const supabase = createServiceClient();
      const { data: org } = await supabase
        .from('organizations')
        .select('instance_url, sf_client_id, sf_login_url')
        .eq('id', orgId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (org) {
        // Prefer the explicitly-stored login URL (custom creds path);
        // otherwise fall back to the org's instance URL, which is the My
        // Domain for orgs that have one — exactly what Salesforce wants.
        loginUrl = org.sf_login_url || org.instance_url || undefined;
        customClientId = org.sf_client_id || undefined;
      }
    }

    const { url, codeVerifier } = getAuthorizationUrl(undefined, customClientId, loginUrl);

    const response = NextResponse.json({ url });
    response.cookies.set('sf_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });
    // Clear any custom credentials cookie from a previous attempt
    response.cookies.delete('sf_custom_creds');
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate auth URL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Custom credentials flow — user provides their own Connected App client_id/secret
export async function POST(request: NextRequest) {
  try {
    const { clientId, clientSecret, loginUrl } = await request.json();

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Consumer Key and Consumer Secret are required' },
        { status: 400 }
      );
    }

    const { url, codeVerifier } = getAuthorizationUrl(undefined, clientId, loginUrl);

    const response = NextResponse.json({ url });
    response.cookies.set('sf_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });
    // Store custom credentials in an encrypted cookie for the callback
    const credsPayload = JSON.stringify({ clientId, clientSecret, loginUrl });
    const encoded = Buffer.from(credsPayload).toString('base64');
    response.cookies.set('sf_custom_creds', encoded, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate auth URL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
