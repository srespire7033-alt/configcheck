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

const ORGS = [
  { label: 'CPQ Ks',       id: '9bfe82aa-6a26-4a0f-80dc-ac69a6d7eede' },
  { label: 'CPQ+Billing',  id: '6a19a55d-d9e3-4dfb-a5c7-6dc0f556b719' },
  { label: 'ARM',          id: '782a2c29-bcf6-4432-9ee7-f3a7f1047cb4' },
];

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  for (const o of ORGS) {
    const { data, error } = await supabase
      .from('scans')
      .select('id, status, product_type, overall_score, total_issues, critical_count, warning_count, info_count, created_at, completed_at, category_scores')
      .eq('organization_id', o.id)
      .order('created_at', { ascending: false })
      .limit(3);
    console.log(`\n=== ${o.label} (${o.id.slice(0,8)}) ===`);
    if (error) { console.log('err:', error); continue; }
    if (!data || !data.length) { console.log('(no scans)'); continue; }
    for (const s of data) {
      console.log(`  ${s.created_at}  ${s.status} pt=${s.product_type ?? '?'} score=${s.overall_score} total=${s.total_issues} (C${s.critical_count}/W${s.warning_count}/I${s.info_count})`);
    }
    // For the most recent COMPLETED scan, dump detector list from findings table.
    const latest = data.find(s => s.status === 'completed') ?? data[0];
    console.log(`  Latest scan id: ${latest.id}`);

    // Look up findings by scan_id (try common column names)
    const findingsTries = ['scan_id', 'health_check_scan_id'];
    let findings: any[] = [];
    for (const col of findingsTries) {
      const { data: f, error: e } = await supabase
        .from('findings')
        .select('check_id, severity')
        .eq(col, latest.id)
        .limit(5000);
      if (!e) { findings = f ?? []; if (findings.length) { console.log(`  (findings table via ${col})`); break; } }
    }
    if (findings.length === 0) {
      // probe other table names
      for (const t of ['health_findings','scan_findings','issues','health_check_findings','health_check_results']) {
        const { data: f, error: e } = await supabase.from(t).select('*').limit(1);
        if (!e) console.log(`  ✓ table exists: ${t}`);
      }
    }
    if (findings.length) {
      const byDet = new Map<string, number>();
      for (const f of findings) byDet.set(f.check_id, (byDet.get(f.check_id) ?? 0) + 1);
      const sorted = [...byDet.entries()].sort();
      console.log(`  ${sorted.length} unique detectors, ${findings.length} findings:`);
      for (const [det, ct] of sorted) console.log(`    ${det}: ${ct}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
