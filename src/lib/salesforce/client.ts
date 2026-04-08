/* eslint-disable @typescript-eslint/no-explicit-any */
import { Connection, OAuth2 } from 'jsforce';

// Salesforce OAuth configuration
const SF_CLIENT_ID = process.env.SALESFORCE_CLIENT_ID!;
const SF_CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET!;
const SF_REDIRECT_URI = process.env.SALESFORCE_REDIRECT_URI!;
const SF_LOGIN_URL = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';

function getOAuth2() {
  return new OAuth2({
    clientId: SF_CLIENT_ID,
    clientSecret: SF_CLIENT_SECRET,
    redirectUri: SF_REDIRECT_URI,
    loginUrl: SF_LOGIN_URL,
  });
}

/**
 * Generate the OAuth authorization URL to redirect users to Salesforce login
 */
export function getAuthorizationUrl(state?: string): string {
  const oauth2 = getOAuth2();
  return oauth2.getAuthorizationUrl({
    scope: 'api refresh_token offline_access id',
    state: state || '',
  });
}

/**
 * Exchange the authorization code for access + refresh tokens
 */
export async function handleOAuthCallback(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
  orgId: string;
  userId: string;
}> {
  const conn = new Connection({ oauth2: getOAuth2() });
  await conn.authorize(code);

  const identity = await conn.identity();

  return {
    accessToken: conn.accessToken!,
    refreshToken: conn.refreshToken!,
    instanceUrl: conn.instanceUrl,
    orgId: (identity as any).organization_id,
    userId: (identity as any).user_id,
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
