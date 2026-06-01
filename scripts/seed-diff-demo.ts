/**
 * Seed: synthetic "previous forensic scan" so the Since-last-scan
 * diff card has something interesting to show.
 *
 * What it does:
 *   1. Finds the most recent completed forensic_scan for CPQ Ks
 *   2. Reads its findings
 *   3. Creates a new forensic_scans row (status='completed',
 *      completed_at = newest.completed_at − 30 seconds) so it sorts
 *      as the SECOND-most-recent for the diff API
 *   4. Populates it with a deterministic mix of findings:
 *        - 2 findings dropped entirely  → NEW (in current, not in old)
 *        - 2 synthetic 'resolved'        → RESOLVED (in old, not in current)
 *        - 2 with gap × 0.6              → ESCALATED (current > old)
 *        - 2 with gap × 1.4              → IMPROVED (current < old)
 *        - Remaining unchanged
 *   5. Tags the synthetic scan with metadata.synthetic_diff_demo = true
 *      so it's clearly distinguishable + idempotent (re-running deletes
 *      the old synthetic before creating fresh).
 *
 * Usage:
 *   npx tsx scripts/seed-diff-demo.ts <orgId>
 *   npx tsx scripts/seed-diff-demo.ts <orgId> --clean   (just remove
 *                                                        synthetic data)
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
(function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
})();
import { createClient } from '@supabase/supabase-js';

const SYNTHETIC_MARKER = 'synthetic_diff_demo_v1';

async function main() {
  const orgId = process.argv[2];
  const cleanOnly = process.argv.includes('--clean');
  if (!orgId) {
    console.error('Usage: npx tsx scripts/seed-diff-demo.ts <orgId> [--clean]');
    process.exit(1);
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ─── 1. Always start by removing any prior synthetic scan ────────
  console.log('[1] Cleaning prior synthetic scans...');
  const { data: existing } = await supabase
    .from('forensic_scans')
    .select('id, metadata')
    .eq('organization_id', orgId);
  const synthetic = ((existing ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>)
    .filter((s) => (s.metadata ?? {})[SYNTHETIC_MARKER] === true);
  if (synthetic.length > 0) {
    const ids = synthetic.map((s) => s.id);
    await supabase.from('forensic_findings').delete().in('forensic_scan_id', ids);
    await supabase.from('forensic_scans').delete().in('id', ids);
    console.log(`    ✓ Removed ${synthetic.length} synthetic scan(s) + their findings`);
  } else {
    console.log('    (none to clean)');
  }
  if (cleanOnly) {
    console.log('\n✓ Clean-only run finished.');
    return;
  }

  // ─── 2. Find the most recent REAL forensic_scan ─────────────────
  console.log('\n[2] Finding latest real forensic scan...');
  const { data: latestScans } = await supabase
    .from('forensic_scans')
    .select('id, user_id, completed_at, finding_count, status')
    .eq('organization_id', orgId)
    .in('status', ['completed', 'partial'])
    .order('completed_at', { ascending: false })
    .limit(1);
  const latest = (latestScans ?? [])[0] as
    | { id: string; user_id: string; completed_at: string; finding_count: number; status: string }
    | undefined;
  if (!latest) {
    console.error('    ✗ No completed forensic scan found for this org. Run a real scan first.');
    process.exit(1);
  }
  console.log(`    ✓ Latest scan ${latest.id.slice(0, 8)} — ${latest.finding_count} findings, completed ${latest.completed_at}`);

  // ─── 3. Pull its findings ───────────────────────────────────────
  console.log('\n[3] Reading findings from latest scan...');
  const { data: findingsData } = await supabase
    .from('forensic_findings')
    .select('id, detector_id, severity, entitled_usd, realized_usd, gap_usd, currency_iso_code, recoverability_score, source_record_refs, title, description, metadata')
    .eq('forensic_scan_id', latest.id);
  interface FindingRow {
    id: string;
    detector_id: string;
    severity: string;
    entitled_usd: number | string;
    realized_usd: number | string;
    gap_usd: number | string;
    currency_iso_code: string;
    recoverability_score: number | string;
    source_record_refs: unknown;
    title: string;
    description: string | null;
    metadata: unknown;
  }
  const findings = (findingsData ?? []) as FindingRow[];
  console.log(`    ✓ ${findings.length} findings loaded`);
  if (findings.length === 0) {
    console.error('    ✗ Latest scan has no findings. Nothing to base synthetic diff on.');
    process.exit(1);
  }

  // ─── 4. Create the synthetic "previous" scan ─────────────────────
  console.log('\n[4] Creating synthetic previous scan...');
  const newerTs = new Date(latest.completed_at).getTime();
  // Place the synthetic scan slightly BEFORE the latest real scan
  // (30s earlier) so the diff API picks the real one as 'to' and the
  // synthetic as 'from'. Backdate completed_at by 7 days for a
  // realistic "since last scan = a week ago" narrative.
  const synthCompletedAt = new Date(newerTs - 7 * 24 * 60 * 60 * 1000).toISOString();
  const synthStartedAt = new Date(newerTs - 7 * 24 * 60 * 60 * 1000 - 60_000).toISOString();

  const { data: synthScan, error: scanErr } = await supabase
    .from('forensic_scans')
    .insert({
      organization_id: orgId,
      user_id: latest.user_id,
      status: 'completed',
      started_at: synthStartedAt,
      completed_at: synthCompletedAt,
      finding_count: 0, // recomputed below
      total_verified_usd: 0,
      metadata: {
        [SYNTHETIC_MARKER]: true,
        note: 'Synthetic scan injected by seed-diff-demo.ts for diff-card demo purposes',
        based_on_real_scan: latest.id,
      },
    })
    .select('id')
    .single();
  if (scanErr || !synthScan) {
    console.error(`    ✗ Could not create synthetic scan: ${scanErr?.message}`);
    process.exit(1);
  }
  console.log(`    ✓ Synthetic scan ${synthScan.id.slice(0, 8)} created at ${synthCompletedAt}`);

  // ─── 5. Build the synthetic findings deterministically ──────────
  console.log('\n[5] Building synthetic findings...');
  // Sort findings deterministically by gap_usd desc so the bucketing
  // is repeatable.
  const sorted = findings
    .slice()
    .sort((a, b) => Number(b.gap_usd) - Number(a.gap_usd));

  const TARGET = {
    drop_as_new: Math.min(2, Math.floor(sorted.length * 0.1)) || 2,        // become NEW
    escalate: Math.min(2, Math.floor(sorted.length * 0.1)) || 2,           // become ESCALATED (current > old)
    improve: Math.min(2, Math.floor(sorted.length * 0.1)) || 2,            // become IMPROVED (current < old)
    add_phantom_as_resolved: 2,                                            // become RESOLVED (only in old)
  };

  const rowsToInsert: Array<Record<string, unknown>> = [];
  let totalGap = 0;

  // Indexes (sliced from sorted) to bucket:
  const dropIdxSet = new Set<number>();
  const escalateIdxSet = new Set<number>();
  const improveIdxSet = new Set<number>();

  // Round-robin assignment so we don't double-bucket:
  for (let i = 0; i < TARGET.drop_as_new; i++) dropIdxSet.add(i);
  for (let i = TARGET.drop_as_new; i < TARGET.drop_as_new + TARGET.escalate; i++) escalateIdxSet.add(i);
  for (
    let i = TARGET.drop_as_new + TARGET.escalate;
    i < TARGET.drop_as_new + TARGET.escalate + TARGET.improve;
    i++
  ) improveIdxSet.add(i);

  for (let i = 0; i < sorted.length; i++) {
    if (dropIdxSet.has(i)) continue; // OMIT → these will be NEW vs synth
    const src = sorted[i];
    let gap = Number(src.gap_usd ?? 0);
    let entitled = Number(src.entitled_usd ?? 0);
    let realized = Number(src.realized_usd ?? 0);
    if (escalateIdxSet.has(i)) {
      // Make old gap smaller — current shows ESCALATED
      gap = Math.round(gap * 0.6 * 100) / 100;
      entitled = Math.round(entitled * 0.6 * 100) / 100;
      realized = Math.round(realized * 0.6 * 100) / 100;
    } else if (improveIdxSet.has(i)) {
      // Make old gap bigger — current shows IMPROVED
      gap = Math.round(gap * 1.4 * 100) / 100;
      entitled = Math.round(entitled * 1.4 * 100) / 100;
      realized = Math.round(realized * 1.4 * 100) / 100;
    }
    rowsToInsert.push({
      forensic_scan_id: synthScan.id,
      organization_id: orgId,
      user_id: latest.user_id,
      detector_id: src.detector_id,
      severity: src.severity,
      entitled_usd: entitled,
      realized_usd: realized,
      gap_usd: gap,
      currency_iso_code: src.currency_iso_code,
      recoverability_score: src.recoverability_score,
      source_record_refs: src.source_record_refs,
      title: src.title,
      description: src.description,
      metadata: src.metadata,
    });
    totalGap += gap;
  }

  // Phantom findings that only exist in the synthetic scan → RESOLVED
  // in the diff. Use unique fake primary_record IDs so they can't
  // collide with any real fingerprint.
  for (let p = 0; p < TARGET.add_phantom_as_resolved; p++) {
    const phantomId = `PHANTOM-DIFF-${p}`;
    const phantomGap = [22_000, 14_500][p] ?? 5_000;
    rowsToInsert.push({
      forensic_scan_id: synthScan.id,
      organization_id: orgId,
      user_id: latest.user_id,
      detector_id: 'ORD-FOR-002',
      severity: 'warning',
      entitled_usd: phantomGap,
      realized_usd: phantomGap - phantomGap * 0.1,
      gap_usd: phantomGap,
      currency_iso_code: 'USD',
      recoverability_score: 0.85,
      source_record_refs: {
        primary_record: { type: 'Order', id: phantomId, name: `O-PHANTOM-${p + 1}` },
        supporting_records: [],
      },
      title: `Order O-PHANTOM-${p + 1} under-billed USD ${phantomGap.toLocaleString()} vs prior Quote (resolved this scan)`,
      description: `Synthetic phantom — exists only in the demo previous scan to populate the RESOLVED bucket.`,
      metadata: { synthetic_phantom: true },
    });
    totalGap += phantomGap;
  }

  // Insert findings in chunks to stay under any per-row limits.
  const CHUNK = 100;
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    const chunk = rowsToInsert.slice(i, i + CHUNK);
    const { error: insErr } = await supabase.from('forensic_findings').insert(chunk);
    if (insErr) {
      console.error(`    ✗ Chunk insert ${i}-${i + chunk.length} failed: ${insErr.message}`);
      process.exit(1);
    }
  }

  // Update the synth scan with final counts
  await supabase
    .from('forensic_scans')
    .update({
      finding_count: rowsToInsert.length,
      total_verified_usd: Math.round(totalGap * 100) / 100,
    })
    .eq('id', synthScan.id);

  console.log(`    ✓ ${rowsToInsert.length} synthetic findings inserted, total gap $${Math.round(totalGap).toLocaleString()}`);

  // ─── 6. Summary ─────────────────────────────────────────────────
  console.log('\n✅ Done. Refresh the org dashboard.');
  console.log('   Expected diff card buckets:');
  console.log(`     NEW:        ${TARGET.drop_as_new}       (current scan has, synth does not)`);
  console.log(`     ESCALATED:  ${TARGET.escalate}       (current gap > synth gap)`);
  console.log(`     RESOLVED:   ${TARGET.add_phantom_as_resolved}       (synth has, current does not)`);
  console.log(`     IMPROVED:   ${TARGET.improve}       (current gap < synth gap)`);
  console.log('   To remove demo data later: npx tsx scripts/seed-diff-demo.ts <orgId> --clean');
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
