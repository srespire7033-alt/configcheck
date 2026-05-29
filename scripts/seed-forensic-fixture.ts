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
  let priceRuleId: string;
  if (existingRules.length > 0) {
    priceRuleId = existingRules[0].Id;
    console.log(`  ✓ Already exists: ${priceRuleId}`);
  } else {
    // Note: SBQQ__Description__c was removed from SBQQ__PriceRule__c in
    // newer CPQ packages. The rule is identifiable by Name alone — the
    // description was nice-to-have for telling fixture rules apart in
    // Setup but isn't required for the engine.
    priceRuleId = await sfCreate('SBQQ__PriceRule__c', {
      Name: priceRuleName,
      SBQQ__Active__c: true,
      SBQQ__EvaluationEvent__c: 'On Calculate',
      SBQQ__ConditionsMet__c: 'All',
    }, 'Renewal Floor Pricing');

    await sfCreate('SBQQ__PriceCondition__c', {
      Name: 'When renewal type',
      SBQQ__Rule__c: priceRuleId,
      SBQQ__Object__c: 'Quote',
      SBQQ__Field__c: 'SBQQ__Type__c',
      SBQQ__Operator__c: 'equals',
      SBQQ__Value__c: 'Renewal',
    }, 'When renewal type');

    await sfCreate('SBQQ__PriceAction__c', {
      Name: 'Strip uplift on renewal',
      SBQQ__Rule__c: priceRuleId,
      SBQQ__TargetField__c: 'SBQQ__NetPrice__c',
      SBQQ__Formula__c: 'SBQQ__Quantity__c * SBQQ__ListPrice__c',
    }, 'Strip uplift');
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

  const existingContracts = await sfQuery<IdRef & { Description: string }>(
    `SELECT Id, Description FROM Contract WHERE Description LIKE '%${FIXTURE_TAG}%' LIMIT 100`,
    'existing fixture Contracts'
  );
  const existingContractCustomers = new Set(
    existingContracts.map((r) => r.Description.split(':')[1]?.trim())
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

    await sfCreate('SBQQ__QuoteLine__c', {
      SBQQ__Quote__c: quoteId,
      SBQQ__Subscription__c: subId,
      SBQQ__Product__c: productId,
      SBQQ__Quantity__c: def.quantity,
      SBQQ__ListPrice__c: def.originalPrice,
      SBQQ__NetPrice__c: renewalPrice,
    }, `Quote Line ${def.customerName}`);

    createdContracts++;
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
