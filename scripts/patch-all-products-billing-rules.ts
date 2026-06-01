/**
 * One-off patcher: ensure every Product2 used in the Standard Pricebook
 * has blng__BillingRule__c, blng__RevenueRecognitionRule__c, and
 * blng__TaxRule__c lookups populated. The CPQ Ks org has a validation
 * rule on OrderItem that reads these from Product2 (not OrderItem
 * itself), so any seed script trying to create OrderItems on a product
 * without rules will hit "Billing Rule must be selected" errors.
 *
 * Usage:
 *   npx tsx scripts/patch-all-products-billing-rules.ts <orgPrismOrgId>
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
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

import { createClient } from '@supabase/supabase-js';
import jsforce from 'jsforce';

async function main() {
  const orgUuid = process.argv[2];
  if (!orgUuid) {
    console.error('Usage: npx tsx scripts/patch-all-products-billing-rules.ts <orgPrismOrgId>');
    process.exit(1);
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env vars');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data: org } = await supabase
    .from('organizations')
    .select('instance_url, access_token')
    .eq('id', orgUuid)
    .single();
  if (!org?.access_token) {
    console.error('No access token for that org');
    process.exit(1);
  }
  const conn = new jsforce.Connection({
    instanceUrl: org.instance_url,
    accessToken: org.access_token,
    version: '60.0',
  });
  console.log(`Connected on ${conn.instanceUrl}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function pickFirstId(sobject: string): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (await conn.query(`SELECT Id FROM ${sobject} LIMIT 1`)) as any;
      return r.records[0]?.Id ?? null;
    } catch {
      return null;
    }
  }
  const billingRuleId = await pickFirstId('blng__BillingRule__c');
  const revRuleId = await pickFirstId('blng__RevenueRecognitionRule__c');
  const taxRuleId = await pickFirstId('blng__TaxRule__c');
  if (!billingRuleId || !revRuleId || !taxRuleId) {
    console.error(
      `Cannot find rule records: billing=${billingRuleId}, revenue=${revRuleId}, tax=${taxRuleId}.`
    );
    console.error(`Run seed-ord-variance-fixture.ts first — it auto-creates these.`);
    process.exit(1);
  }
  console.log(`Rules: billing=${billingRuleId.slice(0, 8)}, rev=${revRuleId.slice(0, 8)}, tax=${taxRuleId.slice(0, 8)}`);

  // Find all Products on the Standard Pricebook that are missing any
  // of the rule lookups. Standard CPQ Billing — rule fields live on
  // Product2 (and roll down to OrderItem on insert).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stdPb = (await conn.query(`SELECT Id FROM Pricebook2 WHERE IsStandard = TRUE LIMIT 1`)) as any;
  const stdPbId = stdPb.records[0]?.Id;
  if (!stdPbId) {
    console.error('No Standard Pricebook');
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pbeRes = (await conn.query(
    `SELECT Product2Id FROM PricebookEntry WHERE Pricebook2Id = '${stdPbId}' AND IsActive = TRUE`
  )) as any;
  const productIds = Array.from(new Set(pbeRes.records.map((r: { Product2Id: string }) => r.Product2Id)));
  console.log(`Found ${productIds.length} unique Product2 on Standard Pricebook`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prodRes = (await conn.query(
    `SELECT Id, Name, blng__BillingRule__c, blng__RevenueRecognitionRule__c, blng__TaxRule__c
     FROM Product2 WHERE Id IN (${productIds.map((id) => `'${id}'`).join(',')})`
  )) as any;

  let patched = 0;
  let alreadyOk = 0;
  type Prod = { Id: string; Name: string; blng__BillingRule__c: string | null; blng__RevenueRecognitionRule__c: string | null; blng__TaxRule__c: string | null };
  for (const p of prodRes.records as Prod[]) {
    if (p.blng__BillingRule__c && p.blng__RevenueRecognitionRule__c && p.blng__TaxRule__c) {
      alreadyOk += 1;
      continue;
    }
    const patch: Record<string, unknown> = { Id: p.Id };
    if (!p.blng__BillingRule__c) patch.blng__BillingRule__c = billingRuleId;
    if (!p.blng__RevenueRecognitionRule__c) patch.blng__RevenueRecognitionRule__c = revRuleId;
    if (!p.blng__TaxRule__c) patch.blng__TaxRule__c = taxRuleId;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (await (conn.sobject('Product2') as any).update(patch)) as { success: boolean };
      if (r.success) {
        console.log(`  ✓ Patched "${p.Name}" (${p.Id})`);
        patched += 1;
      } else {
        console.warn(`  ⚠️  ${p.Name}: ${JSON.stringify(r)}`);
      }
    } catch (e) {
      console.warn(`  ⚠️  ${p.Name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`\nDone. ${patched} patched, ${alreadyOk} already had rules.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
