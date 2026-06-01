/**
 * One-off diagnostic: count renewal/quote/contract records on the
 * fixture Account so we can see what survived the --reseed bug.
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
  const conn = new jsforce.Connection({
    instanceUrl: org!.instance_url,
    accessToken: org!.access_token,
    version: '60.0',
  });

  const acctId = '001dL00002CYJY9QAP';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function q(soql: string, label: string): Promise<unknown[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (await conn.query(soql)) as any;
    console.log(`${label}: ${r.records.length}`);
    return r.records;
  }

  console.log('=== Counts on fixture Account ===');
  await q(`SELECT Id FROM Contract WHERE AccountId = '${acctId}'`, 'Contracts');
  await q(`SELECT Id FROM SBQQ__Subscription__c WHERE SBQQ__Account__c = '${acctId}'`, 'Subscriptions');
  await q(`SELECT Id FROM SBQQ__Quote__c WHERE SBQQ__Account__c = '${acctId}'`, 'All Quotes');
  await q(`SELECT Id, Name FROM SBQQ__Quote__c WHERE SBQQ__Account__c = '${acctId}' AND SBQQ__Type__c = 'Renewal'`, 'Renewal Quotes');
  await q(`SELECT Id FROM SBQQ__Quote__c WHERE SBQQ__Account__c = '${acctId}' AND SBQQ__Type__c = 'Quote'`, 'New-biz Quotes');
  await q(`SELECT Id FROM SBQQ__Quote__c WHERE SBQQ__Account__c = '${acctId}' AND SBQQ__Type__c = 'Amendment'`, 'Amendment Quotes');
  await q(`SELECT Id FROM SBQQ__QuoteLine__c WHERE SBQQ__Quote__r.SBQQ__Account__c = '${acctId}'`, 'All QuoteLines');
  // Renewal quotes' status fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renewals = (await conn.query(
    `SELECT Id, Name, SBQQ__Type__c, SBQQ__Status__c, SBQQ__StartDate__c, SBQQ__EndDate__c
     FROM SBQQ__Quote__c WHERE SBQQ__Account__c = '${acctId}' AND SBQQ__Type__c = 'Renewal' LIMIT 5`
  )) as any;
  if (renewals.records.length > 0) {
    console.log(`\nSample renewal quotes:`);
    for (const r of renewals.records) {
      console.log(`  ${r.Name}: status=${r.SBQQ__Status__c}, ${r.SBQQ__StartDate__c} → ${r.SBQQ__EndDate__c}`);
    }
  }
}
main().catch((e) => console.error(e));
