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
import REN_002 from './detectors/ren-002-below-current-list';
import DSC_FOR_001 from './detectors/dsc-for-001-promo-rolloff';
import QL_FOR_001 from './detectors/ql-for-001-bundle-option-free';
import ORD_FOR_001 from './detectors/ord-for-001-order-no-billing';
import ORD_FOR_002 from './detectors/ord-for-002-quote-order-variance';
import ORD_FOR_003 from './detectors/ord-for-003-quote-order-variance-amendment';
import CLASS_A_TRACER from './attribution/class-a-system-disconnect';
import CLASS_B_TRACER from './attribution/class-b-manual-override';
import CLASS_C_TRACER from './attribution/class-c-conflicting';
import CLASS_D_TRACER from './attribution/class-d-governance';
import CLASS_E_TRACER from './attribution/class-e-data-quality';
import { renderFinding } from './renderer';
import { sendForensicScanNotification } from '@/lib/email/notifications';
import { computeDiff, type DiffFinding } from '@/lib/forensics/diff';
import type { DetectorContext, ForensicDetector, AttributionTracer, DetectorResult } from './types';

/**
 * Registry of available detectors. Add new ones here as we ship Slices 2+.
 * Each detector is responsible for stating which product types it applies
 * to and whether it's free-tier eligible.
 */
const DETECTORS: ForensicDetector[] = [REN_001, REN_002, DSC_FOR_001, QL_FOR_001, ORD_FOR_001, ORD_FOR_002, ORD_FOR_003];

/**
 * Registry of attribution tracers. The orchestrator runs ALL applicable
 * tracers against each finding and keeps the top candidate.
 */
const TRACERS: AttributionTracer[] = [CLASS_A_TRACER, CLASS_B_TRACER, CLASS_C_TRACER, CLASS_D_TRACER, CLASS_E_TRACER];

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

    // Run detectors in PARALLEL — each does its own Bulk API job which
    // is async server-side anyway, so concurrent execution just doubles
    // up the wait, not the work. Halves wall-clock time vs sequential
    // and is critical for staying inside Vercel Hobby's 60s budget when
    // multiple detectors are enabled.
    console.log(`[FORENSIC ${forensicScanId}] Running ${enabledDetectors.length} detectors in parallel...`);
    const results = await Promise.allSettled(
      enabledDetectors.map((d) =>
        d.run(ctx).then(
          (r) => ({ detectorId: d.id, results: r }),
          (e) => Promise.reject({ detectorId: d.id, err: e })
        )
      )
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const finding of r.value.results) {
          allFindings.push({ detector: r.value.detectorId, result: finding });
        }
        completed.push(r.value.detectorId);
        console.log(`[FORENSIC ${forensicScanId}] ${r.value.detectorId} → ${r.value.results.length} findings`);
      } else {
        const reason = r.reason as { detectorId?: string; err?: unknown } | undefined;
        const detectorId = reason?.detectorId ?? 'unknown';
        const errVal = reason?.err;
        const msg = errVal instanceof Error ? errVal.message : String(errVal);
        console.error(`[FORENSIC ${forensicScanId}] ${detectorId} failed: ${msg}`);
        failed.push(detectorId);
        detectorErrors[detectorId] = msg.slice(0, 500);
      }
    }

    // Attribution + render phase.
    await supabase
      .from('forensic_scans')
      .update({ status: 'attributing' })
      .eq('id', forensicScanId);

    // Per-finding attribution + render in PARALLEL.
    //
    // Class C and Class D tracers cache their expensive setup work
    // (describe + rules SOQL + Flow query) via WeakMap-on-Connection,
    // so the FIRST tracer call hits Salesforce; the rest are in-process
    // filters. That makes per-finding work cheap enough to run all
    // findings concurrently — the only thing that scales linearly is
    // the Supabase INSERT (one finding + one trace per).
    //
    // Combined with parallel detectors above, the entire forensic
    // phase for ~20 findings completes in <15s wall time on the test
    // fixture. Comfortable inside the 60s function budget.
    let totalVerified = 0;
    await Promise.allSettled(
      allFindings.map(async ({ result }) => {
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
          return;
        }
        totalVerified += result.gapUsd;

        const candidates = (
          await Promise.all(TRACERS.map((t) => t.trace(result, ctx).catch(() => [])))
        ).flat();
        candidates.sort((a, b) => b.confidence - a.confidence);
        const primary = candidates[0];
        if (!primary) return;

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
      })
    );

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

    // Fire-and-forget email notification. Wrapped so a failed send
    // (Resend down, no API key, etc.) never blocks the scan completion.
    try {
      await sendForensicCompletionEmail(supabase, {
        forensicScanId,
        organizationId,
        userId,
        finalStatus: finalStatus as 'completed' | 'partial' | 'failed',
        allFindings,
        totalVerified,
      });
    } catch (emailErr) {
      console.warn(
        `[FORENSIC ${forensicScanId}] email notification failed:`,
        emailErr instanceof Error ? emailErr.message : emailErr
      );
    }
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
    // Best-effort failure notification.
    try {
      await sendForensicCompletionEmail(supabase, {
        forensicScanId,
        organizationId,
        userId,
        finalStatus: 'failed',
        allFindings: [],
        totalVerified: 0,
        errorMessage: message,
      });
    } catch {
      // swallow — already in the error path
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Email notification helper
// ─────────────────────────────────────────────────────────────────────

const DETECTOR_LABELS_EMAIL: Record<string, string> = {
  'REN-001': 'Renewal uplift suppressed',
  'REN-002': 'Renewal below current list',
  'DSC-FOR-001': 'Promo discount roll-off',
  'QL-FOR-001': 'Bundle option charged at $0',
  'ORD-FOR-001': 'Order activated, no billing schedule',
  'ORD-FOR-002': 'Q↔O variance (new business)',
  'ORD-FOR-003': 'Q↔O variance (amendment)',
};

interface EmailDispatchArgs {
  forensicScanId: string;
  organizationId: string;
  userId: string;
  finalStatus: 'completed' | 'partial' | 'failed';
  allFindings: Array<{ detector: string; result: DetectorResult }>;
  totalVerified: number;
  errorMessage?: string;
}

async function sendForensicCompletionEmail(
  supabase: ReturnType<typeof createServiceClient>,
  args: EmailDispatchArgs
): Promise<void> {
  // Pull org metadata for the email subject/body.
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', args.organizationId)
    .single();
  if (!org) {
    console.warn(`[FORENSIC ${args.forensicScanId}] cannot send email — org not found`);
    return;
  }

  // Per-detector aggregation for the email.
  const detectorAgg = new Map<string, { count: number; gap: number }>();
  for (const { result } of args.allFindings) {
    let agg = detectorAgg.get(result.detectorId);
    if (!agg) {
      agg = { count: 0, gap: 0 };
      detectorAgg.set(result.detectorId, agg);
    }
    agg.count += 1;
    agg.gap += Number(result.gapUsd);
  }
  const topDetectors = Array.from(detectorAgg.entries())
    .map(([id, a]) => ({
      id,
      label: DETECTOR_LABELS_EMAIL[id] ?? id,
      finding_count: a.count,
      gap_usd: a.gap,
    }))
    .sort((x, y) => y.gap_usd - x.gap_usd)
    .slice(0, 5);

  const topFindings = args.allFindings
    .slice()
    .sort((x, y) => Number(y.result.gapUsd) - Number(x.result.gapUsd))
    .slice(0, 5)
    .map(({ result }) => ({
      detector_id: result.detectorId,
      title: result.title,
      gap_usd: Number(result.gapUsd),
    }));

  // Diff vs previous forensic scan, if one exists for this org.
  let diff: {
    net_delta_usd: number;
    net_delta_pct: number;
    new_count: number;
    escalated_count: number;
    resolved_count: number;
    improved_count: number;
    from_scan_date: string | null;
  } | undefined;
  try {
    const { data: prevScans } = await supabase
      .from('forensic_scans')
      .select('id, completed_at')
      .eq('organization_id', args.organizationId)
      .in('status', ['completed', 'partial'])
      .order('completed_at', { ascending: false })
      .limit(2);
    // prevScans[0] is THIS scan (just marked complete); [1] is the previous.
    const previous = (prevScans ?? [])[1] as { id: string; completed_at: string | null } | undefined;
    if (previous) {
      const { data: prevFindings } = await supabase
        .from('forensic_findings')
        .select('id, detector_id, title, gap_usd, recoverability_score, source_record_refs')
        .eq('forensic_scan_id', previous.id);
      const prev: DiffFinding[] = ((prevFindings ?? []) as Array<{
        id: string; detector_id: string; title: string; gap_usd: number | string;
        recoverability_score: number | string; source_record_refs: unknown;
      }>).map((r) => ({
        id: r.id,
        detector_id: r.detector_id,
        title: r.title,
        gap_usd: Number(r.gap_usd ?? 0),
        recoverability_score: Number(r.recoverability_score ?? 0),
        primary_record_id:
          ((r.source_record_refs as { primary_record?: { id?: string } } | null)?.primary_record?.id) ?? null,
      }));
      const cur: DiffFinding[] = args.allFindings.map(({ result }) => ({
        id: '', // we haven't queried back the persisted IDs; not needed for diff
        detector_id: result.detectorId,
        title: result.title,
        gap_usd: Number(result.gapUsd),
        recoverability_score: result.recoverabilityScore,
        primary_record_id: result.primaryRecord.id ?? null,
      }));
      const d = computeDiff(prev, cur);
      diff = {
        net_delta_usd: d.net_delta_usd,
        net_delta_pct: d.net_delta_pct,
        new_count: d.summary.new_count,
        escalated_count: d.summary.escalated_count,
        resolved_count: d.summary.resolved_count,
        improved_count: d.summary.improved_count,
        from_scan_date: previous.completed_at,
      };
    }
  } catch (e) {
    console.warn(`[FORENSIC ${args.forensicScanId}] diff for email failed:`, e instanceof Error ? e.message : e);
  }

  await sendForensicScanNotification(args.userId, {
    forensicScanId: args.forensicScanId,
    orgId: args.organizationId,
    orgName: (org.name as string) ?? 'your org',
    status: args.finalStatus,
    totalVerifiedUsd: args.totalVerified,
    findingCount: args.allFindings.length,
    topDetectors,
    topFindings,
    diff,
    errorMessage: args.errorMessage,
  });
}
