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
   * Which dashboard surface the findings belong on.
   *
   *   revenue_leakage — quantifiable $ already lost; goes on the
   *                     Revenue Leakage card + Recovery Queue.
   *   governance      — process/audit issues; $ ambiguous or N/A.
   *                     Goes on the Governance Risk card. NOT
   *                     stageable in Recovery Queue.
   *   pipeline        — prospective revenue (at risk, not yet lost).
   *                     Goes on the Pipeline Risk card. Drives a
   *                     'take action' workflow, not a CSV patch.
   *
   * Defaults to 'revenue_leakage' when omitted (back-compat).
   */
  category?: 'revenue_leakage' | 'governance' | 'pipeline';

  /**
   * Run the detector against the org. Returns one DetectorResult per
   * leaking record. Empty array means no leaks found (good news).
   */
  run(ctx: DetectorContext): Promise<DetectorResult[]>;
}

/**
 * Category lookup keyed by detector_id — used by API endpoints + UI
 * to bucket findings without re-loading the detector registry. Kept
 * in sync with the `category` field on each detector definition.
 *
 * Detectors NOT listed here default to 'revenue_leakage' (the legacy
 * behavior — every detector that existed before Slice 12 is a $-leak).
 */
export const DETECTOR_CATEGORY: Record<string, 'revenue_leakage' | 'governance' | 'pipeline'> = {
  // Revenue Leakage (\$-quantifiable, retrospective)
  'REN-001': 'revenue_leakage',
  'REN-002': 'revenue_leakage',
  'DSC-FOR-001': 'revenue_leakage',
  'DSC-FOR-002': 'revenue_leakage',
  'QL-FOR-001': 'revenue_leakage',
  'ORD-FOR-001': 'revenue_leakage',
  'ORD-FOR-002': 'revenue_leakage',
  'ORD-FOR-003': 'revenue_leakage',
  'SUB-FOR-001': 'revenue_leakage',
  'PROV-FOR-001': 'revenue_leakage',
  'PROV-FOR-002': 'revenue_leakage',
  'AST-FOR-001': 'revenue_leakage',
  'CT-FOR-001': 'revenue_leakage',
  'MDQ-FOR-001': 'revenue_leakage',
  // Governance (process/audit, no \$ claim)
  'OPP-FOR-001': 'governance',
  'CON-FOR-001': 'governance',
  'AMD-FOR-001': 'governance',
  'QL-FOR-002': 'governance',
  // Pipeline (prospective ARR at risk)
  'REN-003': 'pipeline',
  'REN-004': 'pipeline',
};

export function getDetectorCategory(detectorId: string): 'revenue_leakage' | 'governance' | 'pipeline' {
  return DETECTOR_CATEGORY[detectorId] ?? 'revenue_leakage';
}

/**
 * Effort-to-fix classification per detector. Used by the UI to surface
 * a 'Low/Med/High effort' badge on each finding and to drive the
 * \$-Impact × Effort matrix card.
 *
 * Heuristic (consultant rule of thumb):
 *   low    — single point-and-click change, one workflow toggle, or a
 *            small bulk data update via Data Loader (one CSV upload).
 *   medium — non-trivial data correction (per-quote/per-order fixes),
 *            an approval-policy change, or a config rule rewrite.
 *   high   — schema work, system integration, code change, or a
 *            finance-process change that touches accounting.
 *
 * Defaults to 'medium' when omitted (back-compat).
 */
export type EffortLevel = 'low' | 'medium' | 'high';

export const DETECTOR_EFFORT: Record<string, EffortLevel> = {
  // Renewals — most are data fixes via Data Loader (medium); the
  // governance/pipeline-flavored ones are workflow-light (low).
  'REN-001': 'medium',
  'REN-002': 'medium',
  'REN-003': 'low',
  'REN-004': 'low',
  // Discounts — policy + data work.
  'DSC-FOR-001': 'medium',
  'DSC-FOR-002': 'medium',
  // Quote Lines.
  'QL-FOR-001': 'medium',
  'QL-FOR-002': 'low',
  // Orders — Q↔O variance is data correction; missing billing schedule
  // is a system-integration / process redesign.
  'ORD-FOR-001': 'high',
  'ORD-FOR-002': 'medium',
  'ORD-FOR-003': 'medium',
  // Subscriptions / provisioning.
  'SUB-FOR-001': 'medium',
  'PROV-FOR-001': 'high',
  'PROV-FOR-002': 'medium',
  // Governance.
  'OPP-FOR-001': 'low',
  'CON-FOR-001': 'low',
  'AMD-FOR-001': 'low',
  // Asset terminations touch credit-memo accounting — high.
  'AST-FOR-001': 'high',
  // Contracted prices.
  'CT-FOR-001': 'medium',
  // MDQ — config + data, high.
  'MDQ-FOR-001': 'high',
};

export function getDetectorEffort(detectorId: string): EffortLevel {
  return DETECTOR_EFFORT[detectorId] ?? 'medium';
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
