/**
 * Reproduce the category-risk API logic locally to see what it
 * actually returns. Bypasses auth (uses service client) — we're
 * testing the QUERY, not the auth gate.
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
import { DETECTOR_CATEGORY } from '@/lib/forensics/types';

async function main() {
  const orgId = process.argv[2];
  const category = (process.argv[3] ?? 'governance') as 'governance' | 'pipeline';
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log(`category: ${category}`);

  const detectorIdsInCategory = Object.keys(DETECTOR_CATEGORY).filter(
    (id) => DETECTOR_CATEGORY[id] === category
  );
  console.log(`detector IDs in this category: ${detectorIdsInCategory.join(', ')}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = (await supabase
    .from('organizations')
    .select('id, user_id')
    .eq('id', orgId)
    .single()) as any;
  console.log(`org.user_id: ${org?.user_id}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = (await supabase
    .from('forensic_findings')
    .select('id, detector_id, title, gap_usd, severity, user_id')
    .eq('organization_id', orgId)
    .eq('user_id', org.user_id)
    .in('detector_id', detectorIdsInCategory)) as any;

  if (error) {
    console.error(`✗ query error: ${error.message}`);
    return;
  }
  console.log(`\nfindings returned: ${rows.length}`);
  if (rows.length > 0) {
    for (const r of rows.slice(0, 5)) {
      console.log(`  ${r.detector_id}  $${r.gap_usd}  ${r.title.slice(0, 80)}`);
    }
  }
}
main().catch((e) => console.error(e));
