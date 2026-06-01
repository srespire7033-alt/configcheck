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
  const { data } = await supabase
    .from('forensic_scans')
    .select('id, status, completed_at, finding_count, metadata')
    .eq('organization_id', orgId)
    .in('status', ['completed', 'partial'])
    .order('completed_at', { ascending: false })
    .limit(5);
  console.log('Latest 5 completed forensic_scans (newest first):');
  for (const s of data ?? []) {
    const synth = ((s.metadata ?? {}) as Record<string, unknown>)['synthetic_diff_demo_v1'] === true;
    console.log(`  ${s.completed_at}  ${s.id.slice(0, 8)}  findings=${s.finding_count}  ${synth ? '[SYNTH]' : ''}`);
  }
}
main();
