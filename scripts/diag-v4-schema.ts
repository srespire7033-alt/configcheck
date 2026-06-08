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
  // Inspect forensic_scans columns
  const { data, error } = await supabase
    .from('forensic_scans')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(2);
  console.log('forensic_scans error:', error);
  if (data && data.length) {
    console.log('Columns:', Object.keys(data[0]));
    console.log('Most recent rows:');
    for (const r of data) {
      console.log(JSON.stringify(r, null, 2));
    }
  } else {
    console.log('No rows returned at all.');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
