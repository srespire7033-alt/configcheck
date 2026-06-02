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
  const conn = new jsforce.Connection({
    instanceUrl: org!.instance_url,
    accessToken: org!.access_token,
    version: '60.0',
  });

  // The 3 lines I flipped. Check Bundled + parent NetTotal + PBE list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (await conn.query(`
    SELECT Id, Name, SBQQ__Product__c, SBQQ__Product__r.Name,
           SBQQ__NetPrice__c, SBQQ__ListPrice__c, SBQQ__Quantity__c,
           SBQQ__Bundled__c, SBQQ__RequiredBy__c,
           SBQQ__RequiredBy__r.SBQQ__NetTotal__c
    FROM SBQQ__QuoteLine__c
    WHERE Id IN ('a0mdL0000011Wj2QAE', 'a0mdL0000011WiyQAE', 'a0mdL0000011WiYQAU')
  `)) as any;
  console.log('3 flipped lines:');
  for (const ln of r.records) {
    const expected = Number(ln.SBQQ__ListPrice__c) * Number(ln.SBQQ__Quantity__c);
    const parentTotal = Number(ln.SBQQ__RequiredBy__r?.SBQQ__NetTotal__c ?? 0);
    const guard2Skips = expected > 0 && parentTotal >= expected * 0.95;
    console.log(`  ${ln.Id}  ${ln.SBQQ__Product__r?.Name}`);
    console.log(`    Bundled=${ln.SBQQ__Bundled__c}  list=$${ln.SBQQ__ListPrice__c}  qty=${ln.SBQQ__Quantity__c}  expected=$${expected}`);
    console.log(`    parentTotal=$${parentTotal}  Guard2_skips=${guard2Skips}`);
  }

  // Check the PBE — is there a Standard PBE for the products?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pbes = (await conn.query(`
    SELECT Id, Product2Id, Product2.Name, UnitPrice, IsActive
    FROM PricebookEntry
    WHERE Product2Id IN (
      SELECT SBQQ__Product__c FROM SBQQ__QuoteLine__c
      WHERE Id IN ('a0mdL0000011Wj2QAE', 'a0mdL0000011WiyQAE', 'a0mdL0000011WiYQAU')
    )
    AND Pricebook2.IsStandard = TRUE
  `)) as any;
  console.log('\nStandard PBEs for these products:');
  for (const p of pbes.records) {
    console.log(`  ${p.Product2.Name}: $${p.UnitPrice}  active=${p.IsActive}`);
  }

  // Check paid count for those products
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paid = (await conn.query(`
    SELECT SBQQ__Product__c, COUNT(Id) c FROM SBQQ__QuoteLine__c
    WHERE SBQQ__Product__c IN (
      SELECT SBQQ__Product__c FROM SBQQ__QuoteLine__c
      WHERE Id IN ('a0mdL0000011Wj2QAE', 'a0mdL0000011WiyQAE', 'a0mdL0000011WiYQAU')
    )
    AND SBQQ__NetPrice__c > 0
    GROUP BY SBQQ__Product__c
  `)) as any;
  console.log('\nPaid-elsewhere counts:');
  for (const p of paid.records) {
    console.log(`  ${p.SBQQ__Product__c.slice(0, 18)}…  paid_count=${p.c}`);
  }
}
main().catch((e) => console.error(e instanceof Error ? e.message : e));
