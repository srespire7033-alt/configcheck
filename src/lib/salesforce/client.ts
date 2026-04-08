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
export function getAuthorizationUrl(state?: string): { url: string; codeVerifier: string } {
  const { codeVerifier, codeChallenge } = generatePKCE();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SF_CLIENT_ID,
    redirect_uri: SF_REDIRECT_URI,
    scope: 'api refresh_token full',
    state: state || '',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `${SF_LOGIN_URL}/services/oauth2/authorize?${params.toString()}`,
    codeVerifier,
  };
}

/**
 * Exchange the authorization code for access + refresh tokens (with PKCE)
 */
export async function handleOAuthCallback(code: string, codeVerifier?: string): Promise<{
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
  orgId: string;
  userId: string;
}> {
  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
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
 * Create a JSForce connection from stored tokens
 */
export function createConnection(
  instanceUrl: string,
  accessToken: string,
  refreshToken: string
): Connection {
  const conn = new Connection({
    oauth2: getOAuth2(),
    instanceUrl,
    accessToken,
    refreshToken,
  });

  conn.on('refresh', (newAccessToken: string) => {
    console.log('Salesforce token refreshed:', newAccessToken.substring(0, 10) + '...');
  });

  return conn;
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
    const result = await conn.query('SELECT Id, Name FROM Organization LIMIT 1');
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
