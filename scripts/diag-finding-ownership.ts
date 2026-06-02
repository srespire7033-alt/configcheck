/**
 * Diagnostic: who owns the forensic findings, and does that match
 * the org owner the API expects?
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
  // Org owner
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = (await supabase
    .from('organizations')
    .select('id, name, user_id')
    .eq('id', orgId)
    .single()) as any;
  console.log(`Org owner user_id: ${org?.user_id}`);

  // Distinct user_ids on Slice 12 findings
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: findings } = (await supabase
    .from('forensic_findings')
    .select('detector_id, user_id')
    .eq('organization_id', orgId)
    .in('detector_id', ['OPP-FOR-001', 'CON-FOR-001', 'SUB-FOR-001', 'PROV-FOR-001'])) as any;
  const userIds = new Map<string, Map<string, number>>();
  for (const f of findings ?? []) {
    let inner = userIds.get(f.user_id);
    if (!inner) {
      inner = new Map();
      userIds.set(f.user_id, inner);
    }
    inner.set(f.detector_id, (inner.get(f.detector_id) ?? 0) + 1);
  }
  console.log(`\nFinding ownership (Slice 12 detectors):`);
  for (const [uid, detectors] of userIds.entries()) {
    const match = uid === org?.user_id ? '✓ matches org owner' : '✗ DOES NOT MATCH ORG OWNER';
    console.log(`  user_id=${uid?.slice(0, 12) ?? 'null'}…  ${match}`);
    for (const [det, count] of detectors.entries()) {
      console.log(`    ${det}: ${count}`);
    }
  }
}
main().catch((e) => console.error(e));
