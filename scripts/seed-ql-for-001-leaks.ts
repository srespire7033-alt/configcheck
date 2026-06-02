/**
 * Seed: convert a few existing bundle-option lines into 'real-leak'
 * shape so QL-FOR-001 actually produces findings on CPQ Ks.
 *
 * Background: existing fixture bundle-option lines (NetPrice=0,
 * RequiredBy != null) all have SBQQ__Bundled__c = true — meaning
 * CPQ correctly tagged them as inclusive bundle pricing. Guard 1
 * skips these as legitimate. With no Bundled=false candidates, the
 * detector returns 0 findings.
 *
 * For the demo, flip SBQQ__Bundled__c = false on 3 lines AND ensure
 * their products have Pricebook entries with list price > 0. Those
 * become 'real leak' candidates: the rep zeroed out the price but
 * CPQ doesn't claim it was bundled.
 *
 * Idempotent — re-running picks the same lines based on Name. Safe
 * to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/seed-ql-for-001-leaks.ts <orgUuid>
 *   npx tsx scripts/seed-ql-for-001-leaks.ts <orgUuid> --restore
 *      Restores SBQQ__Bundled__c = true on the demo lines.
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
import jsforce from 'jsforce';

async function main() {
  const orgUuid = process.argv[2];
  const restore = process.argv.includes('--restore');
  if (!orgUuid) {
    console.error('Usage: npx tsx scripts/seed-ql-for-001-leaks.ts <orgUuid> [--restore]');
    process.exit(1);
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: org } = await supabase
    .from('organizations')
    .select('instance_url, access_token')
    .eq('id', orgUuid)
    .single();
  if (!org?.access_token) {
    console.error('No access token');
    process.exit(1);
  }
  const conn = new jsforce.Connection({
    instanceUrl: org.instance_url,
    accessToken: org.access_token,
    version: '60.0',
  });

  // Pick the same 3 lines deterministically — ones with the highest
  // list × qty (most demo-worthy gap).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates = (await conn.query(`
    SELECT Id, Name, SBQQ__Product__r.Name, SBQQ__ListPrice__c, SBQQ__Quantity__c, SBQQ__Bundled__c
    FROM SBQQ__QuoteLine__c
    WHERE SBQQ__RequiredBy__c != null
      AND SBQQ__NetPrice__c = 0
      AND SBQQ__ListPrice__c > 50
    ORDER BY SBQQ__ListPrice__c DESC, SBQQ__Quantity__c DESC
    LIMIT 3
  `)) as { records: Array<{
    Id: string;
    Name: string;
    SBQQ__Product__r: { Name: string };
    SBQQ__ListPrice__c: string;
    SBQQ__Quantity__c: string;
    SBQQ__Bundled__c: boolean;
  }> };

  if (candidates.records.length === 0) {
    console.log('No candidate lines found. Seed Slice 4 fixtures first.');
    return;
  }

  console.log(`Found ${candidates.records.length} candidate line(s):`);
  for (const c of candidates.records) {
    const total = Number(c.SBQQ__ListPrice__c) * Number(c.SBQQ__Quantity__c);
    console.log(
      `  ${c.Id}  ${c.SBQQ__Product__r.Name}  list=$${c.SBQQ__ListPrice__c} × ${c.SBQQ__Quantity__c} = $${total} (Bundled=${c.SBQQ__Bundled__c})`
    );
  }

  const targetBundled = restore ? true : false;
  console.log(`\n${restore ? 'Restoring' : 'Flipping'} SBQQ__Bundled__c = ${targetBundled}...`);
  for (const c of candidates.records) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (await (conn.sobject('SBQQ__QuoteLine__c') as any).update({
        Id: c.Id,
        SBQQ__Bundled__c: targetBundled,
      })) as { success: boolean; errors?: unknown };
      if (r.success) {
        console.log(`  ✓ ${c.Id}`);
      } else {
        console.warn(`  ⚠️  ${c.Id} failed: ${JSON.stringify(r.errors)}`);
      }
    } catch (e) {
      console.warn(`  ⚠️  ${c.Id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\n✅ Done. ${restore ? 'Demo data reverted.' : 'Re-scan CPQ Ks to see QL-FOR-001 findings.'}`);
}
main().catch((e) => console.error(e instanceof Error ? e.message : e));
