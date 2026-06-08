import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
(function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
})();
import { createClient } from '@supabase/supabase-js';

const SCANS = [
  { label: 'Vercel CPQ+Billing (6a19a55d)', scanId: '27111bea-a542-4063-aac6-d09e943b8db4' },
  { label: 'Vercel ARM (782a2c29)',         scanId: 'a087edea-1a2f-4817-94cb-209a0f1edf71' },
];

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Inspect issues columns first.
  const { data: sample } = await supabase.from('issues').select('*').limit(1);
  if (sample?.length) console.log('Columns:', Object.keys(sample[0]));

  for (const s of SCANS) {
    console.log(`\n=== ${s.label} ===`);
    const { data } = await supabase
      .from('issues')
      .select('check_id, severity')
      .eq('scan_id', s.scanId)
      .limit(5000);
    if (!data?.length) { console.log('  no rows'); continue; }
    const byDet = new Map<string, number>();
    for (const i of data) byDet.set(i.check_id, (byDet.get(i.check_id) ?? 0) + 1);
    const sorted = [...byDet.entries()].sort();
    console.log(`  ${sorted.length} unique detectors / ${data.length} findings`);
    for (const [det, ct] of sorted) console.log(`    ${det}: ${ct}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
