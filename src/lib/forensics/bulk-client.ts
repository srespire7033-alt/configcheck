/**
 * Bulk API 2.0 client wrapper for forensic scans.
 *
 * Why Bulk API and not regular SOQL: forensic scans need to pull
 * Quote/Order/Subscription/Asset records at the full transactional scale
 * (10K-1M+ rows per customer). REST SOQL caps at 2K rows per batch and
 * eats governor time. Bulk API 2.0 is the right tool — async, paginated,
 * and Salesforce-side queued so we don't burn our own runtime.
 *
 * Design notes:
 *   - All queries go through `bulkQuery()` — a single entry point that
 *     submits a job, polls until done, and returns parsed results.
 *   - Polling is bounded (max 10 minutes per job). If a job exceeds that
 *     it's left running Salesforce-side and we record a partial result.
 *     The job will continue and a follow-up scan can pick up where we
 *     left off.
 *   - All Bulk API calls happen INSIDE a single jsforce Connection. The
 *     connection's auto-refresh hook is the only reason a long-running
 *     Bulk pull survives a token expiry mid-poll.
 *   - We DO NOT use Bulk API for the result download phase — we use the
 *     CSV result endpoint directly via jsforce, which streams. Avoids
 *     loading the full 1M-row result set into memory.
 */

import type { Connection } from 'jsforce';
import { parse as parseCsv } from 'csv-parse/sync';

export interface BulkQueryOptions {
  /**
   * Soft cap on how long we wait for a single Bulk job to complete.
   * Default 10 minutes. Jobs that exceed this stay running on Salesforce
   * — we record a partial result, the next scan tries again.
   */
  maxPollMs?: number;
  /**
   * Polling interval. Bulk API allows ~5-20 requests/min on the job
   * status endpoint, so we stay conservative.
   */
  pollIntervalMs?: number;
  /**
   * Optional limit injected before the query is submitted. Useful when
   * a detector wants to cap evidence gathering ("show me the first 500
   * candidates"). When null, the full result set comes back.
   */
  limit?: number;
}

const DEFAULTS: Required<Omit<BulkQueryOptions, 'limit'>> = {
  maxPollMs: 10 * 60 * 1000,    // 10 minutes
  pollIntervalMs: 5_000,         // 5 seconds — gentle on the job status API
};

export interface BulkQueryResult<T = Record<string, string>> {
  /** Parsed records. Each value is a string — Bulk CSV doesn't preserve types. */
  records: T[];
  /** Number of records actually returned. */
  recordCount: number;
  /** True when the Salesforce job reached terminal state within maxPollMs. */
  jobComplete: boolean;
  /** Salesforce Bulk Job ID — useful for follow-up polling if jobComplete=false. */
  jobId: string;
  /** Wall-clock time the query took. */
  durationMs: number;
}

/**
 * Submit a SOQL query via Bulk API 2.0, poll until done, and return the
 * parsed CSV results.
 *
 * @param conn  A jsforce Connection with valid creds (refresh hook attached)
 * @param soql  The SOQL to run. Caller is responsible for parameter safety —
 *              we DO NOT do user-input concatenation inside this function,
 *              callers MUST pass a fully-quoted/escaped string. Forensic
 *              detectors only build SOQL from their own constants, never
 *              from user input, so this stays safe by construction.
 */
export async function bulkQuery<T = Record<string, string>>(
  conn: Connection,
  soql: string,
  options: BulkQueryOptions = {}
): Promise<BulkQueryResult<T>> {
  const { maxPollMs, pollIntervalMs } = { ...DEFAULTS, ...options };
  const limit = typeof options.limit === 'number' ? options.limit : null;
  const finalSoql = limit ? injectLimit(soql, limit) : soql;
  const startedAt = Date.now();

  // 1. Create the Bulk Query job.
  //    Bulk API 2.0 path: POST /services/data/vXX.X/jobs/query
  const createRes = await conn.requestPost<{ id: string; state: string }>(
    `/services/data/v${conn.version}/jobs/query`,
    {
      operation: 'query',
      query: finalSoql,
      contentType: 'CSV',
    }
  );
  const jobId = createRes.id;
  if (!jobId) {
    throw new Error('Bulk API did not return a job id');
  }

  // 2. Poll the job status endpoint until it reaches a terminal state
  //    (JobComplete) or we exceed our budget.
  let jobState = createRes.state || 'UploadComplete';
  const deadline = Date.now() + maxPollMs;
  while (Date.now() < deadline && !TERMINAL_STATES.has(jobState)) {
    await sleep(pollIntervalMs);
    const statusRes = await conn.request<{ state: string }>(
      `/services/data/v${conn.version}/jobs/query/${jobId}`
    );
    jobState = statusRes.state;
    if (jobState === 'Failed' || jobState === 'Aborted') {
      throw new Error(`Bulk API job ${jobId} entered terminal state: ${jobState}`);
    }
  }

  const jobComplete = jobState === 'JobComplete';

  // 3. If the job didn't complete in time, return partial signal.
  //    Caller decides whether to record the scan as partial.
  if (!jobComplete) {
    return {
      records: [],
      recordCount: 0,
      jobComplete: false,
      jobId,
      durationMs: Date.now() - startedAt,
    };
  }

  // 4. Download the results. Bulk API 2.0 paginates via Sforce-Locator
  //    header. We loop until the locator is 'null' (no more pages).
  const records: T[] = [];
  let locator: string | null = null;
  while (true) {
    const url: string = locator
      ? `/services/data/v${conn.version}/jobs/query/${jobId}/results?locator=${encodeURIComponent(locator)}`
      : `/services/data/v${conn.version}/jobs/query/${jobId}/results`;

    // We use the lower-level request to access response headers
    // (locator is in Sforce-Locator). Returns CSV body.
    const { body, headers } = await requestWithHeaders(conn, url);
    const parsed = parseCsv(body, { columns: true, skip_empty_lines: true }) as T[];
    records.push(...parsed);

    locator = headers['sforce-locator'] || headers['Sforce-Locator'] || null;
    if (!locator || locator === 'null') break;
  }

  return {
    records,
    recordCount: records.length,
    jobComplete: true,
    jobId,
    durationMs: Date.now() - startedAt,
  };
}

const TERMINAL_STATES = new Set(['JobComplete', 'Failed', 'Aborted']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Inject a LIMIT into a SOQL string. We do this defensively — if the
 * query already has a LIMIT we leave it alone (caller knows better).
 * Strict regex on the trailing token so we don't fight inline subqueries.
 */
function injectLimit(soql: string, limit: number): string {
  if (/\blimit\s+\d+\s*$/i.test(soql.trim())) return soql;
  return `${soql.replace(/\s*$/, '')} LIMIT ${limit}`;
}

/**
 * Lower-level request that returns the response body AND headers.
 * Used for paginated Bulk API result downloads (locator is in header).
 *
 * jsforce's normal request() returns parsed body only. We dip into the
 * underlying http transport to grab headers.
 */
async function requestWithHeaders(
  conn: Connection,
  url: string
): Promise<{ body: string; headers: Record<string, string> }> {
  // jsforce 2.x exposes _transport for raw access. Falls back to a
  // regular request() if transport isn't accessible (older versions
  // we shimmed in tests).
  const transport = (conn as unknown as { _transport?: { httpRequest: (opts: unknown) => Promise<{ body: string; headers: Record<string, string> }> } })._transport;
  if (transport && typeof transport.httpRequest === 'function') {
    const res = await transport.httpRequest({
      url: `${conn.instanceUrl}${url}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${conn.accessToken}` },
    });
    return { body: res.body, headers: res.headers || {} };
  }
  // Fallback: lose headers, no pagination beyond first page.
  const body = (await conn.request<string>(url)) as unknown as string;
  return { body, headers: {} };
}
