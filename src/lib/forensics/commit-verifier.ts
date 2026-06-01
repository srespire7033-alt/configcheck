/**
 * Commit verifier — v2 auto-attestation for recovery actions.
 *
 * After a consultant uploads a recovery CSV via Data Loader and clicks
 * Mark Committed, we re-query the affected Salesforce record to check
 * the patch actually landed. Result stored on
 * recovery_action.metadata.commit_verification.
 *
 * Per detector:
 *   REN-001    expected: QuoteLine.SBQQ__NetPrice__c ≈ corrected uplift price
 *   REN-002    expected: QuoteLine.SBQQ__NetPrice__c ≥ current Pricebook list × 0.9
 *   DSC-FOR-001 expected: QuoteLine.SBQQ__Discount__c is 0 or null
 *   ORD-FOR-001 expected: Order has at least one related BillingSchedule
 *                          via OrderItem → blng__OrderProduct__c
 *   QL-FOR-001 expected: QuoteLine.SBQQ__NetPrice__c > 0
 *
 * Pure-functional inputs; the dispatcher calls Salesforce. v1
 * deliberately keeps the verifier short — it answers "did the field
 * value change" not "did the business outcome happen." If verification
 * fails we surface a warning but don't block the commit (the consultant
 * may have done the right thing in a way we don't recognize).
 */

import type { Connection } from 'jsforce';

export interface CommitVerificationResult {
  /** True iff the on-org value matches what we expected after recovery. */
  verified: boolean;
  /** ISO timestamp when verification ran. */
  verified_at: string;
  /** What the recovery action intended to leave on the record (per-detector). */
  expected_value: string | number | null;
  /** What we read back from Salesforce. */
  actual_value: string | number | null;
  /** Plain-English explanation for the UI tooltip. */
  message: string;
}

interface FindingForVerification {
  id: string;
  detector_id: string;
  source_record_refs: unknown;
  metadata: unknown;
}

interface PrimaryRecord {
  type: string;
  id: string;
  name?: string;
}

function getPrimaryRecord(finding: FindingForVerification): PrimaryRecord | null {
  const refs = finding.source_record_refs as { primary_record?: PrimaryRecord } | null;
  return refs?.primary_record ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Dispatch by detector. Returns a verification result, or null if the
 * detector doesn't have a verifier yet (caller treats null as
 * "skipped — verification not available for this detector").
 */
export async function verifyCommit(
  finding: FindingForVerification,
  conn: Connection
): Promise<CommitVerificationResult | null> {
  switch (finding.detector_id) {
    case 'REN-001':
      return verifyRen001(finding, conn);
    case 'REN-002':
      return verifyRen002(finding, conn);
    case 'DSC-FOR-001':
      return verifyDscFor001(finding, conn);
    case 'ORD-FOR-001':
      return verifyOrdFor001(finding, conn);
    case 'ORD-FOR-002':
      return verifyOrdFor002(finding, conn);
    case 'QL-FOR-001':
      return verifyQlFor001(finding, conn);
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Per-detector verifiers
// ─────────────────────────────────────────────────────────────────────

async function verifyRen001(
  finding: FindingForVerification,
  conn: Connection
): Promise<CommitVerificationResult> {
  const meta = (finding.metadata as Record<string, unknown>) ?? {};
  const primary = getPrimaryRecord(finding);
  if (!primary) {
    return failed('No QuoteLine ID on finding — cannot verify.');
  }
  const upliftPct = (meta.uplift_pct_entitled as number | undefined) ?? 0;
  const originalPerUnit = (meta.original_price_per_unit as number | undefined) ?? 0;
  const fraction = upliftPct > 1 ? upliftPct / 100 : upliftPct;
  const expectedNetPrice = Math.round(originalPerUnit * (1 + fraction) * 100) / 100;

  try {
    const res = await conn.query<{ SBQQ__NetPrice__c: string | number }>(
      `SELECT SBQQ__NetPrice__c FROM SBQQ__QuoteLine__c WHERE Id = '${primary.id}' LIMIT 1`
    );
    if (res.records.length === 0) {
      return failed('QuoteLine no longer exists — verification not possible.');
    }
    const actual = Number(res.records[0].SBQQ__NetPrice__c ?? 0);
    // Tolerance: ±$1 to absorb float drift.
    const verified = Math.abs(actual - expectedNetPrice) < 1;
    return {
      verified,
      verified_at: nowIso(),
      expected_value: expectedNetPrice,
      actual_value: actual,
      message: verified
        ? `QuoteLine NetPrice is ${actual.toLocaleString()}, matches expected ${expectedNetPrice.toLocaleString()}.`
        : `QuoteLine NetPrice is ${actual.toLocaleString()} but expected ${expectedNetPrice.toLocaleString()}. The CSV upload may not have landed.`,
    };
  } catch (e) {
    return failed(`Verification query failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function verifyRen002(
  finding: FindingForVerification,
  conn: Connection
): Promise<CommitVerificationResult> {
  const meta = (finding.metadata as Record<string, unknown>) ?? {};
  const primary = getPrimaryRecord(finding);
  if (!primary) return failed('No QuoteLine ID on finding — cannot verify.');

  const expectedList = (meta.current_list_price as number | undefined) ?? 0;
  const tolerance = expectedList * 0.9; // 10% negotiation tolerance, same as the detector

  try {
    const res = await conn.query<{ SBQQ__NetPrice__c: string | number }>(
      `SELECT SBQQ__NetPrice__c FROM SBQQ__QuoteLine__c WHERE Id = '${primary.id}' LIMIT 1`
    );
    if (res.records.length === 0) return failed('QuoteLine no longer exists.');
    const actual = Number(res.records[0].SBQQ__NetPrice__c ?? 0);
    const verified = actual >= tolerance;
    return {
      verified,
      verified_at: nowIso(),
      expected_value: `>= ${tolerance.toFixed(2)} (current list × 0.9)`,
      actual_value: actual,
      message: verified
        ? `QuoteLine NetPrice (${actual.toLocaleString()}) is within 10% of current list.`
        : `QuoteLine NetPrice (${actual.toLocaleString()}) is still below 90% of current list ${expectedList.toLocaleString()}. Patch may not have landed.`,
    };
  } catch (e) {
    return failed(`Verification query failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function verifyDscFor001(
  finding: FindingForVerification,
  conn: Connection
): Promise<CommitVerificationResult> {
  const primary = getPrimaryRecord(finding);
  if (!primary) return failed('No QuoteLine ID on finding — cannot verify.');

  try {
    const res = await conn.query<{ SBQQ__Discount__c: string | number | null }>(
      `SELECT SBQQ__Discount__c FROM SBQQ__QuoteLine__c WHERE Id = '${primary.id}' LIMIT 1`
    );
    if (res.records.length === 0) return failed('QuoteLine no longer exists.');
    const actual = Number(res.records[0].SBQQ__Discount__c ?? 0);
    const verified = actual === 0;
    return {
      verified,
      verified_at: nowIso(),
      expected_value: 0,
      actual_value: actual,
      message: verified
        ? 'Discount removed — QuoteLine no longer carries the expired/open-ended promo.'
        : `Discount is still ${actual}%. The CSV upload may not have removed it.`,
    };
  } catch (e) {
    return failed(`Verification query failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function verifyOrdFor001(
  finding: FindingForVerification,
  conn: Connection
): Promise<CommitVerificationResult> {
  const primary = getPrimaryRecord(finding);
  if (!primary) return failed('No Order ID on finding — cannot verify.');

  // ORD-FOR-001 recovery is "generate billing schedules." We verify by
  // counting BillingSchedules linked to the Order via OrderItem.
  try {
    const itemsRes = await conn.query<{ Id: string }>(
      `SELECT Id FROM OrderItem WHERE OrderId = '${primary.id}'`
    );
    const itemIds = itemsRes.records.map((r) => r.Id);
    if (itemIds.length === 0) {
      return failed('Order has no OrderItems — cannot verify billing schedules.');
    }
    const schedulesRes = await conn.query<{ Id: string }>(
      `SELECT Id FROM blng__BillingSchedule__c WHERE blng__OrderProduct__c IN (${itemIds.map((id) => `'${id}'`).join(',')})`
    );
    const scheduleCount = schedulesRes.records.length;
    const verified = scheduleCount > 0;
    return {
      verified,
      verified_at: nowIso(),
      expected_value: '>= 1 BillingSchedule',
      actual_value: scheduleCount,
      message: verified
        ? `Order now has ${scheduleCount} billing schedule${scheduleCount === 1 ? '' : 's'} — generation succeeded.`
        : 'No billing schedules found for this Order. The Generate Billing Schedule action may not have run.',
    };
  } catch (e) {
    return failed(`Verification query failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function verifyOrdFor002(
  finding: FindingForVerification,
  conn: Connection
): Promise<CommitVerificationResult> {
  const meta = (finding.metadata as Record<string, unknown>) ?? {};
  const quoteNet = (meta.quote_net_amount as number | undefined) ?? 0;
  const orderIds = (meta.order_ids as string[] | undefined) ?? [];
  if (orderIds.length === 0) {
    return failed('No Order IDs on finding — cannot verify.');
  }

  try {
    const res = await conn.query<{ TotalAmount: string | number | null }>(
      `SELECT TotalAmount FROM Order WHERE Id IN (${orderIds.map((id) => `'${id}'`).join(',')})`
    );
    const actualSum = res.records.reduce((s, r) => s + Number(r.TotalAmount ?? 0), 0);
    // "Exact match" per spec — $0.01 tolerance for float drift only.
    const verified = Math.abs(actualSum - quoteNet) <= 0.01;
    return {
      verified,
      verified_at: nowIso(),
      expected_value: quoteNet,
      actual_value: round2Verif(actualSum),
      message: verified
        ? `Order total sum (${actualSum.toLocaleString()}) now matches Quote Net Amount (${quoteNet.toLocaleString()}).`
        : `Order total sum is ${actualSum.toLocaleString()} but Quote Net Amount is ${quoteNet.toLocaleString()}. Variance ${(actualSum - quoteNet).toLocaleString()} remains — patch may not have landed.`,
    };
  } catch (e) {
    return failed(`Verification query failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function round2Verif(n: number): number {
  return Math.round(n * 100) / 100;
}

async function verifyQlFor001(
  finding: FindingForVerification,
  conn: Connection
): Promise<CommitVerificationResult> {
  const primary = getPrimaryRecord(finding);
  if (!primary) return failed('No QuoteLine ID on finding — cannot verify.');

  try {
    const res = await conn.query<{ SBQQ__NetPrice__c: string | number }>(
      `SELECT SBQQ__NetPrice__c FROM SBQQ__QuoteLine__c WHERE Id = '${primary.id}' LIMIT 1`
    );
    if (res.records.length === 0) return failed('QuoteLine no longer exists.');
    const actual = Number(res.records[0].SBQQ__NetPrice__c ?? 0);
    const verified = actual > 0;
    return {
      verified,
      verified_at: nowIso(),
      expected_value: '> 0',
      actual_value: actual,
      message: verified
        ? `Required-option NetPrice is now ${actual.toLocaleString()}.`
        : 'QuoteLine NetPrice is still $0 — restoration may not have been uploaded.',
    };
  } catch (e) {
    return failed(`Verification query failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function failed(message: string): CommitVerificationResult {
  return {
    verified: false,
    verified_at: nowIso(),
    expected_value: null,
    actual_value: null,
    message,
  };
}
