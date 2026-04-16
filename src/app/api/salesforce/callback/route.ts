import { NextRequest, NextResponse } from 'next/server';
import { handleOAuthCallback, getCPQPackageVersion, createConnection } from '@/lib/salesforce/client';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { checkQuota } from '@/lib/quota';
import { detectInstalledPackages, packageDetectionToArray } from '@/lib/salesforce/detect-packages';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    const errorDescription = searchParams.get('error_description') || '';
    const fullError = errorDescription ? `${error}: ${errorDescription}` : error;
    return NextResponse.redirect(
      new URL(`/dashboard?error=${encodeURIComponent(fullError)}`, process.env.NEXT_PUBLIC_APP_URL!)
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

    // Check for custom Connected App credentials
    const customCredsCookie = request.cookies.get('sf_custom_creds')?.value;
    let customCreds: { clientId: string; clientSecret: string; loginUrl?: string } | undefined;
    if (customCredsCookie) {
      try {
        const decoded = Buffer.from(customCredsCookie, 'base64').toString('utf-8');
        customCreds = JSON.parse(decoded);
      } catch {
        // Ignore malformed cookie, fall back to defaults
      }
    }

    // Exchange code for tokens
    const { accessToken, refreshToken, instanceUrl, orgId } = await handleOAuthCallback(code, codeVerifier, customCreds);

    // Detect CPQ version
    const conn = createConnection(instanceUrl, accessToken, refreshToken);
    const cpqVersion = await getCPQPackageVersion(conn);

    // Detect installed packages (CPQ, Billing, ARM)
    const detected = await detectInstalledPackages(conn);
    const installedPackages = packageDetectionToArray(detected);

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
      // Update existing connection (include custom creds if provided)
      const updateData: Record<string, unknown> = {
        name: orgName,
        access_token: accessToken,
        refresh_token: refreshToken,
        instance_url: instanceUrl,
        connection_status: 'connected',
        cpq_package_version: cpqVersion,
        installed_packages: installedPackages,
        last_connected_at: new Date().toISOString(),
      };
      if (customCreds) {
        updateData.sf_client_id = customCreds.clientId;
        updateData.sf_client_secret = customCreds.clientSecret;
        updateData.sf_login_url = customCreds.loginUrl || null;
      }
      await supabase
        .from('organizations')
        .update(updateData)
        .eq('id', existingOrg.id);
    } else {
      // Check org quota before adding a new org
      const orgQuota = await checkQuota(user.id, 'orgs');
      if (!orgQuota.allowed) {
        return NextResponse.redirect(
          new URL(`/dashboard?error=You've reached the limit of ${orgQuota.limit} connected org(s) on your plan. Upgrade to connect more.`, process.env.NEXT_PUBLIC_APP_URL!)
        );
      }

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
        installed_packages: installedPackages,
        last_connected_at: new Date().toISOString(),
        ...(customCreds ? {
          sf_client_id: customCreds.clientId,
          sf_client_secret: customCreds.clientSecret,
          sf_login_url: customCreds.loginUrl || null,
        } : {}),
      });
    }

    // Redirect back to onboarding if user hasn't completed it, otherwise dashboard
    const onboardingDone = request.cookies.get('onboarding_completed')?.value === 'true';
    const redirectPath = onboardingDone ? '/dashboard' : '/onboarding';

    // Clear the custom creds cookie
    const redirectResponse = NextResponse.redirect(
      new URL(`${redirectPath}?success=Connected ${orgName}`, process.env.NEXT_PUBLIC_APP_URL!)
    );
    redirectResponse.cookies.delete('sf_custom_creds');
    redirectResponse.cookies.delete('sf_code_verifier');
    return redirectResponse;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'OAuth failed';
    console.error('Salesforce OAuth error:', message);
    const onboardingDone = request.cookies.get('onboarding_completed')?.value === 'true';
    const redirectPath = onboardingDone ? '/dashboard' : '/onboarding';
    return NextResponse.redirect(
      new URL(`${redirectPath}?error=${encodeURIComponent(message)}`, process.env.NEXT_PUBLIC_APP_URL!)
    );
  }
}
