/**
 * Diagnostic: which detectors ran on the latest forensic scan, and
 * how many findings did each produce? Tells us if the new Slice-12
 * detectors are actually firing.
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
async function main() {
  const orgId = process.argv[2];
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  // Latest forensic scan
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scans } = (await supabase
    .from('forensic_scans')
    .select('id, status, completed_at, finding_count, detectors_completed, detectors_failed, metadata')
    .eq('organization_id', orgId)
    .in('status', ['completed', 'partial'])
    .order('completed_at', { ascending: false })
    .limit(1)) as any;
  const latest = (scans ?? [])[0];
  if (!latest) {
    console.log('No completed scans for this org.');
    return;
  }
  console.log(`Latest forensic scan: ${latest.id}`);
  console.log(`  Completed: ${latest.completed_at}`);
  console.log(`  Status: ${latest.status}`);
  console.log(`  Total findings: ${latest.finding_count}`);
  console.log(`  Detectors completed: ${(latest.detectors_completed ?? []).join(', ')}`);
  console.log(`  Detectors failed: ${(latest.detectors_failed ?? []).join(', ')}`);
  // Synthetic?
  const isSynth = (latest.metadata ?? {})['synthetic_diff_demo_v1'] === true;
  if (isSynth) console.log('  [SYNTHETIC]');

  // Per-detector finding counts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: findings } = (await supabase
    .from('forensic_findings')
    .select('detector_id, gap_usd')
    .eq('forensic_scan_id', latest.id)) as any;
  const byDetector = new Map<string, { count: number; gap: number }>();
  for (const f of findings ?? []) {
    let agg = byDetector.get(f.detector_id);
    if (!agg) {
      agg = { count: 0, gap: 0 };
      byDetector.set(f.detector_id, agg);
    }
    agg.count += 1;
    agg.gap += Number(f.gap_usd ?? 0);
  }
  console.log('\nFindings by detector in this scan:');
  for (const [id, a] of Array.from(byDetector.entries()).sort()) {
    console.log(`  ${id.padEnd(15)}  ${a.count.toString().padStart(3)}  $${Math.round(a.gap).toLocaleString()}`);
  }
  if (byDetector.size === 0) {
    console.log('  (none)');
  }
  // What detectors SHOULD have run? Slice 12 added: SUB-FOR-001,
  // PROV-FOR-001, OPP-FOR-001, CON-FOR-001, REN-003.
  const slice12 = ['SUB-FOR-001', 'PROV-FOR-001', 'OPP-FOR-001', 'CON-FOR-001', 'REN-003'];
  const missing = slice12.filter((id) => !byDetector.has(id));
  if (missing.length > 0) {
    console.log(`\n⚠️  Slice 12 detectors with ZERO findings in this scan:`);
    for (const id of missing) {
      const ran = (latest.detectors_completed ?? []).includes(id);
      const failed = (latest.detectors_failed ?? []).includes(id);
      console.log(`  ${id}  ran=${ran}  failed=${failed}`);
    }
  } else {
    console.log('\n✓ All Slice 12 detectors produced findings.');
  }
}
main().catch((e) => console.error(e));
