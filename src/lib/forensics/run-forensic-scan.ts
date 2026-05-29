/**
 * Forensic scan orchestrator.
 *
 * Chains AFTER runScanInBackground when the user opts in. Pulls the
 * configured detectors, runs each, takes their results through the
 * attribution tracers, renders plain-English explanations, and persists
 * findings + traces.
 *
 * Lifecycle (mirrored on the forensic_scans.status column):
 *   queued       — row created, not started
 *   running      — detectors fanning out (Bulk API queries in flight)
 *   reconciling  — Bulk done, detector logic running
 *   attributing  — detectors done, attribution + render running
 *   completed    — all findings persisted
 *   partial      — some detectors failed but at least one succeeded
 *   failed       — terminal failure before any findings landed
 *
 * Single-writer per forensic_scan (this module) — read-modify-write is
 * safe on the metadata column without a transaction.
 *
 * Vercel: this is invoked via waitUntil() like the config scan, but is
 * potentially much longer-running (Bulk API jobs). Each detector caps
 * its Bulk poll at ~8 min so a 60s Hobby function can still kick off
 * the job; the actual ingestion is bounded by the request lifetime.
 * For orgs where the Bulk job needs longer, we'd need a follow-up
 * polling endpoint — out of scope for v1.
 */

import { createServiceClient } from '@/lib/db/client';
import { createRefreshableConnection } from '@/lib/salesforce/client';
import REN_001 from './detectors/ren-001-renewal-uplift';
import CLASS_C_TRACER from './attribution/class-c-conflicting';
import { renderFinding } from './renderer';
import type { DetectorContext, ForensicDetector, AttributionTracer, DetectorResult } from './types';

/**
 * Registry of available detectors. Add new ones here as we ship Slices 2+.
 * Each detector is responsible for stating which product types it applies
 * to and whether it's free-tier eligible.
 */
const DETECTORS: ForensicDetector[] = [REN_001];

/**
 * Registry of attribution tracers. The orchestrator runs ALL applicable
 * tracers against each finding and keeps the top candidate.
 */
const TRACERS: AttributionTracer[] = [CLASS_C_TRACER];

/**
 * Free-tier detector allowlist (Strategy C — only REN-001 available on free).
 * Pro+ users get all detectors.
 */
const FREE_TIER_DETECTORS = new Set(['REN-001']);

export interface ForensicScanInput {
  forensicScanId: string;
  organizationId: string;
  userId: string;
  parentScanId: string | null;
  plan: string; // 'free' | 'pro' | 'enterprise'
  isAdmin: boolean;
}

export async function runForensicScanInBackground(input: ForensicScanInput): Promise<void> {
  const { forensicScanId, organizationId, userId, plan, isAdmin } = input;
  const supabase = createServiceClient();
  const startedAt = Date.now();

  try {
    await supabase
      .from('forensic_scans')
      .update({ status: 'running' })
      .eq('id', forensicScanId);

    const { conn, org } = await createRefreshableConnection(organizationId);

    // Resolve which detectors to run. Free tier gets REN-001 only; Pro+ gets everything
    // applicable to their product type. Admins get everything regardless.
    const productType = (org.product_type as string) ?? 'cpq';
    const applicableDetectors = DETECTORS.filter((d) =>
      d.appliesTo.includes(productType as 'cpq' | 'cpq_billing' | 'arm')
    );
    const enabledDetectors = applicableDetectors.filter((d) => {
      if (isAdmin) return true;
      if (plan === 'free') return FREE_TIER_DETECTORS.has(d.id);
      return true; // pro / enterprise: all
    });

    const ctx: DetectorContext = {
      conn,
      organizationId,
      defaultCurrencyIsoCode: (org.currency_iso_code as string) ?? 'USD',
      snapshots: new Map(),
    };

    // Run detectors sequentially in v1. They use Bulk API which is
    // already async on the SF side; running detectors concurrently
    // inside one Vercel function adds memory pressure without speeding
    // anything up.
    await supabase
      .from('forensic_scans')
      .update({ status: 'reconciling' })
      .eq('id', forensicScanId);

    const completed: string[] = [];
    const failed: string[] = [];
    const detectorErrors: Record<string, string> = {};
    const allFindings: Array<{ detector: string; result: DetectorResult }> = [];

    for (const detector of enabledDetectors) {
      try {
        console.log(`[FORENSIC ${forensicScanId}] Running ${detector.id}...`);
        const results = await detector.run(ctx);
        for (const r of results) allFindings.push({ detector: detector.id, result: r });
        completed.push(detector.id);
        console.log(`[FORENSIC ${forensicScanId}] ${detector.id} → ${results.length} findings`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[FORENSIC ${forensicScanId}] ${detector.id} failed: ${msg}`);
        failed.push(detector.id);
        // Persist per-detector error so we can debug without Vercel logs.
        // 500-char cap keeps the metadata column from bloating on noisy
        // stack traces.
        detectorErrors[detector.id] = msg.slice(0, 500);
      }
    }

    // Attribution + render phase.
    await supabase
      .from('forensic_scans')
      .update({ status: 'attributing' })
      .eq('id', forensicScanId);

    let totalVerified = 0;
    for (const { result } of allFindings) {
      // Insert finding row first so we have an ID for the trace FK.
      const { data: findingRow, error: findingErr } = await supabase
        .from('forensic_findings')
        .insert({
          forensic_scan_id: forensicScanId,
          organization_id: organizationId,
          user_id: userId,
          detector_id: result.detectorId,
          severity: result.severity,
          entitled_usd: result.entitledUsd,
          realized_usd: result.realizedUsd,
          gap_usd: result.gapUsd,
          currency_iso_code: result.currencyIsoCode,
          recoverability_score: result.recoverabilityScore,
          source_record_refs: {
            primary_record: result.primaryRecord,
            supporting_records: result.supportingRecords,
          },
          title: result.title,
          description: result.description ?? null,
          metadata: result.metadata ?? {},
        })
        .select('id')
        .single();
      if (findingErr || !findingRow) {
        console.error(`[FORENSIC ${forensicScanId}] Failed to persist finding: ${findingErr?.message}`);
        continue;
      }
      totalVerified += result.gapUsd;

      // Run every applicable tracer. Keep the top candidate as the
      // primary attribution; remaining candidates can be surfaced as
      // "other suspected causes" in a follow-up commit.
      const candidates = (
        await Promise.all(TRACERS.map((t) => t.trace(result, ctx).catch(() => [])))
      ).flat();
      candidates.sort((a, b) => b.confidence - a.confidence);

      const primary = candidates[0];
      if (!primary) continue;

      const rendered = await renderFinding(result, primary);
      await supabase.from('attribution_traces').insert({
        finding_id: findingRow.id,
        user_id: userId,
        root_cause_class: primary.rootCauseClass,
        root_config_type: primary.rootConfigType,
        root_config_id: primary.rootConfigId,
        root_config_name: primary.rootConfigName,
        reason_code: primary.reasonCode,
        confidence: primary.confidence,
        evidence: primary.evidence,
        ai_explanation: rendered.plainEnglish,
        ai_suggested_fix: rendered.suggestedFix,
        ai_model: rendered.model,
        ai_rendered_at: new Date().toISOString(),
      });
    }

    // Final scan record update.
    const finalStatus = failed.length === 0 ? 'completed' : completed.length === 0 ? 'failed' : 'partial';
    await supabase
      .from('forensic_scans')
      .update({
        status: finalStatus,
        detectors_completed: completed,
        detectors_failed: failed,
        total_verified_usd: Math.round(totalVerified * 100) / 100,
        finding_count: allFindings.length,
        completed_at: new Date().toISOString(),
        metadata: {
          duration_ms: Date.now() - startedAt,
          product_type: productType,
          detector_errors: Object.keys(detectorErrors).length > 0 ? detectorErrors : undefined,
        },
      })
      .eq('id', forensicScanId);

    console.log(
      `[FORENSIC ${forensicScanId}] ✅ ${finalStatus} — ${allFindings.length} findings, total verified $${Math.round(totalVerified).toLocaleString()}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FORENSIC ${forensicScanId}] terminal failure:`, message);
    await supabase
      .from('forensic_scans')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: message,
      })
      .eq('id', forensicScanId);
  }
}
