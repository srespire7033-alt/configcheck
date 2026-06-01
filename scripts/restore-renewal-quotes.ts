/**
 * Surgical recovery: for every fixture Contract + Subscription on
 * the fixture Account that doesn't have a renewal Quote, create one.
 *
 * Reconstructs the original CONTRACTS data from what's still in SF:
 *   - upliftPct from Contract.SBQQ__RenewalUpliftRate__c
 *   - originalPrice from Subscription.SBQQ__NetPrice__c
 *   - quantity from Subscription.SBQQ__Quantity__c
 *   - customerName from Contract.Description ("[FIXTURE_TAG]: Name")
 *   - isLeaky = (existing Price Rule will strip uplift on ALL renewals,
 *     so every renewal is leaky in this org. The original seed marked
 *     3 as "clean" because their upliftPct was higher than the rule's
 *     stripping logic — for this restore we'll mark all as leaky.)
 *
 * Usage:
 *   npx tsx scripts/restore-renewal-quotes.ts <orgPrismOrgId>
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
  if (!orgUuid) {
    console.error('Usage: npx tsx scripts/restore-renewal-quotes.ts <orgId>');
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
  const conn = new jsforce.Connection({
    instanceUrl: org!.instance_url,
    accessToken: org!.access_token,
    version: '60.0',
  });
  const acctId = '001dL00002CYJY9QAP';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subs = (await conn.query(
    `SELECT Id, SBQQ__Contract__c, SBQQ__Product__c, SBQQ__NetPrice__c, SBQQ__Quantity__c,
            SBQQ__Contract__r.SBQQ__RenewalUpliftRate__c, SBQQ__Contract__r.Description
     FROM SBQQ__Subscription__c
     WHERE SBQQ__Account__c = '${acctId}'`
  )) as { records: Array<{
    Id: string;
    SBQQ__Contract__c: string;
    SBQQ__Product__c: string;
    SBQQ__NetPrice__c: string;
    SBQQ__Quantity__c: string;
    SBQQ__Contract__r: { SBQQ__RenewalUpliftRate__c: string | null; Description: string | null };
  }> };
  console.log(`Found ${subs.records.length} Subscription(s)`);

  // For each Subscription, check if a renewal Quote exists.
  let created = 0;
  for (const sub of subs.records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingQls = (await conn.query(
      `SELECT Id FROM SBQQ__QuoteLine__c WHERE SBQQ__RenewedSubscription__c = '${sub.Id}' LIMIT 1`
    )) as { records: unknown[] };
    if (existingQls.records.length > 0) continue;

    const upliftPct = Number(sub.SBQQ__Contract__r.SBQQ__RenewalUpliftRate__c ?? 0);
    const originalPrice = Number(sub.SBQQ__NetPrice__c ?? 0);
    const quantity = Number(sub.SBQQ__Quantity__c ?? 1);
    if (originalPrice <= 0 || upliftPct <= 0) {
      console.log(`  Skip Sub ${sub.Id} — uplift ${upliftPct} or price ${originalPrice} invalid`);
      continue;
    }
    const customer = (sub.SBQQ__Contract__r.Description ?? '').split(':')[1]?.trim() ?? `Sub ${sub.Id}`;

    // Create renewal Quote.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quoteRes = (await (conn.sobject('SBQQ__Quote__c') as any).create({
      SBQQ__Account__c: acctId,
      SBQQ__Type__c: 'Renewal',
      SBQQ__StartDate__c: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      SBQQ__EndDate__c: new Date(Date.now() + 351 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    })) as { success: boolean; id: string; errors?: unknown };
    if (!quoteRes.success) {
      console.warn(`  ✗ Quote create failed for ${customer}: ${JSON.stringify(quoteRes.errors)}`);
      continue;
    }
    const quoteId = quoteRes.id;

    // Renewal QuoteLine — leaky (price = original, NO uplift applied,
    // simulating Price Rule that strips the escalation).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qlRes = (await (conn.sobject('SBQQ__QuoteLine__c') as any).create({
      SBQQ__Quote__c: quoteId,
      SBQQ__RenewedSubscription__c: sub.Id,
      SBQQ__Product__c: sub.SBQQ__Product__c,
      SBQQ__Quantity__c: quantity,
      SBQQ__ListPrice__c: originalPrice,
      SBQQ__NetPrice__c: originalPrice, // leaky: uplift suppressed
    })) as { success: boolean; id: string; errors?: unknown };
    if (!qlRes.success) {
      console.warn(`  ✗ QL create failed for ${customer}: ${JSON.stringify(qlRes.errors)}`);
      continue;
    }
    console.log(`  ✓ ${customer}: renewal Quote ${quoteId}, leaky $${(originalPrice * quantity * (upliftPct/100)).toFixed(0)}/yr`);
    created += 1;
  }
  console.log(`\nDone. ${created} renewal Quote(s) restored.`);
}
main().catch((e) => console.error(e));
