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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = (await supabase
    .from('forensic_scans')
    .select('id, metadata, error_message')
    .eq('organization_id', orgId)
    .order('completed_at', { ascending: false })
    .limit(3)) as any;
  for (const s of data ?? []) {
    const errors = (s.metadata ?? {}).detector_errors as Record<string, string> | undefined;
    if (errors && Object.keys(errors).length > 0) {
      console.log(`Scan ${s.id.slice(0, 8)}:`);
      for (const [det, msg] of Object.entries(errors)) {
        console.log(`  ${det}: ${msg.slice(0, 300)}`);
      }
    }
  }
}
main();
