/**
 * Diagnostic: confirm which Supabase environment .env.local points at.
 *
 * Lists:
 *   - The configured Supabase URL (masked)
 *   - Total orgs in the organizations table
 *   - Whether the target CPQ Ks org (9bfe82aa-…) exists
 *
 * Run from project root:
 *   npx tsx scripts/diag-supabase-env.ts
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  // Mask: show project ref only, hide the rest.
  const projectRef = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) ?? [])[1] ?? 'unknown';
  console.log(`Supabase project ref: ${projectRef}`);
  console.log(`URL: ${url.replace(/(https:\/\/)([a-z0-9]+)/, '$1' + projectRef.slice(0, 6) + '…')}`);
  console.log('');

  const supabase = createClient(url, key);

  const targetOrgId = '9bfe82aa-6a26-4a0f-80dc-ac69a6d7eede';

  // Total org count
  const { count: orgCount, error: countErr } = await supabase
    .from('organizations')
    .select('id', { count: 'exact', head: true });
  if (countErr) {
    console.error(`✗ Could not read organizations table: ${countErr.message}`);
    process.exit(1);
  }
  console.log(`Total organizations in this Supabase: ${orgCount}`);
  console.log('');

  // Specific org lookup
  const { data: targetOrg } = await supabase
    .from('organizations')
    .select('id, name, instance_url, user_id, created_at')
    .eq('id', targetOrgId)
    .single();

  if (targetOrg) {
    console.log(`✓ CPQ Ks org FOUND in this environment:`);
    console.log(`    id:          ${targetOrg.id}`);
    console.log(`    name:        ${targetOrg.name}`);
    console.log(`    instance:    ${targetOrg.instance_url}`);
    console.log(`    owner user:  ${(targetOrg.user_id as string)?.slice(0, 8)}…`);
    console.log(`    created:     ${targetOrg.created_at}`);
  } else {
    console.log(`✗ CPQ Ks org NOT found in this environment.`);
    console.log(`  Target ID was: ${targetOrgId}`);
    // List a few orgs that DO exist so the user can see what's there
    const { data: someOrgs } = await supabase
      .from('organizations')
      .select('id, name, instance_url')
      .limit(5);
    if (someOrgs && someOrgs.length > 0) {
      console.log(`\n  Orgs that ARE in this environment (first 5):`);
      for (const o of someOrgs) {
        console.log(`    ${o.id}  ${o.name}  ${o.instance_url}`);
      }
    }
  }

  // Quick forensic-scan count for the target org if found
  if (targetOrg) {
    const { count: scanCount } = await supabase
      .from('forensic_scans')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', targetOrgId);
    const { count: findingCount } = await supabase
      .from('forensic_findings')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', targetOrgId);
    console.log('');
    console.log(`  Forensic scans for this org:  ${scanCount}`);
    console.log(`  Forensic findings persisted:  ${findingCount}`);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
