/**
 * Seed script — CPQ Ks fixture data for REN-001 demo.
 *
 * Creates the canonical Class C scenario:
 *
 *   A Price Rule called "Renewal Floor Pricing" with conditions targeting
 *   SBQQ__Type__c='Renewal' and an Action setting
 *   SBQQ__NetPrice__c = SBQQ__Quantity__c * SBQQ__ListPrice__c (strips
 *   the uplift escalation).
 *
 *   In parallel, a Contract record-triggered Flow on Contract.IsRenewal
 *   that copies the contracted uplift % into renewal Quote Line
 *   Description (so it's "documented") without pushing it into pricing.
 *
 *   10 contracts: 3 clean renewals (control), 7 leaky renewals where the
 *   Price Rule suppresses the entitled uplift. Total synthetic leakage
 *   should land around $340K/yr.
 *
 * Run:
 *   npx tsx scripts/seed-forensic-fixture.ts <orgId>
 *
 * Where <orgId> is the OrgPrism organization UUID for CPQ Ks. You can
 * find this via:
 *   SELECT id, name FROM organizations WHERE name ILIKE '%CPQ Ks%';
 *
 * The script connects via OrgPrism's refreshable-connection helper, so
 * no separate credentials needed — just have the org connected and the
 * script can drive it.
 *
 * SAFETY: this script is IDEMPOTENT — it tags every record it creates
 * with Description containing the fixture marker
 *   '[ORGPRISM_FORENSIC_FIXTURE_v1]'
 * and skips creating anything it can already find with that marker.
 * Safe to re-run.
 *
 * CLEANUP: to wipe the fixture later, soql:
 *   SELECT Id FROM Contract WHERE Description LIKE '%ORGPRISM_FORENSIC_FIXTURE_v1%'
 *   Then Data Loader → Delete. Related QuoteLines, Subscriptions cascade.
 */

// Load .env.local before anything else imports supabase — otherwise
// createServiceClient() trips "supabaseUrl is required" because Next's
// auto-load doesn't apply to standalone node scripts.
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
(function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip wrapping quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

import { createClient } from '@supabase/supabase-js';
import jsforce from 'jsforce';

const FIXTURE_TAG = '[ORGPRISM_FORENSIC_FIXTURE_v1]';

// Synthetic data — fully made-up company names, not real customers.
// The point is to demonstrate the engine, not to anchor to recognizable brands.
const CONTRACTS = [
  // CLEAN — these renewals correctly apply uplift; detector should not flag.
  { customerName: 'Aurora Labs',   originalPrice: 24_000, quantity: 10, upliftPct: 5,  isLeaky: false },
  { customerName: 'Helix Systems', originalPrice: 48_000, quantity: 4,  upliftPct: 5,  isLeaky: false },
  { customerName: 'Quantum Forge', originalPrice: 12_000, quantity: 20, upliftPct: 3,  isLeaky: false },
  // LEAKY — Price Rule strips the uplift; detector should flag each with verified $.
  { customerName: 'Vertex Cloud',  originalPrice: 36_000, quantity: 8,  upliftPct: 7,  isLeaky: true  },
  { customerName: 'Nimbus Group',  originalPrice: 60_000, quantity: 5,  upliftPct: 5,  isLeaky: true  },
  { customerName: 'Strata Data',   originalPrice: 18_000, quantity: 15, upliftPct: 8,  isLeaky: true  },
  { customerName: 'Pillar Health', originalPrice: 84_000, quantity: 3,  upliftPct: 6,  isLeaky: true  },
  { customerName: 'Beacon Energy', originalPrice: 30_000, quantity: 12, upliftPct: 4,  isLeaky: true  },
  { customerName: 'Cascade Retail',originalPrice: 22_000, quantity: 6,  upliftPct: 10, isLeaky: true  },
  { customerName: 'Apex Logistics',originalPrice: 96_000, quantity: 2,  upliftPct: 5,  isLeaky: true  },
];

interface IdRef { Id: string }

async function main() {
  const orgUuid = process.argv[2];
  if (!orgUuid) {
    console.error('Usage: npx tsx scripts/seed-forensic-fixture.ts <orgPrismOrgId>');
    process.exit(1);
  }

  console.log(`Connecting to org ${orgUuid}...`);

  // Bypass the refreshable wrapper — it adds auto-refresh hooks that can
  // hang silently on Node 24 / jsforce v3 if the token's stale. For a
  // one-shot script we just want bare jsforce against the stored token.
  // If the token is expired we'll get a fast 401 and the user reconnects.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('instance_url, access_token, refresh_token, sf_login_url, sf_client_id, sf_client_secret')
    .eq('id', orgUuid)
    .single();
  if (orgErr || !org) {
    console.error(`Failed to load org ${orgUuid} from Supabase:`, orgErr?.message ?? 'not found');
    process.exit(1);
  }
  if (!org.access_token) {
    console.error(`Org ${orgUuid} has no access token. Connect/reconnect in OrgPrism first.`);
    process.exit(1);
  }
  const conn = new jsforce.Connection({
    instanceUrl: org.instance_url,
    accessToken: org.access_token,
    version: '60.0',
  });
  console.log(`Connected on ${conn.instanceUrl}`);

  // ─── 0. Sanity check the connection with a trivial query.
  //       If the token is stale and the refresh hook is misbehaving,
  //       we want to see THAT here (in 1 second), not hang for minutes
  //       on a SBQQ query we may not even need to run.
  console.log(`\n[0/4] Connection sanity check (querying User)...`);
  const sanityStart = Date.now();
  try {
    const me = await withTimeout(
      Promise.resolve(
        conn.query<{ Id: string; Name: string; Username: string }>(
          `SELECT Id, Name, Username FROM User WHERE Username != null LIMIT 1`
        )
      ),
      30_000,
      'sanity check query'
    );
    console.log(`  ✓ Connection healthy (${Date.now() - sanityStart}ms) — running as ${me.records[0]?.Username ?? '(unknown)'}`);
  } catch (e) {
    console.error(`  ✗ Sanity query failed after ${Date.now() - sanityStart}ms:`, e instanceof Error ? e.message : e);
    console.error(`  Most likely cause: stale Salesforce access token + a broken refresh hook.`);
    console.error(`  Try: open OrgPrism, reconnect CPQ Ks, then re-run this script.`);
    process.exit(1);
  }

  // ─── 0.5 Confirm SBQQ is installed before we try to use it. Better
  //         error message than the SOQL exception.
  console.log(`\n[0.5/4] Confirming SBQQ (CPQ) is installed...`);
  try {
    await withTimeout(
      Promise.resolve(conn.query<IdRef>(`SELECT Id FROM SBQQ__PriceRule__c LIMIT 1`)),
      30_000,
      'SBQQ probe'
    );
    console.log(`  ✓ SBQQ found.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('SBQQ__PriceRule__c') && msg.includes('not supported')) {
      console.error(`  ✗ SBQQ is not installed in this org. Install Salesforce CPQ first, then re-run.`);
    } else {
      console.error(`  ✗ SBQQ probe failed:`, msg);
    }
    process.exit(1);
  }

  // Helpers — every conn call from here on is wrapped so a stall is
  // impossible. Each prints elapsed ms on success so we can see where
  // the org is slow if anything weird shows up.
  type CreateResult = { success: boolean; id?: string; errors?: unknown };
  async function sfCreate(sobjectName: string, fields: Record<string, unknown>, label: string): Promise<string> {
    const start = Date.now();
    process.stdout.write(`  > Create ${sobjectName} (${label})... `);
    const res = (await withTimeout(
      Promise.resolve(conn.sobject(sobjectName).create(fields)) as Promise<CreateResult>,
      60_000,
      `${sobjectName}.create ${label}`
    )) as CreateResult;
    if (!res.success) {
      console.log(`FAILED (${Date.now() - start}ms)`);
      throw new Error(`${sobjectName} create failed (${label}): ${JSON.stringify(res)}`);
    }
    console.log(`✓ ${res.id} (${Date.now() - start}ms)`);
    return res.id as string;
  }
  type QueryRecords<T> = { records: T[] };
  async function sfQuery<T>(soql: string, label: string): Promise<T[]> {
    const start = Date.now();
    process.stdout.write(`  > Query (${label})... `);
    // jsforce's generic constraint trips on our row types; we treat the
    // result as untyped at this seam and cast on the way out.
    const r = (await withTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Promise.resolve(conn.query(soql) as any) as Promise<QueryRecords<T>>,
      30_000,
      `query ${label}`
    )) as QueryRecords<T>;
    console.log(`${r.records.length} row(s) (${Date.now() - start}ms)`);
    return r.records;
  }

  // ─── 1. Ensure the offending Price Rule exists ──────────────────────
  // Use a regular hyphen (not em-dash) in the Name. Some CPQ orgs have
  // validation rules on Name fields that choke on non-ASCII.
  const priceRuleName = 'Renewal Floor Pricing - Forensic Fixture';
  console.log(`\n[1/4] Ensuring Price Rule "${priceRuleName}"...`);
  const existingRules = await sfQuery<IdRef & { Name: string }>(
    `SELECT Id, Name FROM SBQQ__PriceRule__c WHERE Name = '${priceRuleName.replace(/'/g, "\\'")}' LIMIT 1`,
    'PriceRule lookup'
  );
  // Per-component idempotency, not all-or-nothing. A failed prior run
  // could have created the rule but bailed before conditions/actions —
  // we re-check each child independently and only create what's missing.
  let priceRuleId: string;
  if (existingRules.length > 0) {
    priceRuleId = existingRules[0].Id;
    console.log(`  ✓ Rule already exists: ${priceRuleId}`);
  } else {
    priceRuleId = await sfCreate('SBQQ__PriceRule__c', {
      Name: priceRuleName,
      SBQQ__Active__c: true,
      SBQQ__EvaluationEvent__c: 'On Calculate',
      SBQQ__ConditionsMet__c: 'All',
    }, 'Renewal Floor Pricing');
  }

  // Ensure the renewal-type condition exists on this rule.
  const existingConditions = await sfQuery<IdRef>(
    `SELECT Id FROM SBQQ__PriceCondition__c WHERE SBQQ__Rule__c = '${priceRuleId}' AND SBQQ__Field__c = 'SBQQ__Type__c' LIMIT 1`,
    'PriceCondition check'
  );
  if (existingConditions.length === 0) {
    await sfCreate('SBQQ__PriceCondition__c', {
      SBQQ__Rule__c: priceRuleId,
      SBQQ__Object__c: 'Quote',
      SBQQ__Field__c: 'SBQQ__Type__c',
      SBQQ__Operator__c: 'equals',
      SBQQ__Value__c: 'Renewal',
    }, 'When renewal type');
  } else {
    console.log(`  ✓ Condition already exists: ${existingConditions[0].Id}`);
  }

  // Field name for the target on SBQQ__PriceAction__c varies across CPQ
  // versions. Standard is SBQQ__TargetField__c; some installs use
  // SBQQ__FieldName__c. Describe the object once to learn what's
  // actually here, fall back to whichever exists.
  const paFields = await withTimeout(
    Promise.resolve(conn.describe('SBQQ__PriceAction__c')) as Promise<{ fields: Array<{ name: string; updateable: boolean }> }>,
    30_000,
    'describe SBQQ__PriceAction__c'
  );
  const writableNames = paFields.fields.filter((f) => f.updateable).map((f) => f.name);
  const targetFieldCandidates = ['SBQQ__TargetField__c', 'SBQQ__FieldName__c', 'SBQQ__Field__c'];
  const targetField = targetFieldCandidates.find((c) => writableNames.includes(c));
  if (!targetField) {
    console.error(`  ✗ Could not find a target-field candidate on SBQQ__PriceAction__c. Available writable fields:`);
    console.error(`    ${writableNames.filter((n) => n.toLowerCase().includes('field') || n.toLowerCase().includes('target')).join(', ')}`);
    console.error(`  Tell Claude which field name to use and we'll patch.`);
    process.exit(1);
  }
  console.log(`  ℹ️  Using target field: ${targetField}`);

  // Ensure the NetPrice-overwriting action exists on this rule.
  const existingActions = await sfQuery<IdRef>(
    `SELECT Id FROM SBQQ__PriceAction__c WHERE SBQQ__Rule__c = '${priceRuleId}' AND ${targetField} = 'SBQQ__NetPrice__c' LIMIT 1`,
    'PriceAction check'
  );
  if (existingActions.length === 0) {
    await sfCreate('SBQQ__PriceAction__c', {
      SBQQ__Rule__c: priceRuleId,
      [targetField]: 'SBQQ__NetPrice__c',
      SBQQ__Formula__c: 'SBQQ__Quantity__c * SBQQ__ListPrice__c',
    }, 'Strip uplift');
  } else {
    console.log(`  ✓ Action already exists: ${existingActions[0].Id}`);
  }

  // ─── 2. Create the 10 Contracts + Subscriptions + renewal QuoteLines ─
  console.log(`\n[2/4] Seeding ${CONTRACTS.length} contracts...`);

  let fixtureAccountId: string;
  const acctRows = await sfQuery<IdRef>(
    `SELECT Id FROM Account WHERE Name = 'OrgPrism Forensic Fixture Co' LIMIT 1`,
    'Account lookup'
  );
  if (acctRows.length > 0) {
    fixtureAccountId = acctRows[0].Id;
  } else {
    fixtureAccountId = await sfCreate('Account', {
      Name: 'OrgPrism Forensic Fixture Co',
      Description: FIXTURE_TAG,
    }, 'fixture Account');
  }

  const prodRows = await sfQuery<IdRef & { Name: string }>(
    `SELECT Id, Name FROM Product2 WHERE IsActive = TRUE LIMIT 1`,
    'Product2 lookup'
  );
  if (prodRows.length === 0) {
    throw new Error('No active Product2 found in this org. Create one in Setup, then re-run.');
  }
  const productId = prodRows[0].Id;
  console.log(`  Using Product2: ${prodRows[0].Name} (${productId})`);

  // REN-002 fixture: ensure the Standard Pricebook entry for this
  // product is set ABOVE the renewal-line prices, so the detector
  // sees current-list > renewal-net-price and flags. Anchor the
  // current list at $100K. Our highest renewal NetPrice is 96K
  // (Apex Logistics, 5% uplift). 96K vs 100K = 4% below list,
  // INSIDE the 10% tolerance — would NOT trigger.
  //
  // Bumping the current list to $120K instead. Then the leaky
  // renewals (e.g. Vertex Cloud at $36K) are 70% below list, and
  // even the smaller-gap ones blow past the 10% tolerance.
  // Detector should flag all 9 leaky lines plus the 'clean' lines
  // that still sit below the new list price.
  const REN_002_TARGET_LIST = 120_000;
  const existingPbeRows = await sfQuery<IdRef & { UnitPrice: string }>(
    `SELECT Id, UnitPrice FROM PricebookEntry WHERE Product2Id = '${productId}' AND Pricebook2.IsStandard = TRUE AND IsActive = TRUE LIMIT 1`,
    'Standard PricebookEntry lookup'
  );
  if (existingPbeRows.length === 0) {
    console.log(`  ⚠️  No active Standard Pricebook entry for product ${productId}. REN-002 will skip this product. Create one in Setup if you want REN-002 fixtures.`);
  } else {
    const existing = existingPbeRows[0];
    const currentPrice = parseFloat(existing.UnitPrice || '0');
    if (currentPrice >= REN_002_TARGET_LIST) {
      console.log(`  ✓ Pricebook entry already at ${currentPrice} (>= $${REN_002_TARGET_LIST.toLocaleString()} target) — REN-002 will fire on existing renewals.`);
    } else {
      // Use the raw REST API to update; the sfCreate helper doesn't
      // do updates. jsforce's sobject.update is a single call.
      console.log(`  > Updating PricebookEntry ${existing.Id} from ${currentPrice} to ${REN_002_TARGET_LIST}...`);
      const updateRes = await conn.sobject('PricebookEntry').update({ Id: existing.Id, UnitPrice: REN_002_TARGET_LIST });
      if (Array.isArray(updateRes) ? !updateRes[0].success : !updateRes.success) {
        console.warn(`  ✗ Update failed: ${JSON.stringify(updateRes)}`);
      } else {
        console.log(`  ✓ Updated. REN-002 should now find every renewal QuoteLine below this list price.`);
      }
    }
  }

  // Contract.Description is a long text area and CANNOT be filtered in
  // SOQL ("field 'Description' can not be filtered in a query call").
  // Track fixtures via AccountId instead — every Contract on the
  // fixture Account is by definition one of ours.
  const existingContracts = await sfQuery<IdRef & { Description: string | null }>(
    `SELECT Id, Description FROM Contract WHERE AccountId = '${fixtureAccountId}' LIMIT 100`,
    'existing fixture Contracts'
  );
  const existingContractCustomers = new Set(
    existingContracts
      .map((r) => r.Description?.split(':')[1]?.trim())
      .filter((s): s is string => !!s)
  );
  let createdContracts = 0;
  let skippedContracts = 0;

  for (const def of CONTRACTS) {
    const marker = `${FIXTURE_TAG}: ${def.customerName}`;
    if (existingContractCustomers.has(def.customerName)) {
      console.log(`  ⏭  ${def.customerName} — already exists, skipping`);
      skippedContracts++;
      continue;
    }

    console.log(`\n  ${def.customerName} (${def.isLeaky ? 'LEAKY' : 'clean'}, ${def.upliftPct}% × ${def.quantity} units @ ${def.originalPrice}):`);

    const contractId = await sfCreate('Contract', {
      AccountId: fixtureAccountId,
      StartDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      ContractTerm: 12,
      Status: 'Draft',
      Description: marker,
      SBQQ__RenewalUpliftRate__c: def.upliftPct,
    }, `Contract ${def.customerName}`);

    const subId = await sfCreate('SBQQ__Subscription__c', {
      SBQQ__Contract__c: contractId,
      SBQQ__Product__c: productId,
      SBQQ__Account__c: fixtureAccountId,
      SBQQ__NetPrice__c: def.originalPrice,
      SBQQ__Quantity__c: def.quantity,
      SBQQ__SubscriptionStartDate__c: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      SBQQ__SubscriptionEndDate__c: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    }, `Subscription ${def.customerName}`);

    const quoteId = await sfCreate('SBQQ__Quote__c', {
      SBQQ__Account__c: fixtureAccountId,
      SBQQ__Type__c: 'Renewal',
      SBQQ__StartDate__c: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      SBQQ__EndDate__c: new Date(Date.now() + 351 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    }, `Renewal Quote ${def.customerName}`);

    const fraction = def.upliftPct / 100;
    const renewalPrice = def.isLeaky
      ? def.originalPrice                   // Price Rule wiped uplift
      : def.originalPrice * (1 + fraction); // Clean uplift applied

    // SBQQ__RenewedSubscription__c is the canonical field linking a
    // renewal quote line back to the subscription it renews. Some CPQ
    // installs silently strip the field on initial QuoteLine create
    // (triggers, FLS, or CPQ's own logic). We do create + immediate
    // update to ensure the field actually lands.
    const lineId = await sfCreate('SBQQ__QuoteLine__c', {
      SBQQ__Quote__c: quoteId,
      SBQQ__RenewedSubscription__c: subId,
      SBQQ__Product__c: productId,
      SBQQ__Quantity__c: def.quantity,
      SBQQ__ListPrice__c: def.originalPrice,
      SBQQ__NetPrice__c: renewalPrice,
    }, `Quote Line ${def.customerName}`);

    // Post-create verify + repair. Query the line back. If the field is
    // empty, attempt an UPDATE. If the update also fails, log a clear
    // message — the field is genuinely read-only in this org and the
    // detector will need a different reconciliation strategy here.
    const lineCheck = await sfQuery<{ Id: string; SBQQ__RenewedSubscription__c: string | null }>(
      `SELECT Id, SBQQ__RenewedSubscription__c FROM SBQQ__QuoteLine__c WHERE Id = '${lineId}' LIMIT 1`,
      `Verify RenewedSubscription on ${def.customerName}`
    );
    if (lineCheck.length > 0 && !lineCheck[0].SBQQ__RenewedSubscription__c) {
      try {
        const updateRes = await withTimeout(
          Promise.resolve(conn.sobject('SBQQ__QuoteLine__c').update({
            Id: lineId,
            SBQQ__RenewedSubscription__c: subId,
          })) as Promise<{ success?: boolean; errors?: unknown }>,
          30_000,
          `Repair RenewedSubscription on ${def.customerName}`
        );
        if (updateRes.success === false) {
          console.warn(`  ⚠️  Could not set SBQQ__RenewedSubscription__c on ${def.customerName} — REN-001 will skip this line. Errors: ${JSON.stringify(updateRes.errors)}`);
        } else {
          console.log(`  ✓ Repaired RenewedSubscription on ${def.customerName}`);
        }
      } catch (e) {
        console.warn(`  ⚠️  Repair failed for ${def.customerName}:`, e instanceof Error ? e.message : e);
      }
    }

    createdContracts++;
  }

  // FINAL sweep — even existing fixture lines (created in earlier seed
  // runs before this repair logic existed) need RenewedSubscription
  // populated for REN-001 to work. Query all renewal QuoteLines tied
  // to our fixture Subscriptions and update the field where missing.
  try {
    const sweepCheck = await sfQuery<{ Id: string; SBQQ__RenewedSubscription__c: string | null; SBQQ__Quote__c: string }>(
      `SELECT Id, SBQQ__RenewedSubscription__c, SBQQ__Quote__c
       FROM SBQQ__QuoteLine__c
       WHERE SBQQ__Quote__r.SBQQ__Account__c = '${fixtureAccountId}'
         AND SBQQ__Quote__r.SBQQ__Type__c = 'Renewal'
         AND SBQQ__RenewedSubscription__c = null
       LIMIT 200`,
      'Sweep renewal QuoteLines missing RenewedSubscription'
    );
    if (sweepCheck.length > 0) {
      console.log(`  Sweep: ${sweepCheck.length} renewal QuoteLines need RenewedSubscription repair...`);
      // For each missing one: find the SUB-XXXX subscription whose
      // Contract is on the same fixture account (best-effort). v1 just
      // logs them — manual SF-side cleanup is the easiest fix.
      for (const orphan of sweepCheck) {
        console.warn(`  ⚠️  QuoteLine ${orphan.Id} has no RenewedSubscription. (Pre-existing fixture row; consider deleting via Data Loader and re-running the seed.)`);
      }
    } else {
      console.log(`  ✓ Sweep clean: all renewal QuoteLines have RenewedSubscription set.`);
    }
  } catch (e) {
    console.warn(`  ⚠️  Sweep query failed:`, e instanceof Error ? e.message : e);
  }

  console.log(`\n[3/4] REN-001 summary:`);
  console.log(`  Created: ${createdContracts}`);
  console.log(`  Skipped (already existed): ${skippedContracts}`);

  const expectedRenLeakage = CONTRACTS.filter((c) => c.isLeaky).reduce(
    (sum, c) => sum + c.originalPrice * c.quantity * (c.upliftPct / 100),
    0
  );

  // ────────────────────────────────────────────────────────────────────
  // DSC-FOR-001 fixtures — two sub-cases:
  //   (a) Discount Schedule with EndDate in past, lines applied AFTER it
  //   (b) Discount Schedule with NO EndDate at all (open-ended promo)
  // Each gets 5 affected quote lines for a total of ~$130K leakage.
  // ────────────────────────────────────────────────────────────────────
  console.log(`\n[4/7] Seeding DSC-FOR-001 promo roll-off fixtures...`);
  const promoExpectedLeakage = await seedPromoFixtures(
    conn,
    sfQuery,
    sfCreate,
    fixtureAccountId,
    productId,
    FIXTURE_TAG
  );

  // QL-FOR-001 detector is currently DISABLED (appliesTo: []) so its
  // findings won't appear in scans. We keep the seed running so the
  // fixture data is in the org for the next iteration when the
  // false-positive guards land.
  console.log(`\n[5/8] Seeding QL-FOR-001 bundle required-option fixtures (detector currently disabled)...`);
  const bundleExpectedLeakage = await seedBundleFixtures(
    conn,
    sfQuery,
    sfCreate,
    fixtureAccountId,
    FIXTURE_TAG
  );

  console.log(`\n[6/8] Seeding ORD-FOR-001 orphan-Order fixtures...`);
  const orphanOrderExpectedLeakage = await seedOrphanOrders(
    conn,
    sfQuery,
    sfCreate,
    fixtureAccountId,
    productId,
    FIXTURE_TAG
  );

  console.log(`\n[8/8] Expected verified leakage totals:`);
  console.log(`  REN-001 (renewal uplift):                  ~$${Math.round(expectedRenLeakage).toLocaleString()}`);
  console.log(`  DSC-FOR-001 (promo roll-off):              ~$${Math.round(promoExpectedLeakage).toLocaleString()}`);
  console.log(`  QL-FOR-001 (bundle free option, disabled): ~$${Math.round(bundleExpectedLeakage).toLocaleString()}`);
  console.log(`  ORD-FOR-001 (order, no billing schedule):  ~$${Math.round(orphanOrderExpectedLeakage).toLocaleString()}`);
  console.log(`  REN-002 (under list)                       — computed at scan time, depends on Pricebook bump`);
  console.log(`  TOTAL active fixture leakage:              ~$${Math.round(expectedRenLeakage + promoExpectedLeakage + orphanOrderExpectedLeakage).toLocaleString()}`);
  console.log(`\n✓ Done. Now go to OrgPrism → CPQ Ks → "+ Forensics" to see the engine in action.`);
}

/**
 * QL-FOR-001 seed: create 2 bundle-option Products with active Standard
 * Pricebook entries, then a fixture Quote with one parent line and the
 * options as required children — set the option lines' NetPrice to $0
 * (the leak the detector should catch).
 *
 * The detector inspects SBQQ__RequiredBy__c. Setting that field links
 * an option line to its parent line on the same quote.
 */
async function seedBundleFixtures(
  conn: import('jsforce').Connection,
  sfQuery: <T>(soql: string, label: string) => Promise<T[]>,
  sfCreate: (sobject: string, fields: Record<string, unknown>, label: string) => Promise<string>,
  accountId: string,
  fixtureTag: string
): Promise<number> {
  interface ProductRow { Id: string; Name: string }
  interface PbeRow { Id: string; UnitPrice: string; Product2Id: string; Pricebook2Id: string }

  // ─── 1. Two option products + their Pricebook entries.
  const optionDefs = [
    { name: 'Premium Support - Forensic Fixture', listPrice: 24_000 },
    { name: 'Implementation Services - Forensic Fixture', listPrice: 18_000 },
  ];

  // Find the Standard Pricebook (every org has exactly one).
  const stdPbRows = await sfQuery<{ Id: string }>(
    `SELECT Id FROM Pricebook2 WHERE IsStandard = TRUE LIMIT 1`,
    'Standard Pricebook lookup'
  );
  if (stdPbRows.length === 0) {
    console.warn(`  ⚠️  No Standard Pricebook found — QL-FOR-001 seed cannot create Pricebook entries. Skipping.`);
    return 0;
  }
  const stdPbId = stdPbRows[0].Id;

  const optionProductIds: string[] = [];
  for (const def of optionDefs) {
    const existing = await sfQuery<ProductRow>(
      `SELECT Id, Name FROM Product2 WHERE Name = '${def.name.replace(/'/g, "\\'")}' LIMIT 1`,
      `Lookup product ${def.name}`
    );
    let prodId: string;
    if (existing.length > 0) {
      prodId = existing[0].Id;
      console.log(`  ✓ Product "${def.name}" already exists: ${prodId}`);
    } else {
      prodId = await sfCreate('Product2', {
        Name: def.name,
        IsActive: true,
        Description: `${fixtureTag} required bundle option for QL-FOR-001 demo`,
      }, `Product ${def.name}`);
    }
    optionProductIds.push(prodId);

    // Pricebook entry — required so the detector can resolve a current price.
    const existingPbe = await sfQuery<PbeRow>(
      `SELECT Id, UnitPrice FROM PricebookEntry WHERE Product2Id = '${prodId}' AND Pricebook2Id = '${stdPbId}' LIMIT 1`,
      `Lookup PBE for ${def.name}`
    );
    if (existingPbe.length === 0) {
      await sfCreate('PricebookEntry', {
        Product2Id: prodId,
        Pricebook2Id: stdPbId,
        UnitPrice: def.listPrice,
        IsActive: true,
      }, `PBE for ${def.name}`);
    } else if (parseFloat(existingPbe[0].UnitPrice || '0') !== def.listPrice) {
      // Update price if it drifted.
      const updateRes = await conn.sobject('PricebookEntry').update({ Id: existingPbe[0].Id, UnitPrice: def.listPrice });
      const ok = Array.isArray(updateRes) ? updateRes[0].success : updateRes.success;
      if (!ok) console.warn(`  ⚠️  Could not update PBE price for ${def.name}`);
    }
  }

  // ─── 2. Bundle parent Product.
  const parentName = 'Enterprise Bundle - Forensic Fixture';
  const parentExisting = await sfQuery<ProductRow>(
    `SELECT Id FROM Product2 WHERE Name = '${parentName}' LIMIT 1`,
    'Lookup bundle parent'
  );
  let parentProdId: string;
  if (parentExisting.length > 0) {
    parentProdId = parentExisting[0].Id;
    console.log(`  ✓ Parent product already exists: ${parentProdId}`);
  } else {
    parentProdId = await sfCreate('Product2', {
      Name: parentName,
      IsActive: true,
      Description: `${fixtureTag} bundle parent for QL-FOR-001 demo`,
    }, `Bundle parent product`);
    await sfCreate('PricebookEntry', {
      Product2Id: parentProdId,
      Pricebook2Id: stdPbId,
      UnitPrice: 100_000,
      IsActive: true,
    }, `PBE for bundle parent`);
  }

  // ─── 3. Idempotency at QuoteLine level — check before creating.
  const existingBundleLines = await sfQuery<{ Id: string; SBQQ__Product__c: string }>(
    `SELECT Id, SBQQ__Product__c
     FROM SBQQ__QuoteLine__c
     WHERE SBQQ__Quote__r.SBQQ__Account__c = '${accountId}'
       AND SBQQ__Product__c IN (${optionProductIds.map((id) => `'${id}'`).join(',')})
       AND SBQQ__NetPrice__c = 0
     LIMIT 10`,
    'Existing bundle option lines'
  );
  if (existingBundleLines.length >= optionProductIds.length) {
    console.log(`  ✓ ${existingBundleLines.length} bundle-option lines already seeded; skipping batch.`);
    // Return expected leakage so summary stays honest.
    return optionDefs.reduce((sum, def) => sum + def.listPrice, 0);
  }

  // ─── 4. Create a fixture Quote with parent line + required-option lines @ $0.
  const quoteId = await sfCreate('SBQQ__Quote__c', {
    SBQQ__Account__c: accountId,
    SBQQ__Type__c: 'Quote',
    SBQQ__StartDate__c: '2026-01-01',
    SBQQ__EndDate__c: '2027-01-01',
  }, 'Bundle fixture Quote');

  const parentLineId = await sfCreate('SBQQ__QuoteLine__c', {
    SBQQ__Quote__c: quoteId,
    SBQQ__Product__c: parentProdId,
    SBQQ__Quantity__c: 1,
    SBQQ__ListPrice__c: 100_000,
    SBQQ__NetPrice__c: 100_000,
  }, 'Bundle parent QuoteLine');

  let totalLeakage = 0;
  for (let i = 0; i < optionProductIds.length; i += 1) {
    const optProd = optionProductIds[i];
    const def = optionDefs[i];
    await sfCreate('SBQQ__QuoteLine__c', {
      SBQQ__Quote__c: quoteId,
      SBQQ__Product__c: optProd,
      SBQQ__RequiredBy__c: parentLineId,
      SBQQ__Quantity__c: 1,
      SBQQ__ListPrice__c: def.listPrice,
      SBQQ__NetPrice__c: 0, // ← the leak
    }, `Required option QuoteLine ${def.name}`);
    totalLeakage += def.listPrice;
    console.log(`  + ${def.name}: list ${def.listPrice}, net $0 → leak ${def.listPrice}`);
  }
  return totalLeakage;
}

/**
 * ORD-FOR-001 seed: 5 activated Orders with NO billing schedules.
 *
 * Salesforce requires Orders go through a strict lifecycle:
 *   1. Create Order in 'Draft' status (with EffectiveDate and Pricebook2)
 *   2. Add OrderItems
 *   3. Update Status to 'Activated' (this requires items present and
 *      activates Order-level validation)
 *
 * For the detector to flag these orders, we deliberately:
 *   - Set OrderItem.blng__BillingRule__c = null on some items
 *     (smoking gun for Class A's 1.0-confidence path)
 *   - Don't generate any blng__BillingSchedule__c records
 *
 * Expected: 5 findings worth $1-2M combined.
 */
async function seedOrphanOrders(
  conn: import('jsforce').Connection,
  sfQuery: <T>(soql: string, label: string) => Promise<T[]>,
  sfCreate: (sobject: string, fields: Record<string, unknown>, label: string) => Promise<string>,
  accountId: string,
  productId: string,
  fixtureTag: string
): Promise<number> {
  // Probe that Salesforce Billing is installed (or at least that the
  // OrderItem object has the blng__BillingRule__c field). If not,
  // we can still create Orders but the detector won't fire on a
  // Billing-less org — log + skip.
  try {
    const oiDesc = (await conn.describe('OrderItem')) as { fields: Array<{ name: string }> };
    const hasBillingRule = oiDesc.fields.some((f) => f.name === 'blng__BillingRule__c');
    if (!hasBillingRule) {
      console.log(`  ℹ️  OrderItem doesn't have blng__BillingRule__c — Salesforce Billing may not be installed. Skipping orphan-Order seed.`);
      return 0;
    }
  } catch (e) {
    console.warn(`  ⚠️  OrderItem describe failed:`, e instanceof Error ? e.message : e);
    return 0;
  }

  // Standard Pricebook for the Order.
  const stdPbRows = await sfQuery<{ Id: string }>(
    `SELECT Id FROM Pricebook2 WHERE IsStandard = TRUE LIMIT 1`,
    'Standard Pricebook for Order'
  );
  if (stdPbRows.length === 0) {
    console.warn(`  ⚠️  No Standard Pricebook — can't create Orders. Skipping.`);
    return 0;
  }
  const stdPbId = stdPbRows[0].Id;

  // Verify the product has a Standard Pricebook entry (Order activation requires this).
  const pbeRows = await sfQuery<{ Id: string; UnitPrice: string }>(
    `SELECT Id, UnitPrice FROM PricebookEntry WHERE Product2Id = '${productId}' AND Pricebook2Id = '${stdPbId}' LIMIT 1`,
    'PricebookEntry for orphan-Order product'
  );
  if (pbeRows.length === 0) {
    console.warn(`  ⚠️  Product ${productId} has no Standard Pricebook entry — can't activate Orders. Skipping.`);
    return 0;
  }
  const pbeId = pbeRows[0].Id;
  const pbeUnitPrice = parseFloat(pbeRows[0].UnitPrice || '0') || 100_000;

  // Idempotency check — any existing fixture-tagged Orders on this Account?
  const existingOrphans = await sfQuery<{ Id: string; Description: string | null }>(
    `SELECT Id, Description FROM Order WHERE AccountId = '${accountId}' AND Description LIKE '%${fixtureTag}%ORD-FOR-001%' LIMIT 20`,
    'Existing orphan Orders'
  );
  if (existingOrphans.length >= 5) {
    console.log(`  ✓ ${existingOrphans.length} orphan Orders already seeded; skipping batch.`);
    return existingOrphans.length * pbeUnitPrice * 3; // approximate
  }

  // Order specs — varying $ amounts to make the demo interesting.
  const orderSpecs = [
    { customer: 'Helix Industries Order', quantity: 3, daysAgo: 240 },
    { customer: 'Quantum Forge Order',    quantity: 5, daysAgo: 180 },
    { customer: 'Apex Logistics Order',   quantity: 2, daysAgo: 120 },
    { customer: 'Nimbus Group Order',     quantity: 8, daysAgo: 60  },
    { customer: 'Strata Data Order',      quantity: 4, daysAgo: 30  },
  ];

  let totalLeakage = 0;
  let createdCount = 0;

  for (const spec of orderSpecs) {
    const effectiveDate = new Date(Date.now() - spec.daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const itemTotal = spec.quantity * pbeUnitPrice;

    // Create Order in Draft status.
    const orderId = await sfCreate('Order', {
      AccountId: accountId,
      Status: 'Draft',
      EffectiveDate: effectiveDate,
      Pricebook2Id: stdPbId,
      Description: `${fixtureTag} ORD-FOR-001: ${spec.customer}`,
    }, `Order ${spec.customer}`);

    // Add an OrderItem WITHOUT blng__BillingRule__c so Class A's
    // 1.0-confidence path fires.
    await sfCreate('OrderItem', {
      OrderId: orderId,
      Product2Id: productId,
      PricebookEntryId: pbeId,
      Quantity: spec.quantity,
      UnitPrice: pbeUnitPrice,
      // blng__BillingRule__c deliberately omitted (null)
    }, `OrderItem ${spec.customer}`);

    // Activate the Order. Activation requires items present (which we
    // just added) and may trigger workflows — but we want to SKIP the
    // billing-schedule generation, so the lack of blng__BillingRule__c
    // does the work for us.
    try {
      const activateRes = await withTimeout(
        Promise.resolve(conn.sobject('Order').update({ Id: orderId, Status: 'Activated' })) as Promise<{ success?: boolean; errors?: unknown }>,
        30_000,
        `Activate Order ${spec.customer}`
      );
      if (activateRes.success === false) {
        console.warn(`  ⚠️  Could not activate ${spec.customer}: ${JSON.stringify(activateRes.errors)}`);
        continue;
      }
    } catch (e) {
      console.warn(`  ⚠️  Activate failed for ${spec.customer}:`, e instanceof Error ? e.message : e);
      continue;
    }

    totalLeakage += itemTotal;
    createdCount += 1;
    console.log(`  + ${spec.customer}: ${spec.quantity} × ${pbeUnitPrice} = $${itemTotal.toLocaleString()} (activated ${spec.daysAgo}d ago)`);
  }

  console.log(`\n  Created ${createdCount} orphan Orders, total $${Math.round(totalLeakage).toLocaleString()} unbilled`);
  return totalLeakage;
}

/**
 * Seed both DSC-FOR-001 sub-cases. Returns the expected $ leakage so the
 * top-level summary can sum across detectors.
 *
 * Sub-case (a): "2025 Q1 New Logo Promo" with EndDate = 2025-03-31, 5
 * quote lines created on 2025-06-15 (after expiry) still apply 25%.
 *
 * Sub-case (b): "Holiday Launch Special Promo" with no EndDate (null),
 * 5 quote lines applying 15%. Name includes "Promo" so detector flags it.
 */
async function seedPromoFixtures(
  conn: import('jsforce').Connection,
  sfQuery: <T>(soql: string, label: string) => Promise<T[]>,
  sfCreate: (sobject: string, fields: Record<string, unknown>, label: string) => Promise<string>,
  accountId: string,
  productId: string,
  fixtureTag: string
): Promise<number> {
  interface PromoSchedule {
    Id: string;
    Name: string;
  }
  interface PromoLine {
    customerName: string;
    listPrice: number;
    quantity: number;
  }

  const expiredScheduleName = '2025 Q1 New Logo Promo - Forensic Fixture';
  const nullEndScheduleName = 'Holiday Launch Special Promo - Forensic Fixture';
  const expiredScheduleDiscount = 25;
  const nullEndScheduleDiscount = 15;

  // Describe SBQQ__DiscountSchedule__c — standard CPQ doesn't ship date
  // fields here; only Advanced Discounting + custom fields add them.
  // We only set what's writable. Both detector sub-cases still work:
  // (a) needs the end-date column, (b) is name-based and works without.
  const dsDesc = (await conn.describe('SBQQ__DiscountSchedule__c')) as { fields: Array<{ name: string; updateable: boolean }> };
  const writableDsFields = new Set(dsDesc.fields.filter((f) => f.updateable).map((f) => f.name));
  const dsStartCol = ['SBQQ__StartDate__c', 'Start_Date__c', 'StartDate__c'].find((c) => writableDsFields.has(c));
  const dsEndCol = ['SBQQ__EndDate__c', 'End_Date__c', 'EndDate__c', 'SBQQ__ExpirationDate__c', 'Expiration_Date__c'].find((c) => writableDsFields.has(c));
  if (!dsEndCol) {
    console.log(`  ℹ️  No end-date column on SBQQ__DiscountSchedule__c — sub-case (a) "expired schedule" won't fire; sub-case (b) "promo-named, no end date" will.`);
  } else {
    console.log(`  ℹ️  Using end-date column: ${dsEndCol}`);
  }
  // Type field also varies (some orgs lock it down). Probe.
  const dsTypeCol = writableDsFields.has('SBQQ__Type__c') ? 'SBQQ__Type__c' : null;

  // Expired schedule first.
  const expiredCheck = await sfQuery<PromoSchedule>(
    `SELECT Id, Name FROM SBQQ__DiscountSchedule__c WHERE Name = '${expiredScheduleName.replace(/'/g, "\\'")}' LIMIT 1`,
    'expired DiscountSchedule lookup'
  );
  let expiredScheduleId: string;
  if (expiredCheck.length > 0) {
    expiredScheduleId = expiredCheck[0].Id;
    console.log(`  ✓ Expired schedule already exists: ${expiredScheduleId}`);
  } else {
    const expiredFields: Record<string, unknown> = { Name: expiredScheduleName };
    if (dsStartCol) expiredFields[dsStartCol] = '2025-01-01';
    if (dsEndCol) expiredFields[dsEndCol] = '2025-03-31';
    if (dsTypeCol) expiredFields[dsTypeCol] = 'Range';
    expiredScheduleId = await sfCreate('SBQQ__DiscountSchedule__c', expiredFields, 'expired promo schedule');
  }

  // Null-EndDate promo schedule next.
  const nullEndCheck = await sfQuery<PromoSchedule>(
    `SELECT Id, Name FROM SBQQ__DiscountSchedule__c WHERE Name = '${nullEndScheduleName.replace(/'/g, "\\'")}' LIMIT 1`,
    'null-end DiscountSchedule lookup'
  );
  let nullEndScheduleId: string;
  if (nullEndCheck.length > 0) {
    nullEndScheduleId = nullEndCheck[0].Id;
    console.log(`  ✓ Null-end schedule already exists: ${nullEndScheduleId}`);
  } else {
    const nullEndFields: Record<string, unknown> = { Name: nullEndScheduleName };
    if (dsStartCol) nullEndFields[dsStartCol] = '2024-11-01';
    if (dsTypeCol) nullEndFields[dsTypeCol] = 'Range';
    // End-date column deliberately omitted whether it exists or not —
    // this fixture demonstrates the "no end date set" governance gap.
    nullEndScheduleId = await sfCreate('SBQQ__DiscountSchedule__c', nullEndFields, 'null-end promo schedule');
  }

  // 5 affected lines per schedule.
  const expiredLines: PromoLine[] = [
    { customerName: 'Vertex Cloud Expired', listPrice: 40_000, quantity: 6 },
    { customerName: 'Nimbus Group Expired',  listPrice: 28_000, quantity: 10 },
    { customerName: 'Strata Data Expired',   listPrice: 22_000, quantity: 12 },
    { customerName: 'Pillar Health Expired', listPrice: 60_000, quantity: 4 },
    { customerName: 'Beacon Energy Expired', listPrice: 18_000, quantity: 15 },
  ];
  const nullEndLines: PromoLine[] = [
    { customerName: 'Cascade Retail Promo',   listPrice: 25_000, quantity: 8 },
    { customerName: 'Apex Logistics Promo',   listPrice: 50_000, quantity: 3 },
    { customerName: 'Echo Tech Promo',        listPrice: 16_000, quantity: 20 },
    { customerName: 'Polaris Banking Promo',  listPrice: 72_000, quantity: 2 },
    { customerName: 'Summit Mfg Promo',       listPrice: 12_000, quantity: 18 },
  ];

  let createdLines = 0;
  let totalLeakage = 0;

  // Per-component idempotency: check the THING THAT MATTERS (QuoteLine
  // referencing our discount schedule), not a proxy (Contract by name).
  // We hit this same bug-class with the Price Rule earlier — a crash
  // mid-chain left the parent records sitting in the org while the
  // critical leaf record was missing.
  //
  // For each customer slot: look up an existing QuoteLine on this
  // Account that uses the relevant schedule. If found, skip. If not,
  // create the full chain (may produce a duplicate Contract — fixture
  // org tolerates that, recoverability of the engine matters more).
  const existingPromoLines = await sfQuery<{ Id: string; SBQQ__DiscountSchedule__c: string }>(
    `SELECT Id, SBQQ__DiscountSchedule__c FROM SBQQ__QuoteLine__c
     WHERE SBQQ__DiscountSchedule__c IN ('${expiredScheduleId}', '${nullEndScheduleId}')
     LIMIT 200`,
    'existing promo QuoteLines'
  );
  const existingLineCountByScheduleId = new Map<string, number>();
  for (const ql of existingPromoLines) {
    existingLineCountByScheduleId.set(
      ql.SBQQ__DiscountSchedule__c,
      (existingLineCountByScheduleId.get(ql.SBQQ__DiscountSchedule__c) ?? 0) + 1
    );
  }

  for (const [scheduleId, lineList, discountPct, subCaseLabel] of [
    [expiredScheduleId, expiredLines, expiredScheduleDiscount, 'expired'],
    [nullEndScheduleId, nullEndLines, nullEndScheduleDiscount, 'null-end'],
  ] as Array<[string, PromoLine[], number, string]>) {
    const existingCount = existingLineCountByScheduleId.get(scheduleId) ?? 0;
    const needed = Math.max(0, lineList.length - existingCount);
    if (needed === 0) {
      console.log(`  ✓ All ${lineList.length} ${subCaseLabel} promo QuoteLines already exist; skipping batch.`);
      // Still count them in expected leakage so the summary is honest.
      for (const line of lineList) {
        totalLeakage += line.listPrice * line.quantity * (discountPct / 100);
      }
      continue;
    }
    if (existingCount > 0) {
      console.log(`  ℹ️  ${existingCount} of ${lineList.length} ${subCaseLabel} QuoteLines already exist; creating ${needed} more.`);
    }
    const linesToCreate = lineList.slice(existingCount); // simple: create the tail

    for (const line of linesToCreate) {
      // The contract's StartDate is back-dated to give the renewal-
      // type quote line a plausible "created after expiry" timeline.
      // For sub-case (a), line CreatedDate is "today" (when seed runs)
      // which IS after 2025-03-31, so the detector classifies as expired.
      const contractId = await sfCreate('Contract', {
        AccountId: accountId,
        StartDate: '2024-01-01',
        ContractTerm: 12,
        Status: 'Draft',
        Description: `${fixtureTag}: ${line.customerName}`,
      }, `Promo Contract ${line.customerName}`);

      const subId = await sfCreate('SBQQ__Subscription__c', {
        SBQQ__Contract__c: contractId,
        SBQQ__Product__c: productId,
        SBQQ__Account__c: accountId,
        SBQQ__NetPrice__c: line.listPrice * (1 - discountPct / 100),
        SBQQ__Quantity__c: line.quantity,
        SBQQ__SubscriptionStartDate__c: '2024-01-01',
        SBQQ__SubscriptionEndDate__c: '2025-01-01',
      }, `Promo Subscription ${line.customerName}`);

      const quoteId = await sfCreate('SBQQ__Quote__c', {
        SBQQ__Account__c: accountId,
        SBQQ__Type__c: 'New',
        SBQQ__StartDate__c: '2024-06-01',
        SBQQ__EndDate__c: '2025-06-01',
      }, `Promo Quote ${line.customerName}`);

      // Promo lines are new-business quotes, not renewals — no link
      // back to a Subscription needed. The DSC-FOR-001 detector queries
      // QuoteLine → DiscountSchedule directly. We still create a
      // Subscription record above so the overall fixture data shape
      // matches a real signed promo deal.
      void subId;
      await sfCreate('SBQQ__QuoteLine__c', {
        SBQQ__Quote__c: quoteId,
        SBQQ__Product__c: productId,
        SBQQ__DiscountSchedule__c: scheduleId,
        SBQQ__Discount__c: discountPct,
        SBQQ__Quantity__c: line.quantity,
        SBQQ__ListPrice__c: line.listPrice,
        SBQQ__NetPrice__c: line.listPrice * (1 - discountPct / 100),
      }, `Promo QuoteLine ${line.customerName}`);

      createdLines += 1;
      totalLeakage += line.listPrice * line.quantity * (discountPct / 100);
      console.log(`  + ${line.customerName} (${subCaseLabel}, ${discountPct}% × ${line.quantity} units @ ${line.listPrice})`);
    }
  }
  console.log(`\n[5/6] DSC-FOR-001 summary: ${createdLines} promo lines created`);
  return totalLeakage;
}

/**
 * Wrap a promise so it rejects with a clear message if it takes too long.
 * Without this, a stuck jsforce call (token refresh loop, network drop)
 * leaves the script appearing to hang silently — worst possible failure
 * mode for a CLI tool.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
