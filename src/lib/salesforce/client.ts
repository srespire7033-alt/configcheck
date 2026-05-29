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

/**
 * Build an OAuth2 instance for jsforce's auto-refresh path. When the caller
 * supplies custom credentials (BYO-ECA — the customer's own External Client
 * App lives inside their org), use those — otherwise fall back to the
 * platform's shared env-var creds.
 *
 * This is CRITICAL for the BYO-ECA model. Without per-org creds here, every
 * BYO-ECA scan eventually fails: the manual refresh path works fine, but
 * once jsforce's internal `Connection` is handed back to the scan engine,
 * its OWN auto-refresh hook tries to refresh the token using whatever
 * OAuth2 was bolted on at construction time. Passing the platform OAuth2
 * means jsforce calls Salesforce with the platform's client_id, which the
 * customer's org doesn't have installed — yielding "External client app
 * is not installed in this org".
 */
function getOAuth2(custom?: { clientId: string; clientSecret: string; loginUrl?: string | null }) {
  return new OAuth2({
    clientId: custom?.clientId || SF_CLIENT_ID,
    clientSecret: custom?.clientSecret || SF_CLIENT_SECRET,
    redirectUri: SF_REDIRECT_URI,
    loginUrl: custom?.loginUrl || SF_LOGIN_URL,
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
export function getAuthorizationUrl(state?: string, customClientId?: string, customLoginUrl?: string): { url: string; codeVerifier: string } {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const baseUrl = customLoginUrl || SF_LOGIN_URL;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: customClientId || SF_CLIENT_ID,
    redirect_uri: SF_REDIRECT_URI,
    // Read-only scope. `api` grants SOQL/REST/Bulk API 2.0/Tooling API
    // access (covers config scans AND the forensic engine's record-level
    // reads); `refresh_token` lets us call Salesforce later without
    // re-prompting the user. We DO NOT request `full` — that scope grants
    // write access to every object the connecting user can see. Even when
    // we add stage-and-approve writeback later, we'll use the same `api`
    // scope (which permits writes via Composite/REST) — the safety control
    // is product-side (human approval), not scope-side.
    scope: 'api refresh_token',
    state: state || '',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'login',  // Always show login screen so user can pick which org to connect
  });

  return {
    url: `${baseUrl}/services/oauth2/authorize?${params.toString()}`,
    codeVerifier,
  };
}

/**
 * Exchange the authorization code for access + refresh tokens (with PKCE)
 */
export async function handleOAuthCallback(
  code: string,
  codeVerifier?: string,
  customCreds?: { clientId: string; clientSecret: string; loginUrl?: string }
): Promise<{
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
  orgId: string;
  userId: string;
}> {
  const useClientId = customCreds?.clientId || SF_CLIENT_ID;
  const useClientSecret = customCreds?.clientSecret || SF_CLIENT_SECRET;
  const useLoginUrl = customCreds?.loginUrl || SF_LOGIN_URL;

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

  const tokenResponse = await fetch(`${useLoginUrl}/services/oauth2/token`, {
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
/**
 * Salesforce REST API version we connect with.
 *
 * jsforce defaults to v50.0 (Winter '21, October 2020) which is far older
 * than OrgPrism needs. Most ARM / Revenue Cloud / RLM standard objects
 * were introduced in later releases:
 *   - ProductSellingModel, ProductRelatedComponent  → v57 (Spring '23)
 *   - AttributeDefinition (RLM schema)              → v58 (Summer '23)
 *   - RateCard, RateCardEntry                       → v59 (Winter '24)
 *   - PricingProcedure, ContextDefinition           → v60 (Spring '24)
 *   - DecisionTable, FulfillmentStepDefinition      → v61 (Summer '24)
 *
 * At v50, ALL of these objects come back as INVALID_TYPE — Salesforce's
 * schema metadata at that version literally doesn't know they exist,
 * regardless of how much data the org actually has.
 *
 * Pinned to v66 (Spring '26) — the latest GA release at time of writing.
 * Bumped from v63 because several RLM Billing/Tax objects (BillingArrangement,
 * BillingArrangementLine, TaxTreatmentItem, PaymentRetryRuleSet,
 * LegalEntityAccountingPeriod) were returning INVALID_TYPE on orgs that
 * demonstrably have those objects — the schema metadata at v63 didn't
 * surface them. The Revenue Cloud Developer Guide we audit against is the
 * Spring '26 edition, which matches v66.
 */
const SF_API_VERSION = '66.0';

export function createConnection(
  instanceUrl: string,
  accessToken: string,
  refreshToken: string,
  orgId?: string,
  // Optional per-org OAuth credentials. When the org was connected via
  // BYO-ECA (customer's own External Client App), pass these so jsforce's
  // internal auto-refresh hook calls Salesforce with the customer's
  // client_id rather than the platform's. Without this, long-running scans
  // hit a hidden second token refresh that fails with "External client
  // app is not installed in this org" — exactly the bug we thought
  // BYO-ECA had fixed.
  oauthCreds?: { clientId: string; clientSecret: string; loginUrl?: string | null } | null
): Connection {
  const conn = new Connection({
    oauth2: getOAuth2(oauthCreds ?? undefined),
    instanceUrl,
    accessToken,
    refreshToken,
    version: SF_API_VERSION,
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

  // Build the per-org OAuth credentials once and reuse them on every
  // createConnection call below so jsforce's auto-refresh hook always
  // talks to Salesforce with the right client_id.
  //
  // BYO-ECA tokens MUST be refreshed against the org's own My Domain —
  // not against the generic `login.salesforce.com` gateway. ECAs are
  // installed Local to a specific org, so the gateway can't route the
  // refresh request to the right org and returns "External client app is
  // not installed in this org". If the stored sf_login_url is the
  // generic gateway (legacy data from an early connect when the modal
  // didn't warn about this), fall back to instance_url which IS the
  // org's My Domain.
  function safeLoginUrl(): string | null {
    const stored = (org.sf_login_url as string | null | undefined) ?? null;
    const isGenericGateway = !stored || stored.startsWith('https://login.salesforce.com') || stored.startsWith('https://test.salesforce.com');
    if (isGenericGateway && typeof org.instance_url === 'string' && org.instance_url.includes('.my.salesforce.com')) {
      return org.instance_url;
    }
    return stored;
  }
  const orgOAuth = org.sf_client_id && org.sf_client_secret
    ? {
        clientId: org.sf_client_id as string,
        clientSecret: org.sf_client_secret as string,
        loginUrl: safeLoginUrl(),
      }
    : null;

  const conn = createConnection(
    org.instance_url,
    org.access_token,
    org.refresh_token,
    orgId,
    orgOAuth
  );

  // Test the connection; if expired, attempt manual refresh (15s timeout)
  try {
    await withTimeout(conn.query('SELECT Id FROM Organization LIMIT 1'), 15000, 'Salesforce connection test');
  } catch (err: any) {
    const msg = err?.message || '';
    // Broad set of "token needs refreshing" signatures. jsforce wraps the
    // upstream Salesforce error and depending on the failure point the
    // wording varies: INVALID_SESSION_ID from SOQL paths, "Session expired"
    // from the older REST shim, "Unable to refresh session" when jsforce's
    // own auto-refresh fails (this is the one we hit when the OAuth2
    // attached to the Connection has stale or wrong client_id — the bug
    // that motivated this catch list expansion).
    if (
      msg.includes('INVALID_SESSION_ID') ||
      msg.includes('Session expired') ||
      msg.includes('Unable to refresh session') ||
      msg.includes('expired access') ||
      msg.includes('401') ||
      msg.includes('timed out')
    ) {
      console.log('Token expired for org', orgId, '— attempting refresh');
      const newTokens = await refreshAccessToken(
        org.refresh_token,
        org.sf_client_id || undefined,
        org.sf_client_secret || undefined,
        safeLoginUrl() || undefined
      );
      if (newTokens) {
        await persistRefreshedToken(orgId, newTokens.accessToken);
        return {
          conn: createConnection(org.instance_url, newTokens.accessToken, org.refresh_token, orgId, orgOAuth),
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
  refreshToken: string,
  customClientId?: string,
  customClientSecret?: string,
  customLoginUrl?: string
): Promise<{ accessToken: string } | null> {
  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: customClientId || SF_CLIENT_ID,
      client_secret: customClientSecret || SF_CLIENT_SECRET,
      refresh_token: refreshToken,
    });

    const tokenUrl = customLoginUrl || SF_LOGIN_URL;
    const res = await withTimeout(
      fetch(`${tokenUrl}/services/oauth2/token`, {
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
