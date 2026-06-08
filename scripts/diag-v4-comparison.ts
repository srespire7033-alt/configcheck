/**
 * Phase 22L v4 comparison — pull latest Vercel scans for both orgs
 * and emit headline numbers + detector list for the markdown report.
 *
 * Run: npx tsx scripts/diag-v4-comparison.ts
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

const TARGETS = [
  { label: 'CPQ+Billing', orgKeyword: 'ksolves', orgKeyword2: 'cpq' },
  { label: 'ARM',         orgKeyword: 'arm' },
];

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. List recent organizations to find both Ksolves orgs
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, instance_url, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  console.log('Recent organizations:');
  for (const o of orgs ?? []) {
    console.log(`  ${o.id}  ${o.name ?? '(no name)'}  ${o.instance_url ?? ''}`);
  }
  console.log('');

  // 2. For each org, pull latest scan + finding rollup
  for (const o of orgs ?? []) {
    // Most-recent scan for this org
    const { data: scans } = await supabase
      .from('forensic_scans')
      .select('id, started_at, completed_at, score, finding_count, total_leakage_usd, status')
      .eq('organization_id', o.id)
      .order('started_at', { ascending: false })
      .limit(3);
    if (!scans || scans.length === 0) continue;

    console.log(`=== ${o.name ?? o.id} ===`);
    for (const s of scans) {
      console.log(`  scan ${s.id} ${s.started_at} → ${s.status} score=${s.score} findings=${s.finding_count} leakage=${s.total_leakage_usd}`);
    }

    // Detector breakdown for the most recent scan
    const latestScan = scans[0];
    const { data: findings } = await supabase
      .from('forensic_findings')
      .select('detector_id, severity')
      .eq('forensic_scan_id', latestScan.id);
    if (findings && findings.length) {
      const byDet = new Map<string, number>();
      for (const f of findings) byDet.set(f.detector_id, (byDet.get(f.detector_id) ?? 0) + 1);
      const sorted = [...byDet.entries()].sort();
      console.log(`  Latest scan (${latestScan.id}) — ${sorted.length} unique detectors:`);
      for (const [det, ct] of sorted) console.log(`    ${det}: ${ct}`);
    }
    console.log('');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
