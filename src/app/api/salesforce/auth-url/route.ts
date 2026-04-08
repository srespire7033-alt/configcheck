import { NextResponse } from 'next/server';
import { getAuthorizationUrl } from '@/lib/salesforce/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { url, codeVerifier } = getAuthorizationUrl();

    // Store code verifier in a cookie so callback route can read it
    const response = NextResponse.json({ url });
    response.cookies.set('sf_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: false, // localhost uses http
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    });
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate auth URL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
