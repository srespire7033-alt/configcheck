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

import { createRefreshableConnection } from '@/lib/salesforce/client';

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
  const { conn } = await createRefreshableConnection(orgUuid);
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

  // ─── 1. Ensure the offending Price Rule exists ──────────────────────
  const priceRuleName = 'Renewal Floor Pricing — Forensic Fixture';
  console.log(`\n[1/4] Ensuring Price Rule "${priceRuleName}"...`);
  const rulesStart = Date.now();
  const existingRules = await withTimeout(
    Promise.resolve(
      conn.query<IdRef & { Name: string }>(
        `SELECT Id, Name FROM SBQQ__PriceRule__c WHERE Name = '${priceRuleName.replace(/'/g, "\\'")}' LIMIT 1`
      )
    ),
    30_000,
    'price rule lookup'
  );
  console.log(`  Lookup took ${Date.now() - rulesStart}ms, found ${existingRules.records.length} matching rule(s).`);
  let priceRuleId: string;
  if (existingRules.records.length > 0) {
    priceRuleId = existingRules.records[0].Id;
    console.log(`  ✓ Already exists: ${priceRuleId}`);
  } else {
    const ruleRes = await conn.sobject('SBQQ__PriceRule__c').create({
      Name: priceRuleName,
      SBQQ__Active__c: true,
      SBQQ__EvaluationEvent__c: 'On Calculate',
      SBQQ__ConditionsMet__c: 'All',
      SBQQ__Description__c: `${FIXTURE_TAG} Intentionally suppresses renewal uplift. Created to demonstrate Class C attribution.`,
    });
    if (!ruleRes.success) throw new Error(`Failed to create Price Rule: ${JSON.stringify(ruleRes)}`);
    priceRuleId = ruleRes.id;
    console.log(`  + Created: ${priceRuleId}`);

    // Condition: SBQQ__Quote__c.SBQQ__Type__c = 'Renewal'
    await conn.sobject('SBQQ__PriceCondition__c').create({
      Name: 'When renewal type',
      SBQQ__Rule__c: priceRuleId,
      SBQQ__Object__c: 'Quote',
      SBQQ__Field__c: 'SBQQ__Type__c',
      SBQQ__Operator__c: 'equals',
      SBQQ__Value__c: 'Renewal',
    });

    // Action: SBQQ__NetPrice__c = SBQQ__Quantity__c * SBQQ__ListPrice__c
    // (Ignores the contracted uplift — that's the conflict.)
    await conn.sobject('SBQQ__PriceAction__c').create({
      Name: 'Strip uplift on renewal',
      SBQQ__Rule__c: priceRuleId,
      SBQQ__TargetField__c: 'SBQQ__NetPrice__c',
      SBQQ__Formula__c: 'SBQQ__Quantity__c * SBQQ__ListPrice__c',
    });
    console.log(`    + Added Condition + Action`);
  }

  // ─── 2. Create the 10 Contracts + Subscriptions + renewal QuoteLines ─
  console.log(`\n[2/4] Seeding ${CONTRACTS.length} contracts + subscriptions + renewal quote lines...`);

  // Pick an Account to hang everything off of. If none exists, create a fixture one.
  let fixtureAccountId: string;
  const acctQ = await conn.query<IdRef>(
    `SELECT Id FROM Account WHERE Name = 'OrgPrism Forensic Fixture Co' LIMIT 1`
  );
  if (acctQ.records.length > 0) {
    fixtureAccountId = acctQ.records[0].Id;
  } else {
    const acctRes = await conn.sobject('Account').create({
      Name: 'OrgPrism Forensic Fixture Co',
      Description: `${FIXTURE_TAG}`,
    });
    if (!acctRes.success) throw new Error(`Failed to create fixture Account: ${JSON.stringify(acctRes)}`);
    fixtureAccountId = acctRes.id;
  }

  // Need a Product to reference. Use first active.
  const prodQ = await conn.query<IdRef & { Name: string }>(
    `SELECT Id, Name FROM Product2 WHERE IsActive = TRUE LIMIT 1`
  );
  if (prodQ.records.length === 0) {
    throw new Error('No active Product2 found in this org. Create at least one product manually, then re-run.');
  }
  const productId = prodQ.records[0].Id;
  const productName = prodQ.records[0].Name;
  console.log(`  Using Product2: ${productName} (${productId})`);

  // Check existing fixture contracts
  const existingContractsQ = await conn.query<IdRef & { ContractNumber: string; Description: string }>(
    `SELECT Id, ContractNumber, Description FROM Contract WHERE Description LIKE '%${FIXTURE_TAG}%' LIMIT 100`
  );
  const existingContractNumbers = new Set(existingContractsQ.records.map((r) => r.Description.split(':')[1]?.trim()));
  let createdContracts = 0;
  let skippedContracts = 0;

  for (const def of CONTRACTS) {
    const marker = `${FIXTURE_TAG}: ${def.customerName}`;
    if (existingContractNumbers.has(def.customerName)) {
      skippedContracts++;
      continue;
    }

    // Contract with uplift entitlement.
    const contractRes = await conn.sobject('Contract').create({
      AccountId: fixtureAccountId,
      StartDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      ContractTerm: 12,
      Status: 'Activated',
      Description: marker,
      SBQQ__RenewalUpliftRate__c: def.upliftPct,
    });
    if (!contractRes.success) {
      console.warn(`  ✗ Contract for ${def.customerName}: ${JSON.stringify(contractRes)}`);
      continue;
    }
    const contractId = contractRes.id;

    // Subscription record (original price).
    const subRes = await conn.sobject('SBQQ__Subscription__c').create({
      SBQQ__Contract__c: contractId,
      SBQQ__Product__c: productId,
      SBQQ__Account__c: fixtureAccountId,
      SBQQ__NetPrice__c: def.originalPrice,
      SBQQ__Quantity__c: def.quantity,
      SBQQ__SubscriptionStartDate__c: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      SBQQ__SubscriptionEndDate__c: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    if (!subRes.success) {
      console.warn(`  ✗ Subscription for ${def.customerName}: ${JSON.stringify(subRes)}`);
      continue;
    }
    const subId = subRes.id;

    // Renewal Quote.
    const renewalQuoteRes = await conn.sobject('SBQQ__Quote__c').create({
      SBQQ__Account__c: fixtureAccountId,
      SBQQ__Type__c: 'Renewal',
      SBQQ__StartDate__c: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      SBQQ__EndDate__c: new Date(Date.now() + 351 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    if (!renewalQuoteRes.success) {
      console.warn(`  ✗ Renewal Quote for ${def.customerName}: ${JSON.stringify(renewalQuoteRes)}`);
      continue;
    }
    const quoteId = renewalQuoteRes.id;

    // Renewal Quote Line. If this contract is "leaky", we simulate the
    // Price Rule having fired by storing the un-uplifted price as the
    // NetPrice. If clean, we store the correctly-uplifted price.
    const fraction = def.upliftPct / 100;
    const renewalPrice = def.isLeaky
      ? def.originalPrice                  // Price Rule wiped uplift
      : def.originalPrice * (1 + fraction); // Clean uplift applied

    await conn.sobject('SBQQ__QuoteLine__c').create({
      SBQQ__Quote__c: quoteId,
      SBQQ__Subscription__c: subId,
      SBQQ__Product__c: productId,
      SBQQ__Quantity__c: def.quantity,
      SBQQ__ListPrice__c: def.originalPrice,
      SBQQ__NetPrice__c: renewalPrice,
    });

    createdContracts++;
    console.log(`  + ${def.customerName} — ${def.isLeaky ? 'LEAKY' : 'clean'} (${def.upliftPct}% uplift, ${def.originalPrice}/unit × ${def.quantity})`);
  }

  console.log(`\n[3/4] Summary:`);
  console.log(`  Created: ${createdContracts}`);
  console.log(`  Skipped (already existed): ${skippedContracts}`);

  // Expected leakage:
  const expectedLeakage = CONTRACTS.filter((c) => c.isLeaky).reduce(
    (sum, c) => sum + c.originalPrice * c.quantity * (c.upliftPct / 100),
    0
  );
  console.log(`\n[4/4] Expected verified leakage when REN-001 runs: ~$${Math.round(expectedLeakage).toLocaleString()}`);
  console.log(`     (Sum across ${CONTRACTS.filter((c) => c.isLeaky).length} leaky renewals)`);
  console.log(`\n✓ Done. Now go to OrgPrism → CPQ Ks → "New Scan + Forensics" to see the engine in action.`);
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
