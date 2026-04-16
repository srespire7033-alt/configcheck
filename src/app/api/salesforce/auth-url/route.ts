import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizationUrl } from '@/lib/salesforce/client';

export const dynamic = 'force-dynamic';

// Default flow — uses server-side env credentials
export async function GET() {
  try {
    const { url, codeVerifier } = getAuthorizationUrl();

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
