/**
 * Seed script — CPQ Ks fixtures for ORD-FOR-002 (Q↔O new biz variance)
 * and ORD-FOR-003 (Q↔O amendment variance).
 *
 * Creates 6 deliberate variance scenarios:
 *
 *   ORD-FOR-002 (new business)
 *     1. UNDER-BILLED: Quote NetAmount $50,000 → Order total $45,000
 *        (5,000 short, pre-invoice, under_billed)
 *     2. OVER-BILLED:  Quote NetAmount $30,000 → Order total $33,000
 *        (3,000 over, pre-invoice, over_billed — compliance risk)
 *     3. SPLIT ORDERS: Quote NetAmount $100,000 → 2 split Orders summing
 *        to $90,000 (under-billed; verifies the detector groups by Quote)
 *
 *   ORD-FOR-003 (amendment)
 *     4. DELTA MISMATCH: Amendment Quote with 1 existing line ($40K)
 *        + 1 new line ($10K). Amendment Order activated at $8K, not $10K.
 *        Expected: delta variance $2K under-billed.
 *     5. EXISTING-FLAG MISCONFIGURED (data-quality smoking gun): the
 *        "new" line points at the SAME Product as the existing line.
 *        Class E should win attribution at 0.95.
 *     6. PRORATION ACTIVE: amendment Quote has PartialPeriod=true (if
 *        the org has that field). Detector flags with reduced confidence
 *        and proration_active=true in metadata.
 *
 * Reuses the OrgPrism Forensic Fixture Co Account + first available
 * product from the existing v1 fixture. Tag: ORD_VARIANCE_FIXTURE_v1.
 *
 * Run:
 *   npx tsx scripts/seed-ord-variance-fixture.ts <orgPrismOrgId>
 *
 * SAFETY:
 *   - Idempotent: skips creating records that already carry the tag.
 *   - Tagged via Order.Description and Quote.Description (long-text;
 *     we filter client-side).
 *
 * CLEANUP:
 *   SELECT Id FROM Order WHERE Description LIKE '%ORD_VARIANCE_FIXTURE_v1%'
 *   SELECT Id FROM SBQQ__Quote__c WHERE Description LIKE '%ORD_VARIANCE_FIXTURE_v1%'
 *   Then delete in Data Loader.
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
import type { Connection } from 'jsforce';

const FIXTURE_TAG = '[ORD_VARIANCE_FIXTURE_v1]';
const FIXTURE_ACCOUNT_NAME = 'OrgPrism Forensic Fixture Co';

async function main() {
  const orgUuid = process.argv[2];
  if (!orgUuid) {
    console.error('Usage: npx tsx scripts/seed-ord-variance-fixture.ts <orgPrismOrgId>');
    process.exit(1);
  }
  console.log(`Connecting to org ${orgUuid}...`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('instance_url, access_token')
    .eq('id', orgUuid)
    .single();
  if (orgErr || !org?.access_token) {
    console.error(`Failed to load org or no access token: ${orgErr?.message ?? 'no token'}`);
    process.exit(1);
  }
  const conn = new jsforce.Connection({
    instanceUrl: org.instance_url,
    accessToken: org.access_token,
    version: '60.0',
  });
  console.log(`Connected on ${conn.instanceUrl}`);

  // ─── Helpers ────────────────────────────────────────────────────────
  type CreateResult = { success: boolean; id?: string; errors?: unknown };
  async function sfCreate(sobject: string, fields: Record<string, unknown>, label: string): Promise<string> {
    process.stdout.write(`  > Create ${sobject} (${label})... `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (await (conn.sobject(sobject) as any).create(fields)) as CreateResult;
    if (!r.success) {
      console.log('FAILED');
      throw new Error(`${sobject} create failed (${label}): ${JSON.stringify(r)}`);
    }
    console.log(`✓ ${r.id}`);
    return r.id as string;
  }
  async function sfUpdate(sobject: string, id: string, fields: Record<string, unknown>, label: string): Promise<void> {
    process.stdout.write(`  > Update ${sobject} ${id} (${label})... `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (await (conn.sobject(sobject) as any).update({ Id: id, ...fields })) as CreateResult;
    if (!r.success) {
      console.log('FAILED');
      throw new Error(`${sobject} update failed (${label}): ${JSON.stringify(r)}`);
    }
    console.log('✓');
  }
  async function sfQuery<T>(soql: string, label: string): Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (await conn.query(soql)) as any;
    console.log(`  > Query (${label}) → ${r.records.length} row(s)`);
    return r.records as T[];
  }

  // ─── 0. Sanity ──────────────────────────────────────────────────────
  console.log(`\n[0] Sanity check...`);
  await sfQuery<{ Id: string }>(`SELECT Id FROM User LIMIT 1`, 'User');

  // ─── 1. Locate fixture Account ──────────────────────────────────────
  console.log(`\n[1] Locate fixture Account...`);
  const accts = await sfQuery<{ Id: string }>(
    `SELECT Id FROM Account WHERE Name = '${FIXTURE_ACCOUNT_NAME}' LIMIT 1`,
    'fixture Account'
  );
  let accountId: string;
  if (accts.length > 0) {
    accountId = accts[0].Id;
    console.log(`  ✓ Found ${accountId}`);
  } else {
    accountId = await sfCreate(
      'Account',
      { Name: FIXTURE_ACCOUNT_NAME, Description: FIXTURE_TAG },
      'fixture Account'
    );
  }

  // ─── 2. Pick a Product + Pricebook ──────────────────────────────────
  console.log(`\n[2] Locate Product + Pricebook...`);
  const stdPbs = await sfQuery<{ Id: string }>(
    `SELECT Id FROM Pricebook2 WHERE IsStandard = TRUE LIMIT 1`,
    'Standard Pricebook'
  );
  if (stdPbs.length === 0) {
    console.error('  ✗ No Standard Pricebook in org. Abort.');
    process.exit(1);
  }
  const stdPbId = stdPbs[0].Id;

  // Find any product with a Standard Pricebook entry — we'll use it for
  // all fixture scenarios. UnitPrice from PBE is the per-unit price; we
  // size quantities to land on round-number totals.
  const pbeRows = await sfQuery<{ Id: string; Product2Id: string; UnitPrice: string; Product2: { Name: string } }>(
    `SELECT Id, Product2Id, UnitPrice, Product2.Name FROM PricebookEntry
     WHERE Pricebook2Id = '${stdPbId}' AND IsActive = TRUE AND Product2.IsActive = TRUE LIMIT 5`,
    'active PBEs'
  );
  if (pbeRows.length === 0) {
    console.error('  ✗ No active Pricebook entries. Abort.');
    process.exit(1);
  }
  // Prefer a high-priced product so the variance numbers are interesting.
  const sortedByPrice = pbeRows.slice().sort((a, b) => Number(b.UnitPrice) - Number(a.UnitPrice));
  const productPbe = sortedByPrice[0];
  console.log(`  ✓ Using "${productPbe.Product2.Name}" @ $${productPbe.UnitPrice}/unit (PBE ${productPbe.Id})`);

  // ─── 3. Billing/Revenue/Tax rules (needed for OrderItem activation) ─
  console.log(`\n[3] Resolve billing/revenue/tax rules...`);
  async function firstId(sobject: string): Promise<string | null> {
    try {
      const rows = await sfQuery<{ Id: string }>(`SELECT Id FROM ${sobject} LIMIT 1`, sobject);
      return rows[0]?.Id ?? null;
    } catch {
      return null;
    }
  }
  const billingRuleId = await firstId('blng__BillingRule__c');
  const revenueRuleId = await firstId('blng__RevenueRecognitionRule__c');
  const taxRuleId = await firstId('blng__TaxRule__c');
  const hasBilling = !!(billingRuleId && revenueRuleId && taxRuleId);
  console.log(`  Billing rules ${hasBilling ? 'OK' : 'NOT installed — will skip charge-type fields and hope activation succeeds'}`);

  // Detect charge-type field
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oiDesc = (await conn.describe('OrderItem')) as { fields: Array<{ name: string; picklistValues?: Array<{ value: string }> }> };
  const chargeAssignments: Record<string, string> = {};
  for (const candidate of ['SBQQ__ChargeType__c', 'blng__ChargeType__c']) {
    const fld = oiDesc.fields.find((f) => f.name === candidate);
    if (fld) {
      const pv = fld.picklistValues ?? [];
      const oneTime = pv.find((v) => /one.?time/i.test(v.value));
      chargeAssignments[candidate] = oneTime?.value ?? pv[0]?.value ?? 'One-Time';
    }
  }

  // Detect SBQQ__Quote__c on Order
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderDesc = (await conn.describe('Order')) as { fields: Array<{ name: string }> };
  const orderFieldNames = new Set(orderDesc.fields.map((f) => f.name));
  if (!orderFieldNames.has('SBQQ__Quote__c')) {
    console.error('  ✗ Order does not have SBQQ__Quote__c — CPQ does not appear to be installed. Abort.');
    process.exit(1);
  }

  // ─── 4. Idempotency check ───────────────────────────────────────────
  console.log(`\n[4] Idempotency check — any existing fixture Quotes?`);
  // SBQQ__Quote__c Description filter — long-text, can't WHERE on it
  const allQuotesOnAcct = await sfQuery<{ Id: string; Description: string | null; Name: string }>(
    `SELECT Id, Description, Name FROM SBQQ__Quote__c WHERE SBQQ__Account__c = '${accountId}' LIMIT 100`,
    'Quotes on fixture account'
  );
  const taggedQuotes = allQuotesOnAcct.filter((q) => (q.Description ?? '').includes(FIXTURE_TAG));
  if (taggedQuotes.length >= 6) {
    console.log(`  ✓ ${taggedQuotes.length} fixture Quotes already exist. Re-run cleanup first if you want fresh data.`);
    console.log(`\nDone (skipped — fixtures already present).`);
    return;
  }

  // ─── 5. ORD-FOR-002 scenarios ────────────────────────────────────────
  console.log(`\n[5] Seeding ORD-FOR-002 (new-biz variance)...`);

  const ord002Specs = [
    {
      label: 'UNDER-BILLED',
      quoteNet: 50_000,
      orderTotals: [45_000], // single order, $5K short
      quoteName: 'ORD002-Under',
    },
    {
      label: 'OVER-BILLED',
      quoteNet: 30_000,
      orderTotals: [33_000], // single order, $3K over
      quoteName: 'ORD002-Over',
    },
    {
      label: 'SPLIT ORDERS',
      quoteNet: 100_000,
      orderTotals: [50_000, 40_000], // 2 split orders, $10K short
      quoteName: 'ORD002-Split',
    },
  ];

  for (const spec of ord002Specs) {
    await createNewBizFixture({
      conn,
      sfCreate,
      sfUpdate,
      accountId,
      productId: productPbe.Product2Id,
      pbeId: productPbe.Id,
      pbeUnitPrice: Number(productPbe.UnitPrice),
      stdPbId,
      billingRuleId,
      revenueRuleId,
      taxRuleId,
      chargeAssignments,
      spec,
      hasBilling,
    });
  }

  // ─── 6. ORD-FOR-003 scenarios ───────────────────────────────────────
  console.log(`\n[6] Seeding ORD-FOR-003 (amendment variance)...`);

  const ord003Specs = [
    {
      label: 'DELTA MISMATCH',
      quoteName: 'ORD003-Delta',
      existingLineNetTotal: 40_000,
      existingProductId: productPbe.Product2Id,
      newLineNetTotal: 10_000,
      newProductId: productPbe.Product2Id, // same product on purpose so test #5 reuses
      orderTotal: 8_000, // $2K below expected $10K delta
      misflagExisting: false,
      partialPeriod: false,
    },
    {
      label: 'EXISTING-FLAG MISCONFIGURED',
      quoteName: 'ORD003-DataQuality',
      existingLineNetTotal: 25_000,
      existingProductId: productPbe.Product2Id,
      newLineNetTotal: 5_000,
      newProductId: productPbe.Product2Id, // same product → suspect pattern
      orderTotal: 5_000,
      misflagExisting: true, // line marked Existing=false for product on existing-line
      partialPeriod: false,
    },
    {
      label: 'PRORATION ACTIVE',
      quoteName: 'ORD003-Proration',
      existingLineNetTotal: 20_000,
      existingProductId: productPbe.Product2Id,
      newLineNetTotal: 7_500,
      newProductId: productPbe.Product2Id,
      orderTotal: 7_000, // $500 under, proration may explain
      misflagExisting: false,
      partialPeriod: true,
    },
  ];

  for (const spec of ord003Specs) {
    await createAmendmentFixture({
      conn,
      sfCreate,
      sfUpdate,
      accountId,
      pbeId: productPbe.Id,
      pbeUnitPrice: Number(productPbe.UnitPrice),
      stdPbId,
      billingRuleId,
      revenueRuleId,
      taxRuleId,
      chargeAssignments,
      spec,
      hasBilling,
    });
  }

  console.log(`\n✅ Done. Run a forensic scan against this org — ORD-FOR-002 should produce 3 findings, ORD-FOR-003 should produce 3 findings.`);
}

// ─────────────────────────────────────────────────────────────────────
// Scenario builders
// ─────────────────────────────────────────────────────────────────────

interface CommonCtx {
  conn: Connection;
  sfCreate: (sobject: string, fields: Record<string, unknown>, label: string) => Promise<string>;
  sfUpdate: (sobject: string, id: string, fields: Record<string, unknown>, label: string) => Promise<void>;
  accountId: string;
  pbeId: string;
  pbeUnitPrice: number;
  stdPbId: string;
  billingRuleId: string | null;
  revenueRuleId: string | null;
  taxRuleId: string | null;
  chargeAssignments: Record<string, string>;
  hasBilling: boolean;
}

async function createNewBizFixture(
  ctx: CommonCtx & {
    productId: string;
    spec: { label: string; quoteNet: number; orderTotals: number[]; quoteName: string };
  }
): Promise<void> {
  const { sfCreate, sfUpdate, accountId, productId, pbeId, pbeUnitPrice, stdPbId, spec } = ctx;
  console.log(`\n  ─── ${spec.label}: Quote ${spec.quoteName} (net $${spec.quoteNet.toLocaleString()}) ───`);

  // Quote start/end — last year, active.
  const today = new Date();
  const start = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 275 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Create the Quote.
  const quoteId = await sfCreate(
    'SBQQ__Quote__c',
    {
      SBQQ__Account__c: accountId,
      SBQQ__Type__c: 'Quote',
      SBQQ__Status__c: 'Approved',
      SBQQ__StartDate__c: start,
      SBQQ__EndDate__c: end,
      SBQQ__PriceBook__c: stdPbId,
      Description: `${FIXTURE_TAG} ORD-FOR-002 ${spec.label} — Quote ${spec.quoteName}`,
    },
    `Quote ${spec.quoteName}`
  );

  // Create a single QuoteLine summing to spec.quoteNet. We size the
  // quantity so listPrice × qty = quoteNet. SBQQ__NetTotal__c is the
  // line-level total — CPQ's NetAmount formula sums these.
  const qty = Math.max(1, Math.round(spec.quoteNet / pbeUnitPrice));
  await sfCreate(
    'SBQQ__QuoteLine__c',
    {
      SBQQ__Quote__c: quoteId,
      SBQQ__Product__c: productId,
      SBQQ__Quantity__c: qty,
      SBQQ__ListPrice__c: pbeUnitPrice,
      SBQQ__NetPrice__c: spec.quoteNet / qty,
      SBQQ__NetTotal__c: spec.quoteNet,
      SBQQ__CustomerPrice__c: spec.quoteNet / qty,
      SBQQ__PricingMethod__c: 'List',
    },
    `QL ${spec.quoteName}`
  );

  // Try to set NetAmount directly — it's often a formula in standard
  // CPQ but some installs make it writable. If write fails, the
  // QuoteLine sum will roll up via CPQ calculate when the user opens
  // the quote. For the detector's purposes we explicitly set
  // SBQQ__NetAmount__c if writable so the value is present immediately.
  try {
    await sfUpdate('SBQQ__Quote__c', quoteId, { SBQQ__NetAmount__c: spec.quoteNet }, 'set NetAmount');
  } catch (e) {
    console.log(`    ℹ️  Could not set SBQQ__NetAmount__c directly (likely formula). Detector will read whatever CPQ has computed: ${e instanceof Error ? e.message : e}`);
  }

  // Create the Order(s).
  for (let i = 0; i < spec.orderTotals.length; i++) {
    const orderTotal = spec.orderTotals[i];
    const effectiveDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const orderId = await sfCreate(
      'Order',
      {
        AccountId: accountId,
        Status: 'Draft',
        EffectiveDate: effectiveDate,
        Pricebook2Id: stdPbId,
        SBQQ__Quote__c: quoteId,
        Description: `${FIXTURE_TAG} ORD-FOR-002 ${spec.label} — Order ${i + 1}/${spec.orderTotals.length}`,
      },
      `Order ${spec.quoteName}-${i + 1}`
    );

    const orderQty = Math.max(1, Math.round(orderTotal / pbeUnitPrice));
    const orderUnitPrice = orderTotal / orderQty;
    const oiFields: Record<string, unknown> = {
      OrderId: orderId,
      Product2Id: productId,
      PricebookEntryId: pbeId,
      Quantity: orderQty,
      UnitPrice: orderUnitPrice,
      ...ctx.chargeAssignments,
    };
    if (ctx.hasBilling) {
      oiFields.blng__BillingRule__c = ctx.billingRuleId;
      oiFields.blng__RevenueRecognitionRule__c = ctx.revenueRuleId;
      oiFields.blng__TaxRule__c = ctx.taxRuleId;
    }
    await sfCreate('OrderItem', oiFields, `OI ${spec.quoteName}-${i + 1}`);

    try {
      await sfUpdate('Order', orderId, { Status: 'Activated' }, `activate ${spec.quoteName}-${i + 1}`);
    } catch (e) {
      console.warn(`    ⚠️  Activation failed: ${e instanceof Error ? e.message : e}`);
    }
    console.log(`    + Order ${spec.quoteName}-${i + 1}: ${orderQty} × $${orderUnitPrice.toFixed(2)} = $${orderTotal.toLocaleString()}`);
  }

  const sumOrders = spec.orderTotals.reduce((s, t) => s + t, 0);
  console.log(`    → Quote $${spec.quoteNet.toLocaleString()}  vs  Orders $${sumOrders.toLocaleString()}  variance $${(sumOrders - spec.quoteNet).toLocaleString()}`);
}

async function createAmendmentFixture(
  ctx: CommonCtx & {
    spec: {
      label: string;
      quoteName: string;
      existingLineNetTotal: number;
      existingProductId: string;
      newLineNetTotal: number;
      newProductId: string;
      orderTotal: number;
      misflagExisting: boolean;
      partialPeriod: boolean;
    };
  }
): Promise<void> {
  const { sfCreate, sfUpdate, accountId, pbeId, pbeUnitPrice, stdPbId, spec } = ctx;
  console.log(`\n  ─── ${spec.label}: Amendment Quote ${spec.quoteName} ───`);

  const today = new Date();
  const start = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 275 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Create amendment Quote.
  const quoteId = await sfCreate(
    'SBQQ__Quote__c',
    {
      SBQQ__Account__c: accountId,
      SBQQ__Type__c: 'Amendment',
      SBQQ__Status__c: 'Approved',
      SBQQ__StartDate__c: start,
      SBQQ__EndDate__c: end,
      SBQQ__PriceBook__c: stdPbId,
      Description: `${FIXTURE_TAG} ORD-FOR-003 ${spec.label} — Amendment ${spec.quoteName}`,
    },
    `Amendment Quote ${spec.quoteName}`
  );

  // Existing line (Existing=TRUE).
  const existingQty = Math.max(1, Math.round(spec.existingLineNetTotal / pbeUnitPrice));
  await sfCreate(
    'SBQQ__QuoteLine__c',
    {
      SBQQ__Quote__c: quoteId,
      SBQQ__Product__c: spec.existingProductId,
      SBQQ__Quantity__c: existingQty,
      SBQQ__ListPrice__c: pbeUnitPrice,
      SBQQ__NetPrice__c: spec.existingLineNetTotal / existingQty,
      SBQQ__NetTotal__c: spec.existingLineNetTotal,
      SBQQ__CustomerPrice__c: spec.existingLineNetTotal / existingQty,
      SBQQ__Existing__c: true,
      SBQQ__PricingMethod__c: 'List',
    },
    `Existing QL ${spec.quoteName}`
  );

  // New line (Existing=FALSE — possibly mis-flagged).
  const newQty = Math.max(1, Math.round(spec.newLineNetTotal / pbeUnitPrice));
  const newLineFields: Record<string, unknown> = {
    SBQQ__Quote__c: quoteId,
    SBQQ__Product__c: spec.newProductId,
    SBQQ__Quantity__c: newQty,
    SBQQ__ListPrice__c: pbeUnitPrice,
    SBQQ__NetPrice__c: spec.newLineNetTotal / newQty,
    SBQQ__NetTotal__c: spec.newLineNetTotal,
    SBQQ__CustomerPrice__c: spec.newLineNetTotal / newQty,
    SBQQ__Existing__c: false,
    SBQQ__PricingMethod__c: 'List',
  };
  // For PRORATION_ACTIVE scenario, flag PartialPeriod if the field
  // exists. Detector probes describe() so absence is silent.
  if (spec.partialPeriod) {
    newLineFields.SBQQ__PartialPeriod__c = true;
  }
  await sfCreate('SBQQ__QuoteLine__c', newLineFields, `New QL ${spec.quoteName}`);

  // Amendment Order.
  const effectiveDate = new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const orderId = await sfCreate(
    'Order',
    {
      AccountId: accountId,
      Status: 'Draft',
      EffectiveDate: effectiveDate,
      Pricebook2Id: stdPbId,
      SBQQ__Quote__c: quoteId,
      Description: `${FIXTURE_TAG} ORD-FOR-003 ${spec.label} — Amendment Order`,
    },
    `Amendment Order ${spec.quoteName}`
  );

  const orderQty = Math.max(1, Math.round(spec.orderTotal / pbeUnitPrice));
  const orderUnit = spec.orderTotal / orderQty;
  const oi: Record<string, unknown> = {
    OrderId: orderId,
    Product2Id: spec.newProductId,
    PricebookEntryId: pbeId,
    Quantity: orderQty,
    UnitPrice: orderUnit,
    ...ctx.chargeAssignments,
  };
  if (ctx.hasBilling) {
    oi.blng__BillingRule__c = ctx.billingRuleId;
    oi.blng__RevenueRecognitionRule__c = ctx.revenueRuleId;
    oi.blng__TaxRule__c = ctx.taxRuleId;
  }
  await sfCreate('OrderItem', oi, `Amendment OI ${spec.quoteName}`);

  try {
    await sfUpdate('Order', orderId, { Status: 'Activated' }, `activate ${spec.quoteName}`);
  } catch (e) {
    console.warn(`    ⚠️  Activation failed: ${e instanceof Error ? e.message : e}`);
  }

  console.log(
    `    → Expected delta $${spec.newLineNetTotal.toLocaleString()}  vs  Order $${spec.orderTotal.toLocaleString()}  variance $${(spec.orderTotal - spec.newLineNetTotal).toLocaleString()}` +
      (spec.misflagExisting ? '  [DATA-QUALITY SUSPECT]' : '') +
      (spec.partialPeriod ? '  [PRORATION ACTIVE]' : '')
  );
}

main().catch((e) => {
  console.error('\n✗ Seed failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
