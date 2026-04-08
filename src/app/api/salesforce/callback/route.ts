import { NextRequest, NextResponse } from 'next/server';
import { handleOAuthCallback, getCPQPackageVersion, createConnection } from '@/lib/salesforce/client';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      new URL(`/dashboard?error=${encodeURIComponent(error)}`, process.env.NEXT_PUBLIC_APP_URL!)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/dashboard?error=No authorization code received', process.env.NEXT_PUBLIC_APP_URL!)
    );
  }

  try {
    // Get PKCE code verifier from cookie
    const codeVerifier = request.cookies.get('sf_code_verifier')?.value;

    // Exchange code for tokens
    const { accessToken, refreshToken, instanceUrl, orgId } = await handleOAuthCallback(code, codeVerifier);

    // Detect CPQ version
    const conn = createConnection(instanceUrl, accessToken, refreshToken);
    const cpqVersion = await getCPQPackageVersion(conn);

    // Get org name
    const orgResult = await conn.query('SELECT Name FROM Organization LIMIT 1');
    const orgName = (orgResult.records[0] as { Name: string }).Name;

    // Get authenticated user from session cookies
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.redirect(
        new URL('/login?error=Please sign in first', process.env.NEXT_PUBLIC_APP_URL!)
      );
    }

    // Store in database using service client (bypasses RLS)
    const supabase = createServiceClient();

    // Check if org already connected
    const { data: existingOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('salesforce_org_id', orgId)
      .single();

    if (existingOrg) {
      // Update existing connection
      await supabase
        .from('organizations')
        .update({
          access_token: accessToken,
          refresh_token: refreshToken,
          instance_url: instanceUrl,
          connection_status: 'connected',
          cpq_package_version: cpqVersion,
          last_connected_at: new Date().toISOString(),
        })
        .eq('id', existingOrg.id);
    } else {
      await supabase.from('organizations').insert({
        user_id: user.id,
        name: orgName,
        salesforce_org_id: orgId,
        instance_url: instanceUrl,
        access_token: accessToken,
        refresh_token: refreshToken,
        is_sandbox: instanceUrl.includes('test.salesforce.com') || instanceUrl.includes('sandbox'),
        connection_status: 'connected',
        cpq_package_version: cpqVersion,
        last_connected_at: new Date().toISOString(),
      });
    }

    return NextResponse.redirect(
      new URL(`/dashboard?success=Connected ${orgName}`, process.env.NEXT_PUBLIC_APP_URL!)
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'OAuth failed';
    console.error('Salesforce OAuth error:', message);
    return NextResponse.redirect(
      new URL(`/dashboard?error=${encodeURIComponent(message)}`, process.env.NEXT_PUBLIC_APP_URL!)
    );
  }
}
