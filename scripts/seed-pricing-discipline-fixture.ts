/**
 * Seed: extra QuoteLines designed to exercise the Pricing Discipline
 * card. Adds variety to both metrics:
 *
 *   AVG DISCOUNT — distribution of discounts pushing the org-wide
 *   avg up:
 *     - 8 lines @ 40-50% discount  (well above 25% threshold)
 *     - 5 lines @ 30-35%           (above threshold)
 *     - 8 lines @ 15-25%           (within tolerance)
 *
 *   MANUAL OVERRIDE — 6 lines with SBQQ__PricingMethod__c = 'Manual'
 *   (currently 0% in this org; needs to be ~5%+ for the card to show
 *   meaningful narrative).
 *
 *   ACCOUNT MIX — 3 distinct accounts so "Top discounting accounts"
 *   has variety.
 *
 *   PRODUCT MIX — 4 distinct products so "Highest avg discount by
 *   product" table has variety.
 *
 * Each QuoteLine sits on its own Quote (one Quote per line keeps the
 * data shape simple — the Quote has a recognizable Name like
 * "Pricing-Demo-Q1" for screenshot clarity).
 *
 * Tagged via Opportunity.Name (PDD-* prefix) for idempotency. Quotes
 * have no Description field; Opportunities do.
 *
 * Usage:
 *   npx tsx scripts/seed-pricing-discipline-fixture.ts <orgId>
 *   npx tsx scripts/seed-pricing-discipline-fixture.ts <orgId> --reseed  // wipe + redo
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

const OPP_PREFIX = 'PDD-';
const FIXTURE_ACCOUNT_NAME = 'OrgPrism Forensic Fixture Co';
// Two extra fictional accounts so "Top discounting accounts" has 3 names.
const EXTRA_ACCOUNTS = ['Apex Holdings', 'Northwind Industries'];

interface LineSpec {
  quoteName: string;
  productIndex: number;       // 0..3 from selected products
  accountIndex: number;       // 0..2 (0 = fixture, 1/2 = extras)
  quantity: number;
  discountPct: number;
  pricingMethod: 'List' | 'Manual';
}

// Hand-curated mix. 22 quote lines, 6 with Manual override.
const LINE_SPECS: LineSpec[] = [
  // High-discount band (above 25% threshold)
  { quoteName: 'PDD-HighDisc-01', productIndex: 0, accountIndex: 0, quantity: 25, discountPct: 50, pricingMethod: 'List' },
  { quoteName: 'PDD-HighDisc-02', productIndex: 0, accountIndex: 1, quantity: 30, discountPct: 45, pricingMethod: 'List' },
  { quoteName: 'PDD-HighDisc-03', productIndex: 1, accountIndex: 1, quantity: 18, discountPct: 42, pricingMethod: 'List' },
  { quoteName: 'PDD-HighDisc-04', productIndex: 1, accountIndex: 2, quantity: 12, discountPct: 48, pricingMethod: 'List' },
  { quoteName: 'PDD-HighDisc-05', productIndex: 2, accountIndex: 2, quantity: 8,  discountPct: 40, pricingMethod: 'List' },
  { quoteName: 'PDD-HighDisc-06', productIndex: 2, accountIndex: 0, quantity: 22, discountPct: 47, pricingMethod: 'List' },
  { quoteName: 'PDD-HighDisc-07', productIndex: 3, accountIndex: 1, quantity: 15, discountPct: 44, pricingMethod: 'List' },
  { quoteName: 'PDD-HighDisc-08', productIndex: 3, accountIndex: 2, quantity: 28, discountPct: 49, pricingMethod: 'List' },
  // Just-above-threshold band
  { quoteName: 'PDD-Above-01',    productIndex: 0, accountIndex: 0, quantity: 20, discountPct: 30, pricingMethod: 'List' },
  { quoteName: 'PDD-Above-02',    productIndex: 1, accountIndex: 1, quantity: 14, discountPct: 33, pricingMethod: 'List' },
  { quoteName: 'PDD-Above-03',    productIndex: 2, accountIndex: 2, quantity: 9,  discountPct: 35, pricingMethod: 'List' },
  { quoteName: 'PDD-Above-04',    productIndex: 3, accountIndex: 0, quantity: 11, discountPct: 32, pricingMethod: 'List' },
  { quoteName: 'PDD-Above-05',    productIndex: 0, accountIndex: 2, quantity: 16, discountPct: 31, pricingMethod: 'List' },
  // Healthy discounts (under threshold)
  { quoteName: 'PDD-Healthy-01',  productIndex: 1, accountIndex: 0, quantity: 10, discountPct: 15, pricingMethod: 'List' },
  { quoteName: 'PDD-Healthy-02',  productIndex: 2, accountIndex: 1, quantity: 8,  discountPct: 20, pricingMethod: 'List' },
  { quoteName: 'PDD-Healthy-03',  productIndex: 3, accountIndex: 2, quantity: 12, discountPct: 18, pricingMethod: 'List' },
  // Manual overrides (PricingMethod = 'Manual', smaller discount but flagged)
  { quoteName: 'PDD-Manual-01',   productIndex: 0, accountIndex: 0, quantity: 5,  discountPct: 22, pricingMethod: 'Manual' },
  { quoteName: 'PDD-Manual-02',   productIndex: 1, accountIndex: 1, quantity: 7,  discountPct: 28, pricingMethod: 'Manual' },
  { quoteName: 'PDD-Manual-03',   productIndex: 2, accountIndex: 2, quantity: 4,  discountPct: 35, pricingMethod: 'Manual' },
  { quoteName: 'PDD-Manual-04',   productIndex: 3, accountIndex: 0, quantity: 6,  discountPct: 40, pricingMethod: 'Manual' },
  { quoteName: 'PDD-Manual-05',   productIndex: 0, accountIndex: 1, quantity: 9,  discountPct: 30, pricingMethod: 'Manual' },
  { quoteName: 'PDD-Manual-06',   productIndex: 1, accountIndex: 2, quantity: 3,  discountPct: 38, pricingMethod: 'Manual' },
];

async function main() {
  const orgUuid = process.argv[2];
  const reseed = process.argv.includes('--reseed');
  if (!orgUuid) {
    console.error('Usage: npx tsx scripts/seed-pricing-discipline-fixture.ts <orgId> [--reseed]');
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
  console.log(`Connected on ${conn.instanceUrl}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        console.warn(`  ⚠️  ${label} create returned !success: ${JSON.stringify(r.errors)}`);
        return null;
      }
      return r.id ?? null;
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = e as any;
      const details = err?.data ? JSON.stringify(err.data) : err?.message ?? String(e);
      console.warn(`  ⚠️  ${label} failed: ${details}`);
      return null;
    }
  }

  // ─── 1. Resolve fixture Account + create extras ─────────────────────
  console.log(`\n[1] Resolving Accounts...`);
  const accts: string[] = [];
  // Primary fixture account
  const mainAcct = await sfQuery<{ Id: string }>(
    `SELECT Id FROM Account WHERE Name = '${FIXTURE_ACCOUNT_NAME}' LIMIT 1`,
    'fixture Account'
  );
  if (mainAcct.length === 0) {
    console.error(`  ✗ ${FIXTURE_ACCOUNT_NAME} not found. Run seed-forensic-fixture.ts first.`);
    process.exit(1);
  }
  accts.push(mainAcct[0].Id);
  // Extras
  for (const extraName of EXTRA_ACCOUNTS) {
    const found = await sfQuery<{ Id: string }>(
      `SELECT Id FROM Account WHERE Name = '${extraName}' LIMIT 1`,
      `Account ${extraName}`
    );
    if (found.length > 0) {
      accts.push(found[0].Id);
    } else {
      const id = await sfCreate('Account', { Name: extraName }, `create ${extraName}`);
      if (id) accts.push(id);
    }
  }
  console.log(`  ✓ ${accts.length} accounts`);

  // ─── 2. Pick 4 products from Standard Pricebook ─────────────────────
  console.log(`\n[2] Picking 4 products...`);
  const stdPbRow = await sfQuery<{ Id: string }>(
    `SELECT Id FROM Pricebook2 WHERE IsStandard = TRUE LIMIT 1`,
    'Standard Pricebook'
  );
  if (stdPbRow.length === 0) {
    console.error('  ✗ No Standard Pricebook');
    process.exit(1);
  }
  const stdPbId = stdPbRow[0].Id;
  const pbeRows = await sfQuery<{ Id: string; Product2Id: string; UnitPrice: string; Product2: { Name: string } }>(
    `SELECT Id, Product2Id, UnitPrice, Product2.Name FROM PricebookEntry
     WHERE Pricebook2Id = '${stdPbId}' AND IsActive = TRUE AND UnitPrice > 100 LIMIT 20`,
    'active PBEs > $100'
  );
  // Pick 4 distinct products
  const products = pbeRows.slice(0, 4);
  if (products.length < 4) {
    console.error(`  ✗ Need at least 4 active PBEs > $100, found ${products.length}`);
    process.exit(1);
  }
  for (const p of products) {
    console.log(`  • ${p.Product2.Name} @ $${p.UnitPrice}/unit`);
  }

  // ─── 3. Idempotency / --reseed ──────────────────────────────────────
  console.log(`\n[3] Idempotency check...`);
  const existingOpps = await sfQuery<{ Id: string; AccountId: string }>(
    `SELECT Id, AccountId FROM Opportunity WHERE Name LIKE '${OPP_PREFIX}%' AND AccountId IN (${accts.map((a) => `'${a}'`).join(',')})`,
    'PDD opportunities'
  );
  if (reseed && existingOpps.length > 0) {
    console.log(`  --reseed: deleting ${existingOpps.length} PDD Opportunit${existingOpps.length === 1 ? 'y' : 'ies'} + their Quotes + QuoteLines...`);
    // Find linked Quotes
    const quotes = await sfQuery<{ Id: string }>(
      `SELECT Id FROM SBQQ__Quote__c WHERE SBQQ__Opportunity2__c IN (${existingOpps.map((o) => `'${o.Id}'`).join(',')})`,
      'PDD Quotes'
    );
    // QuoteLines auto-cascade on Quote delete, but be explicit
    if (quotes.length > 0) {
      const qls = await sfQuery<{ Id: string }>(
        `SELECT Id FROM SBQQ__QuoteLine__c WHERE SBQQ__Quote__c IN (${quotes.map((q) => `'${q.Id}'`).join(',')})`,
        'PDD QuoteLines'
      );
      for (const ql of qls) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        try { await (conn.sobject('SBQQ__QuoteLine__c') as any).destroy(ql.Id); } catch {}
      }
      for (const q of quotes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        try { await (conn.sobject('SBQQ__Quote__c') as any).destroy(q.Id); } catch {}
      }
    }
    for (const o of existingOpps) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { await (conn.sobject('Opportunity') as any).destroy(o.Id); } catch {}
    }
    console.log(`  ✓ Cleaned up.`);
  } else if (existingOpps.length >= LINE_SPECS.length) {
    console.log(`  ✓ ${existingOpps.length} fixture Opps already exist — use --reseed to wipe & redo. Skipping.`);
    return;
  }

  // ─── 4. Create one Opportunity + Quote + QuoteLine per spec ─────────
  console.log(`\n[4] Seeding ${LINE_SPECS.length} pricing-discipline QuoteLines...`);
  const today = new Date();
  let created = 0;
  for (const spec of LINE_SPECS) {
    const acctId = accts[Math.min(spec.accountIndex, accts.length - 1)];
    const pbe = products[spec.productIndex];
    const listPrice = Number(pbe.UnitPrice);

    // Opp
    const oppId = await sfCreate(
      'Opportunity',
      {
        Name: spec.quoteName,
        AccountId: acctId,
        CloseDate: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        StageName: 'Closed Won',
        Pricebook2Id: stdPbId,
      },
      `Opp ${spec.quoteName}`
    );
    if (!oppId) continue;

    // Quote
    const quoteId = await sfCreate(
      'SBQQ__Quote__c',
      {
        SBQQ__Account__c: acctId,
        SBQQ__Opportunity2__c: oppId,
        SBQQ__Primary__c: true,
        SBQQ__Type__c: 'Quote',
        SBQQ__Status__c: 'Approved',
        SBQQ__StartDate__c: new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        SBQQ__EndDate__c: new Date(today.getTime() + 351 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        SBQQ__PriceBook__c: stdPbId,
      },
      `Quote ${spec.quoteName}`
    );
    if (!quoteId) continue;

    // QuoteLine — the actual fixture. Set:
    //   SBQQ__Discount__c          → drives avg-discount math
    //   SBQQ__PricingMethod__c     → 'Manual' counts as an override
    //   SBQQ__ListPrice__c         → base price
    //   SBQQ__NetPrice__c          → derived (list × (1 − discount%))
    //   SBQQ__Quantity__c          → for volume mix
    const netPerUnit = Math.round(listPrice * (1 - spec.discountPct / 100) * 100) / 100;
    const qlId = await sfCreate(
      'SBQQ__QuoteLine__c',
      {
        SBQQ__Quote__c: quoteId,
        SBQQ__Product__c: pbe.Product2Id,
        SBQQ__Quantity__c: spec.quantity,
        SBQQ__ListPrice__c: listPrice,
        SBQQ__NetPrice__c: netPerUnit,
        SBQQ__CustomerPrice__c: netPerUnit,
        SBQQ__Discount__c: spec.discountPct,
        SBQQ__PricingMethod__c: spec.pricingMethod,
      },
      `QL ${spec.quoteName}`
    );
    if (qlId) {
      console.log(
        `  + ${spec.quoteName.padEnd(20)} ${pbe.Product2.Name.padEnd(30)} qty ${spec.quantity.toString().padStart(2)} ` +
          `disc ${spec.discountPct.toString().padStart(2)}% ${spec.pricingMethod.padEnd(6)} (acct ${spec.accountIndex})`
      );
      created += 1;
    }
  }

  console.log(`\n✅ Done. Created ${created}/${LINE_SPECS.length} pricing-discipline QuoteLines. Refresh the org dashboard to see updated grade.`);
}

main().catch((e) => {
  console.error('\n✗ Seed failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
