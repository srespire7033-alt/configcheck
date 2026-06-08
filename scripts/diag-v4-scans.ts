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

  console.log('=== scans schema + latest 10 ===');
  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) {
    // try other timestamp columns
    const { data: d2, error: e2 } = await supabase
      .from('scans')
      .select('*')
      .limit(10);
    console.log('first try err:', error);
    console.log('plain select rows:', d2?.length);
    if (d2 && d2.length) {
      console.log('columns:', Object.keys(d2[0]));
      for (const r of d2) console.log(JSON.stringify(r));
    }
    return;
  }
  if (data && data.length) {
    console.log('columns:', Object.keys(data[0]));
    for (const r of data) console.log(JSON.stringify(r));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
