/**
 * Forensic engine shared types.
 *
 * The engine has 3 layers that talk to each other through these types:
 *
 *   1. Detector — pulls records via Bulk API, reconciles entitled vs
 *      realized, emits DetectorResult per finding.
 *   2. Attribution tracer — takes a DetectorResult + the relevant config
 *      metadata, identifies the root cause class (A-E) and config object,
 *      emits AttributionCandidate.
 *   3. Renderer — takes the attribution + the original finding, produces
 *      plain-English explanation (AI or template fallback).
 *
 * The types are kept lean so detectors stay independent of the persistence
 * layer (they don't talk to Supabase directly — the orchestrator persists).
 */

import type { Connection } from 'jsforce';

/**
 * The 5 attribution root cause classes. See the migration's
 * attribution_traces table comment for the canonical definitions.
 */
export type RootCauseClass = 'A' | 'B' | 'C' | 'D' | 'E';

export const ROOT_CAUSE_LABELS: Record<RootCauseClass, string> = {
  A: 'Process & system disconnect',
  B: 'Manual override',
  C: 'Conflicting automation',
  D: 'Missing governance',
  E: 'Poor data quality',
};

/**
 * Output of a forensic detector for a single finding. Always per-record —
 * we emit one DetectorResult per leaky transactional record (Order,
 * Subscription, Quote, etc.). Aggregation happens at the persistence
 * layer.
 */
export interface DetectorResult {
  detectorId: string;
  severity: 'critical' | 'warning' | 'info';

  /** What the contract entitled, in transactional currency. */
  entitledUsd: number;
  /** What was actually quoted/billed. */
  realizedUsd: number;
  /** entitled - realized; positive = leak. */
  gapUsd: number;
  currencyIsoCode: string;

  /** 0.0-1.0. Some leaks are structurally unrecoverable. */
  recoverabilityScore: number;

  /** The primary leaking record. */
  primaryRecord: SourceRecord;
  /** Supporting records that contextualize the finding (contract, subscription, etc.). */
  supportingRecords: SourceRecord[];

  title: string;
  description?: string;

  /** Detector-specific fields for the attribution tracer. */
  metadata?: Record<string, unknown>;
}

/**
 * A reference to a Salesforce record. Only IDs and lightweight metadata —
 * no Account names, no Contact emails, no Opportunity descriptions. The
 * privacy guarantee runs through this type: if a detector wants to attach
 * a name, it MUST be a record name (Order Number, Quote Number) not a
 * person/company name.
 */
export interface SourceRecord {
  type: string;          // e.g. 'Order', 'SBQQ__Subscription__c'
  id: string;            // SF ID
  name: string;          // Record name (Order Number, Quote Number, etc.)
  /** Financial fields relevant to this record's role in the finding. */
  financials?: Record<string, number | string | null>;
}

/**
 * A candidate root cause identified by the attribution tracer. The
 * tracer can produce multiple candidates per finding (ranked by
 * confidence); the highest-confidence one becomes the primary trace.
 */
export interface AttributionCandidate {
  rootCauseClass: RootCauseClass;
  rootConfigType: string;       // 'SBQQ__PriceRule__c', 'Flow', etc.
  rootConfigId: string | null;  // null when the config exists but ID is opaque (Flow def)
  rootConfigName: string;
  reasonCode: string;           // stable enum the renderer uses for prompt templates
  confidence: number;           // 0.0-1.0

  /** Deterministic evidence — the renderer is required to ground its prose in these facts. */
  evidence: Record<string, unknown>;
}

/**
 * What a detector runner gets at invocation time. The orchestrator
 * supplies the connection, the org's currency, and any cached
 * snapshots from prior scans so detectors can reuse them.
 */
export interface DetectorContext {
  conn: Connection;
  organizationId: string;
  defaultCurrencyIsoCode: string;
  /**
   * Cached record snapshots from this scan or a recent prior scan.
   * Detectors should prefer these over fresh Bulk pulls when fresh
   * enough. Keyed by SObject name.
   */
  snapshots: Map<string, SourceRecord[]>;
}

/**
 * The contract every forensic detector implements.
 */
export interface ForensicDetector {
  /** Stable check ID (REN-001, DSC-FOR-001, etc.). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** What product types this detector applies to. */
  appliesTo: Array<'cpq' | 'cpq_billing' | 'arm'>;
  /** Free-tier eligible (Strategy C — only REN-001 in v1). */
  freeTier: boolean;

  /**
   * Run the detector against the org. Returns one DetectorResult per
   * leaking record. Empty array means no leaks found (good news).
   */
  run(ctx: DetectorContext): Promise<DetectorResult[]>;
}

/**
 * What an attribution tracer implements. One tracer per root cause
 * class. The orchestrator runs all 5 tracers against each finding and
 * keeps the highest-confidence candidate (or all above a threshold).
 */
export interface AttributionTracer {
  rootCauseClass: RootCauseClass;
  /**
   * Identify whether this root cause class explains the finding. Returns
   * 0+ candidates ranked by confidence. Empty array = this class doesn't
   * apply.
   */
  trace(finding: DetectorResult, ctx: DetectorContext): Promise<AttributionCandidate[]>;
}
