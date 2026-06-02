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
  for (const detector of ['REN-004', 'AMD-FOR-001', 'DSC-FOR-002', 'QL-FOR-002']) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = (await supabase
      .from('forensic_findings')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('detector_id', detector)) as any;
    console.log(`${detector}: ${count} findings across all scans`);
  }
}
main();
