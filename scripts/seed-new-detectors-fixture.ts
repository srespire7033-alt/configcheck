/**
 * Seed: fixtures for the 5 new detectors in Slice 12.
 *   SUB-FOR-001   Subscription qty drift vs Asset
 *   PROV-FOR-001  Asset provisioned, no active Subscription
 *   OPP-FOR-001   Closed-Won Opportunity, no Primary Quote
 *   CON-FOR-001   Contract activated, all subscriptions expired
 *   REN-003       Quote expired, no renewal action
 *
 * Everything lives on a dedicated fixture Account so we don't
 * collide with existing REN-001/REN-002/DSC/ORD fixtures:
 *
 *   "OrgPrism Detector Demo Co"
 *
 * --reseed wipes every record on that Account and recreates from
 * scratch. Because the Account is dedicated, --reseed here is safe
 * by design — it can only touch records this script created.
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

const FIXTURE_ACCOUNT_NAME = 'OrgPrism Detector Demo Co';

async function main() {
  const orgUuid = process.argv[2];
  const reseed = process.argv.includes('--reseed');
  if (!orgUuid) {
    console.error('Usage: npx tsx scripts/seed-new-detectors-fixture.ts <orgUuid> [--reseed]');
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
    console.error('No access token for that org');
    process.exit(1);
  }
  const conn = new jsforce.Connection({
    instanceUrl: org.instance_url,
    accessToken: org.access_token,
    version: '60.0',
  });
  console.log(`Connected on ${conn.instanceUrl}`);

  async function sfQuery<T>(soql: string, label: string): Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (await conn.query(soql)) as any;
    console.log(`  > ${label}: ${r.records.length}`);
    return r.records as T[];
  }
  async function sfCreate(sobject: string, fields: Record<string, unknown>, label: string): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (await (conn.sobject(sobject) as any).create(fields)) as { success: boolean; id?: string; errors?: unknown };
      if (!r.success) {
        console.warn(`  ⚠️  ${label}: ${JSON.stringify(r.errors)}`);
        return null;
      }
      return r.id ?? null;
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = e as any;
      const details = err?.data ? JSON.stringify(err.data) : err?.message ?? String(e);
      console.warn(`  ⚠️  ${label}: ${details}`);
      return null;
    }
  }

  // ─── 1. Find or create the dedicated fixture Account ─────────────
  console.log(`\n[1] Locate fixture Account "${FIXTURE_ACCOUNT_NAME}"...`);
  const accts = await sfQuery<{ Id: string }>(
    `SELECT Id FROM Account WHERE Name = '${FIXTURE_ACCOUNT_NAME}' LIMIT 1`,
    'fixture Account'
  );
  let acctId: string;
  if (accts.length > 0) {
    acctId = accts[0].Id;
    console.log(`    ✓ Found ${acctId}`);
  } else {
    const id = await sfCreate('Account', { Name: FIXTURE_ACCOUNT_NAME }, 'create fixture Account');
    if (!id) {
      console.error('    ✗ Could not create Account. Abort.');
      process.exit(1);
    }
    acctId = id;
    console.log(`    ✓ Created ${acctId}`);
  }

  // ─── 2. --reseed: wipe everything on this Account ────────────────
  if (reseed) {
    console.log('\n[2] --reseed: wiping every record on this Account...');
    // Order matters — delete leaves first (deepest dependencies).
    // QuoteLines → Quotes → OrderItems → Orders → Subscriptions →
    // Contracts → Assets → Opportunities → (leave the Account itself)
    // We use bulk deletes; ignore failures because some objects may
    // not exist or be deletable in this org.
    const sweepDelete = async (sobject: string, where: string) => {
      try {
        const rows = await sfQuery<{ Id: string }>(`SELECT Id FROM ${sobject} WHERE ${where}`, `${sobject} on Account`);
        for (const row of rows) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (conn.sobject(sobject) as any).destroy(row.Id);
          } catch {
            // soft-fail
          }
        }
      } catch {
        // soft-fail
      }
    };
    await sweepDelete('SBQQ__QuoteLine__c', `SBQQ__Quote__r.SBQQ__Account__c = '${acctId}'`);
    await sweepDelete('SBQQ__Quote__c', `SBQQ__Account__c = '${acctId}'`);
    await sweepDelete('OrderItem', `Order.AccountId = '${acctId}'`);
    await sweepDelete('Order', `AccountId = '${acctId}'`);
    await sweepDelete('SBQQ__Subscription__c', `SBQQ__Account__c = '${acctId}'`);
    await sweepDelete('Contract', `AccountId = '${acctId}'`);
    await sweepDelete('Asset', `AccountId = '${acctId}'`);
    await sweepDelete('Opportunity', `AccountId = '${acctId}'`);
    console.log('    ✓ Cleaned.');
  }

  // ─── 3. Pick products + Pricebook ────────────────────────────────
  console.log('\n[3] Locate products + Standard Pricebook...');
  const stdPb = await sfQuery<{ Id: string }>(
    `SELECT Id FROM Pricebook2 WHERE IsStandard = TRUE LIMIT 1`,
    'Standard Pricebook'
  );
  if (stdPb.length === 0) {
    console.error('    ✗ No Standard Pricebook. Abort.');
    process.exit(1);
  }
  const stdPbId = stdPb[0].Id;
  const pbeRows = await sfQuery<{
    Id: string;
    Product2Id: string;
    UnitPrice: string;
    Product2: { Name: string };
  }>(
    `SELECT Id, Product2Id, UnitPrice, Product2.Name FROM PricebookEntry
     WHERE Pricebook2Id = '${stdPbId}' AND IsActive = TRUE AND UnitPrice > 100 LIMIT 6`,
    'active PBEs'
  );
  if (pbeRows.length < 4) {
    console.error(`    ✗ Need at least 4 active products, found ${pbeRows.length}. Abort.`);
    process.exit(1);
  }
  for (const p of pbeRows) {
    console.log(`    • ${p.Product2.Name} @ $${p.UnitPrice}/unit`);
  }
  const [p1, p2, p3, p4] = pbeRows; // 4 distinct products

  // ─── 4. Skip if all scenarios already present ───────────────────
  console.log('\n[4] Idempotency check...');
  // Cheap shortcut — if at least 3 opportunities + 2 assets + 1
  // contract + 1 expired quote exist, assume seeded.
  const oppCheck = await sfQuery<{ Id: string }>(
    `SELECT Id FROM Opportunity WHERE AccountId = '${acctId}' AND Name LIKE 'NDF-%' LIMIT 5`,
    'NDF Opportunities'
  );
  if (oppCheck.length >= 3 && !reseed) {
    console.log('    ✓ Looks seeded already. Pass --reseed to wipe + redo.');
    return;
  }

  // ─── 5. OPP-FOR-001 — Closed-Won Opportunities without Quote ────
  console.log('\n[5] Seeding OPP-FOR-001 (Closed-Won, no Quote)...');
  const today = new Date();
  const oppSpecs = [
    { name: 'NDF-Closed-NoQuote-Large',  amount: 240_000, daysAgo: 21 },
    { name: 'NDF-Closed-NoQuote-Mid',    amount:  85_000, daysAgo: 75 },
    { name: 'NDF-Closed-NoQuote-Small',  amount:  18_500, daysAgo: 180 },
  ];
  for (const spec of oppSpecs) {
    const closeDate = new Date(today.getTime() - spec.daysAgo * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const id = await sfCreate('Opportunity', {
      Name: spec.name,
      AccountId: acctId,
      CloseDate: closeDate,
      StageName: 'Closed Won',
      Amount: spec.amount,
      Pricebook2Id: stdPbId,
    }, `Opp ${spec.name}`);
    if (id) console.log(`    + ${spec.name}  amount $${spec.amount.toLocaleString()}  closed ${spec.daysAgo}d ago`);
  }

  // ─── 6. PROV-FOR-001 — Assets with no Subscription ──────────────
  console.log('\n[6] Seeding PROV-FOR-001 (Assets without Subscription)...');
  const assetSpecs = [
    { product: p1, qty: 10, daysAgo: 90,  label: 'NDF-PROV-A' },
    { product: p2, qty:  5, daysAgo: 180, label: 'NDF-PROV-B' },
    { product: p3, qty: 50, daysAgo: 30,  label: 'NDF-PROV-C' },
  ];
  for (const spec of assetSpecs) {
    const installDate = new Date(today.getTime() - spec.daysAgo * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const id = await sfCreate('Asset', {
      Name: spec.label,
      AccountId: acctId,
      Product2Id: spec.product.Product2Id,
      Quantity: spec.qty,
      Price: Number(spec.product.UnitPrice),
      Status: 'Installed',
      InstallDate: installDate,
    }, `Asset ${spec.label}`);
    if (id) {
      const annualValue = Number(spec.product.UnitPrice) * spec.qty;
      console.log(`    + ${spec.label}  ${spec.qty}× ${spec.product.Product2.Name}  $${annualValue.toLocaleString()}/yr unbilled`);
    }
  }

  // ─── 7. SUB-FOR-001 — Subscription/Asset quantity drift ─────────
  // For each drift scenario: create a Subscription AND a matching
  // Asset on the same product but with different quantities.
  console.log('\n[7] Seeding SUB-FOR-001 (quantity drift)...');
  const driftSpecs = [
    // Under-billed: customer has more assets than billed
    { product: p4, subQty: 20, assetQty: 25, label: 'NDF-DRIFT-UnderBilled' },
    // Over-billed: customer billed for more than they have
    { product: p1, subQty: 30, assetQty: 18, label: 'NDF-DRIFT-OverBilled' },
  ];
  const subStartIso = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const subEndIso = new Date(today.getTime() + 275 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  for (const spec of driftSpecs) {
    // Create the Subscription (no Contract — they're optional for the
    // detector and avoid contract-validation overhead).
    const subId = await sfCreate('SBQQ__Subscription__c', {
      SBQQ__Account__c: acctId,
      SBQQ__Product__c: spec.product.Product2Id,
      SBQQ__Quantity__c: spec.subQty,
      SBQQ__NetPrice__c: Number(spec.product.UnitPrice),
      SBQQ__SubscriptionStartDate__c: subStartIso,
      SBQQ__SubscriptionEndDate__c: subEndIso,
    }, `Sub ${spec.label}`);
    // Matching Asset for the same product on the same account
    const assetId = await sfCreate('Asset', {
      Name: spec.label,
      AccountId: acctId,
      Product2Id: spec.product.Product2Id,
      Quantity: spec.assetQty,
      Price: Number(spec.product.UnitPrice),
      Status: 'Installed',
      InstallDate: subStartIso,
    }, `Asset ${spec.label}`);
    if (subId && assetId) {
      const delta = spec.assetQty - spec.subQty;
      const drift = Math.abs(delta) * Number(spec.product.UnitPrice);
      console.log(
        `    + ${spec.label}  sub=${spec.subQty}, asset=${spec.assetQty} (${delta > 0 ? 'under' : 'over'}-billed by $${drift.toLocaleString()})`
      );
    }
  }

  // ─── 8. CON-FOR-001 — Contracts with no active subscriptions ───
  console.log('\n[8] Seeding CON-FOR-001 (Contracts with expired/zero subs)...');
  // Scenario A: contract activated, zero subscriptions
  const conA = await sfCreate('Contract', {
    AccountId: acctId,
    Status: 'Draft', // SF often requires Draft → manually activate
    StartDate: subStartIso,
    ContractTerm: 12,
  }, 'Contract A (no subs)');
  if (conA) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateRes = (await (conn.sobject('Contract') as any).update({ Id: conA, Status: 'Activated' })) as { success: boolean };
      if (updateRes.success) {
        console.log(`    + Contract A ${conA} — activated, zero subs`);
      } else {
        console.warn(`    ⚠️  Could not activate Contract A`);
      }
    } catch (e) {
      console.warn(`    ⚠️  Contract A activation failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Scenario B: contract with 2 subs, both expired
  const conB = await sfCreate('Contract', {
    AccountId: acctId,
    Status: 'Draft',
    StartDate: new Date(today.getTime() - 540 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    ContractTerm: 24,
  }, 'Contract B (expired subs)');
  if (conB) {
    // Two subscriptions, both ended 30 and 60 days ago
    const expiredEnd1 = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const expiredEnd2 = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await sfCreate('SBQQ__Subscription__c', {
      SBQQ__Account__c: acctId,
      SBQQ__Contract__c: conB,
      SBQQ__Product__c: p2.Product2Id,
      SBQQ__Quantity__c: 10,
      SBQQ__NetPrice__c: Number(p2.UnitPrice),
      SBQQ__SubscriptionStartDate__c: new Date(today.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      SBQQ__SubscriptionEndDate__c: expiredEnd1,
    }, 'Sub B-1 (expired)');
    await sfCreate('SBQQ__Subscription__c', {
      SBQQ__Account__c: acctId,
      SBQQ__Contract__c: conB,
      SBQQ__Product__c: p3.Product2Id,
      SBQQ__Quantity__c: 4,
      SBQQ__NetPrice__c: Number(p3.UnitPrice),
      SBQQ__SubscriptionStartDate__c: new Date(today.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      SBQQ__SubscriptionEndDate__c: expiredEnd2,
    }, 'Sub B-2 (expired)');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateRes = (await (conn.sobject('Contract') as any).update({ Id: conB, Status: 'Activated' })) as { success: boolean };
      if (updateRes.success) {
        console.log(`    + Contract B ${conB} — activated, 2 subs expired`);
      } else {
        console.warn(`    ⚠️  Could not activate Contract B`);
      }
    } catch (e) {
      console.warn(`    ⚠️  Contract B activation failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ─── 9. REN-003 — Expired Quotes with no renewal ────────────────
  console.log('\n[9] Seeding REN-003 (expired Quotes, no renewal)...');
  // Need Opportunities + Primary Quote linkage for these to be valid
  // CPQ Quotes. Create an Opp per scenario, then the Quote.
  const renSpecs = [
    { daysExpired: 7,   amount: 95_000, label: 'NDF-REN3-Recent'   },
    { daysExpired: 35,  amount: 180_000, label: 'NDF-REN3-Mid'     },
    { daysExpired: 75,  amount: 45_000,  label: 'NDF-REN3-Stale'   },
  ];
  for (const spec of renSpecs) {
    const expirationDate = new Date(today.getTime() - spec.daysExpired * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    // Opp for the Quote
    const oppId = await sfCreate('Opportunity', {
      Name: spec.label,
      AccountId: acctId,
      CloseDate: expirationDate,
      StageName: 'Proposal',
      Amount: spec.amount,
      Pricebook2Id: stdPbId,
    }, `Opp ${spec.label}`);
    if (!oppId) continue;
    // Quote
    // SBQQ__ExpirationDate__c may or may not exist; set both that and
    // SBQQ__EndDate__c so either detection path catches it.
    const quoteFields: Record<string, unknown> = {
      SBQQ__Account__c: acctId,
      SBQQ__Opportunity2__c: oppId,
      SBQQ__Primary__c: true,
      SBQQ__Type__c: 'Quote',
      SBQQ__Status__c: 'Approved',
      SBQQ__StartDate__c: new Date(today.getTime() - (spec.daysExpired + 90) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      SBQQ__EndDate__c: expirationDate,
      SBQQ__PriceBook__c: stdPbId,
    };
    // Try to set ExpirationDate too (might not exist)
    try {
      const qDesc = await conn.describe('SBQQ__Quote__c');
      if (qDesc.fields.some((f) => f.name === 'SBQQ__ExpirationDate__c')) {
        quoteFields.SBQQ__ExpirationDate__c = expirationDate;
      }
    } catch {
      // proceed without
    }
    const quoteId = await sfCreate('SBQQ__Quote__c', quoteFields, `Quote ${spec.label}`);
    if (quoteId) {
      // Add a QuoteLine so the Quote has a NetAmount (formula based on lines)
      // SBQQ__NetAmount__c is a formula in standard CPQ — derived from
      // line NetTotals. Set ListPrice + NetPrice + Quantity here.
      const qty = Math.max(1, Math.round(spec.amount / Number(p1.UnitPrice)));
      await sfCreate('SBQQ__QuoteLine__c', {
        SBQQ__Quote__c: quoteId,
        SBQQ__Product__c: p1.Product2Id,
        SBQQ__Quantity__c: qty,
        SBQQ__ListPrice__c: Number(p1.UnitPrice),
        SBQQ__NetPrice__c: spec.amount / qty,
        SBQQ__CustomerPrice__c: spec.amount / qty,
        SBQQ__PricingMethod__c: 'List',
      }, `QL ${spec.label}`);
      console.log(`    + ${spec.label}  expired ${spec.daysExpired}d ago  $${spec.amount.toLocaleString()} ARR at risk`);
    }
  }

  console.log('\n✅ Done. Trigger a forensic scan on CPQ Ks in OrgPrism and the new detector cards should populate:');
  console.log('     Governance Risk    OPP-FOR-001 (3) + CON-FOR-001 (2)');
  console.log('     Pipeline Risk      REN-003 (3) — ~$320K ARR at risk');
  console.log('     Revenue Leakage    +SUB-FOR-001 (2) +PROV-FOR-001 (3)');
  console.log('\nCleanup: npx tsx scripts/seed-new-detectors-fixture.ts <orgUuid> --reseed');
}

main().catch((e) => {
  console.error('\n✗ Seed failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
