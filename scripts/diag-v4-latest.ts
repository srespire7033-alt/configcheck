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
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  console.log('=== Latest 15 forensic_scans across ALL orgs ===');
  const { data: scans } = await supabase
    .from('forensic_scans')
    .select('id, organization_id, status, started_at, finding_count, total_verified_usd, metadata')
    .order('started_at', { ascending: false })
    .limit(15);
  for (const s of scans ?? []) {
    const pt = s.metadata?.product_type ?? '?';
    console.log(`  ${s.started_at}  org=${s.organization_id?.slice(0,8)} ${s.status} pt=${pt} findings=${s.finding_count} $${s.total_verified_usd ?? 0}`);
  }
  console.log('');

  // List ALL tables that might hold a "health score"
  console.log('=== Probe for other scan-type tables ===');
  const tableProbes = ['health_scans','health_check_runs','scans','config_scans','org_scores','health_scores','category_scores','scan_runs'];
  for (const t of tableProbes) {
    const { data, error } = await supabase.from(t).select('id').limit(1);
    if (!error) console.log(`  ✓ table exists: ${t}  (sample rowcount: ${data?.length ?? 0})`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
