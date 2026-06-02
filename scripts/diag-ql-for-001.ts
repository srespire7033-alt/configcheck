/**
 * Diagnostic for QL-FOR-001: query Salesforce directly to see how
 * many candidate lines exist and which guards they trip.
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

  // Count of candidate lines (RequiredBy != null AND NetPrice = 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r1 = (await conn.query(`
    SELECT COUNT(Id) c FROM SBQQ__QuoteLine__c
    WHERE SBQQ__RequiredBy__c != null AND SBQQ__NetPrice__c = 0
  `)) as any;
  console.log(`Candidate lines (RequiredBy != null AND NetPrice=0): ${r1.records[0]?.c}`);

  // Just RequiredBy non-null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r2 = (await conn.query(`
    SELECT COUNT(Id) c FROM SBQQ__QuoteLine__c
    WHERE SBQQ__RequiredBy__c != null
  `)) as any;
  console.log(`All bundle-option lines (any price): ${r2.records[0]?.c}`);

  // Sample lines
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r3 = (await conn.query(`
    SELECT Id, Name, SBQQ__Product__r.Name, SBQQ__NetPrice__c, SBQQ__ListPrice__c, SBQQ__Quantity__c
    FROM SBQQ__QuoteLine__c
    WHERE SBQQ__RequiredBy__c != null
    LIMIT 10
  `)) as any;
  console.log('\nSample bundle-option lines:');
  for (const r of r3.records) {
    console.log(`  ${r.Id}  ${r.SBQQ__Product__r?.Name ?? '?'}  list=$${r.SBQQ__ListPrice__c}  net=$${r.SBQQ__NetPrice__c}  qty=${r.SBQQ__Quantity__c}`);
  }

  // Probe SBQQ__Bundled__c field
  try {
    const desc = await conn.describe('SBQQ__QuoteLine__c');
    const hasBundled = desc.fields.some((f) => f.name === 'SBQQ__Bundled__c');
    console.log(`\nSBQQ__Bundled__c field exists: ${hasBundled}`);
    if (hasBundled) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r4 = (await conn.query(`
        SELECT COUNT(Id) c FROM SBQQ__QuoteLine__c
        WHERE SBQQ__RequiredBy__c != null AND SBQQ__NetPrice__c = 0 AND SBQQ__Bundled__c = true
      `)) as any;
      console.log(`Lines with Bundled=true (Guard 1 would skip): ${r4.records[0]?.c}`);
    }
  } catch (e) {
    console.log('describe failed:', e);
  }

  // QL-FOR-001 fixture-named lines specifically (Slice 4 seeded these)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r5 = (await conn.query(`
    SELECT Id, Name, SBQQ__Product__r.Name, SBQQ__NetPrice__c, SBQQ__ListPrice__c, SBQQ__Quantity__c, SBQQ__RequiredBy__c
    FROM SBQQ__QuoteLine__c
    WHERE SBQQ__RequiredBy__c != null
    AND SBQQ__NetPrice__c = 0
    LIMIT 10
  `)) as any;
  console.log('\nFirst 10 candidate (RequiredBy + NetPrice=0) lines for the detector:');
  for (const r of r5.records) {
    console.log(`  ${r.Id}  ${r.SBQQ__Product__r?.Name ?? '?'}  list=$${r.SBQQ__ListPrice__c}  net=$${r.SBQQ__NetPrice__c}`);
  }
}
main().catch((e) => console.error(e instanceof Error ? e.message : e));
