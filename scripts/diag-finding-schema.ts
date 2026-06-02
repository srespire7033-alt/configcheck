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
  // SELECT * to see what columns actually exist
  const { data, error } = await supabase
    .from('forensic_findings')
    .select('*')
    .limit(1);
  if (error) {
    console.error('error:', error);
    return;
  }
  if (data && data.length > 0) {
    console.log('Columns on forensic_findings:');
    for (const k of Object.keys(data[0])) {
      console.log(`  ${k}`);
    }
  }

  // Also try the exact prod query
  const { data: testData, error: testErr } = await supabase
    .from('forensic_findings')
    .select('id, detector_id, title, gap_usd, severity, inserted_at')
    .eq('organization_id', '9bfe82aa-6a26-4a0f-80dc-ac69a6d7eede')
    .eq('user_id', '530dceaa-d253-48f3-92b8-90579cac3a1a')
    .in('detector_id', ['OPP-FOR-001', 'CON-FOR-001'])
    .limit(3);
  console.log('\n--- testing SELECT with inserted_at ---');
  console.log('error:', testErr);
  console.log('rows returned:', testData?.length ?? 0);
  if (testData && testData[0]) console.log('sample row keys:', Object.keys(testData[0]));
}
main();
