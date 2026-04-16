/* eslint-disable @typescript-eslint/no-explicit-any */
import { Connection, OAuth2 } from 'jsforce';
import crypto from 'crypto';

// Salesforce OAuth configuration
const SF_CLIENT_ID = process.env.SALESFORCE_CLIENT_ID!;
const SF_CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET!;
const SF_REDIRECT_URI = process.env.SALESFORCE_REDIRECT_URI!;
const SF_LOGIN_URL = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';

// Store code verifier in memory
let storedCodeVerifier: string | null = null;

/**
 * Wrap a promise-like (including jsforce Query) with a timeout.
 * Rejects if not resolved within `ms` milliseconds.
 */
function withTimeout<T>(promiseLike: PromiseLike<T>, ms: number, label = 'Operation'): Promise<T> {
  return Promise.race([
    Promise.resolve(promiseLike),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/**
 * Get and clear stored code verifier
 */
export function getStoredCodeVerifier(): string | null {
  const v = storedCodeVerifier;
  storedCodeVerifier = null;
  return v;
}

function getOAuth2() {
  return new OAuth2({
    clientId: SF_CLIENT_ID,
    clientSecret: SF_CLIENT_SECRET,
    redirectUri: SF_REDIRECT_URI,
    loginUrl: SF_LOGIN_URL,
  });
}

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9._~-]/g, '')
    .substring(0, 128);

  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return { codeVerifier, codeChallenge };
}

/**
 * Generate the OAuth authorization URL with PKCE
 * Returns both the URL and the code verifier (to store in cookie)
 */
export function getAuthorizationUrl(state?: string, customClientId?: string): { url: string; codeVerifier: string } {
  const { codeVerifier, codeChallenge } = generatePKCE();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: customClientId || SF_CLIENT_ID,
    redirect_uri: SF_REDIRECT_URI,
    scope: 'api refresh_token full',
    state: state || '',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'login',  // Always show login screen so user can pick which org to connect
  });

  return {
    url: `${SF_LOGIN_URL}/services/oauth2/authorize?${params.toString()}`,
    codeVerifier,
  };
}

/**
 * Exchange the authorization code for access + refresh tokens (with PKCE)
 */
export async function handleOAuthCallback(
  code: string,
  codeVerifier?: string,
  customCreds?: { clientId: string; clientSecret: string }
): Promise<{
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
  orgId: string;
  userId: string;
}> {
  const useClientId = customCreds?.clientId || SF_CLIENT_ID;
  const useClientSecret = customCreds?.clientSecret || SF_CLIENT_SECRET;

  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: useClientId,
    client_secret: useClientSecret,
    redirect_uri: SF_REDIRECT_URI,
  });

  // Add PKCE code verifier if available
  if (codeVerifier) {
    tokenParams.set('code_verifier', codeVerifier);
  }

  const tokenResponse = await fetch(`${SF_LOGIN_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
  });

  if (!tokenResponse.ok) {
    const errBody = await tokenResponse.text();
    throw new Error(`Salesforce token exchange failed: ${errBody}`);
  }

  const tokenData = await tokenResponse.json();

  // Get identity info
  const identityResponse = await fetch(tokenData.id, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const identity = await identityResponse.json();

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    instanceUrl: tokenData.instance_url,
    orgId: identity.organization_id,
    userId: identity.user_id,
  };
}

/**
 * Create a JSForce connection from stored tokens.
 * Pass orgId to enable auto-persist of refreshed tokens to the database.
 */
export function createConnection(
  instanceUrl: string,
  accessToken: string,
  refreshToken: string,
  orgId?: string
): Connection {
  const conn = new Connection({
    oauth2: getOAuth2(),
    instanceUrl,
    accessToken,
    refreshToken,
  });

  conn.on('refresh', (newAccessToken: string) => {
    // Token refreshed silently
    if (orgId) {
      persistRefreshedToken(orgId, newAccessToken).catch((err) =>
        console.error('Failed to persist refreshed token:', err)
      );
    }
  });

  return conn;
}

/**
 * Create a connection with automatic token refresh and retry on 401.
 * Use this for all scan/query operations.
 */
export async function createRefreshableConnection(
  orgId: string
): Promise<{ conn: Connection; org: Record<string, unknown> }> {
  const { createServiceClient } = await import('@/lib/db/client');
  const supabase = createServiceClient();

  const { data: org, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();

  if (error || !org) {
    throw new Error('Organization not found');
  }

  const conn = createConnection(
    org.instance_url,
    org.access_token,
    org.refresh_token,
    orgId
  );

  // Test the connection; if expired, attempt manual refresh (15s timeout)
  try {
    await withTimeout(conn.query('SELECT Id FROM Organization LIMIT 1'), 15000, 'Salesforce connection test');
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('INVALID_SESSION_ID') || msg.includes('Session expired') || msg.includes('401') || msg.includes('timed out')) {
      console.log('Token expired for org', orgId, '— attempting refresh');
      const newTokens = await refreshAccessToken(
        org.instance_url,
        org.refresh_token,
        org.sf_client_id || undefined,
        org.sf_client_secret || undefined
      );
      if (newTokens) {
        await persistRefreshedToken(orgId, newTokens.accessToken);
        return {
          conn: createConnection(org.instance_url, newTokens.accessToken, org.refresh_token, orgId),
          org: { ...org, access_token: newTokens.accessToken },
        };
      }
      // Mark org as expired
      await supabase
        .from('organizations')
        .update({ connection_status: 'expired' })
        .eq('id', orgId);
      throw new Error('Salesforce session expired. Please reconnect your org.');
    }
    throw err;
  }

  return { conn, org };
}

/**
 * Manually refresh the Salesforce access token using the refresh token
 */
async function refreshAccessToken(
  instanceUrl: string,
  refreshToken: string,
  customClientId?: string,
  customClientSecret?: string
): Promise<{ accessToken: string } | null> {
  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: customClientId || SF_CLIENT_ID,
      client_secret: customClientSecret || SF_CLIENT_SECRET,
      refresh_token: refreshToken,
    });

    const res = await withTimeout(
      fetch(`${SF_LOGIN_URL}/services/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      }),
      15000,
      'Token refresh'
    );

    if (!res.ok) {
      console.error('Token refresh failed:', await res.text());
      return null;
    }

    const data = await res.json();
    return { accessToken: data.access_token };
  } catch (err) {
    console.error('Token refresh error:', err);
    return null;
  }
}

/**
 * Save a refreshed access token to the database
 */
async function persistRefreshedToken(orgId: string, newAccessToken: string) {
  const { createServiceClient } = await import('@/lib/db/client');
  const supabase = createServiceClient();
  await supabase
    .from('organizations')
    .update({
      access_token: newAccessToken,
      connection_status: 'connected',
      last_connected_at: new Date().toISOString(),
    })
    .eq('id', orgId);
}

/**
 * Test if a Salesforce connection is still valid
 */
export async function testConnection(conn: Connection): Promise<{
  success: boolean;
  orgName?: string;
  error?: string;
}> {
  try {
    const result = await withTimeout(conn.query('SELECT Id, Name FROM Organization LIMIT 1'), 15000, 'Connection test');
    const org = result.records[0] as any;
    return { success: true, orgName: org.Name };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Detect installed CPQ package version
 */
export async function getCPQPackageVersion(conn: Connection): Promise<string | null> {
  try {
    const result = await conn.query(
      "SELECT SubscriberPackage.Name, SubscriberPackageVersion.MajorVersion, " +
      "SubscriberPackageVersion.MinorVersion " +
      "FROM InstalledSubscriberPackage " +
      "WHERE SubscriberPackage.NamespacePrefix = 'SBQQ' LIMIT 1"
    );
    if (result.records.length > 0) {
      const pkg = result.records[0] as any;
      return `${pkg.SubscriberPackageVersion.MajorVersion}.${pkg.SubscriberPackageVersion.MinorVersion}`;
    }
    return null;
  } catch {
    return null;
  }
}
