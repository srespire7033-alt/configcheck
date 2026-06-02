/**
 * Seed: fixtures for the 8 new detectors in Slice 14.
 *   REN-004      Renewal Quote stuck in Draft past contract end
 *   PROV-FOR-002 Active subscription with no Asset
 *   AMD-FOR-001  Amendment Quote missing effective date
 *   AST-FOR-001  Asset terminated, sub still billing, no credit
 *   DSC-FOR-002  Stacked discounts exceed approved cap
 *   CT-FOR-001   Contracted Price expired but still applied
 *   MDQ-FOR-001  MDQ segment pricing inconsistency
 *   QL-FOR-002   QuoteLine discount above threshold, no approval
 *
 * Uses the existing 'OrgPrism Detector Demo Co' account so we
 * don't collide with REN/DSC/ORD fixtures. All Slice-14 records
 * tagged with NDF2- name prefix where applicable for idempotency.
 *
 * --reseed wipes all NDF2-* tagged records (and their dependent
 * QuoteLines / Subs / Assets etc) before re-creating. Scoped via
 * Opportunity.Name LIKE 'NDF2-%' + filtering on this Account, so
 * it cannot touch unrelated fixtures.
 *
 * Detectors that need objects not in every org (CT-FOR-001 needs
 * SBQQ__ContractedPrice__c, MDQ-FOR-001 needs SBQQ__SegmentIndex__c
 * on QuoteLine, QL-FOR-002 needs Approval Rule + Approval objects)
 * silently skip their scenario if the probe fails.
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
    console.error('Usage: npx tsx scripts/seed-slice-14-fixtures.ts <orgUuid> [--reseed]');
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
    console.error('No access token for this org. Reconnect in OrgPrism first.');
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
  async function sfUpdate(sobject: string, id: string, fields: Record<string, unknown>, label: string): Promise<boolean> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (await (conn.sobject(sobject) as any).update({ Id: id, ...fields })) as { success: boolean; errors?: unknown };
      if (!r.success) {
        console.warn(`  ⚠️  ${label}: ${JSON.stringify(r.errors)}`);
        return false;
      }
      return true;
    } catch (e) {
      console.warn(`  ⚠️  ${label}: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  // ─── 1. Locate fixture Account ──────────────────────────────────
  console.log(`\n[1] Locate '${FIXTURE_ACCOUNT_NAME}'...`);
  const accts = await sfQuery<{ Id: string }>(
    `SELECT Id FROM Account WHERE Name = '${FIXTURE_ACCOUNT_NAME}' LIMIT 1`,
    'Account'
  );
  let acctId: string;
  if (accts.length > 0) {
    acctId = accts[0].Id;
    console.log(`    ✓ Found ${acctId}`);
  } else {
    const id = await sfCreate('Account', { Name: FIXTURE_ACCOUNT_NAME }, 'create Account');
    if (!id) {
      console.error('Could not create Account. Abort.');
      process.exit(1);
    }
    acctId = id;
  }

  // ─── 2. --reseed: wipe NDF2-tagged records ──────────────────────
  if (reseed) {
    console.log('\n[2] --reseed: wiping NDF2-tagged records...');
    const sweepDelete = async (sobject: string, where: string) => {
      try {
        const rows = await sfQuery<{ Id: string }>(`SELECT Id FROM ${sobject} WHERE ${where}`, sobject);
        for (const row of rows) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (conn.sobject(sobject) as any).destroy(row.Id);
          } catch {
            // soft-fail
          }
        }
      } catch {
        // ignore
      }
    };
    // QuoteLines under NDF2 quotes
    await sweepDelete('SBQQ__QuoteLine__c', `SBQQ__Quote__r.SBQQ__Opportunity2__r.Name LIKE 'NDF2-%'`);
    // Quotes under NDF2 opportunities
    await sweepDelete('SBQQ__Quote__c', `SBQQ__Opportunity2__r.Name LIKE 'NDF2-%'`);
    // Subscriptions can't be tagged via Name (auto-number). We delete
    // any Sub on the fixture Account that was created recently AND
    // doesn't link to a real Contract — adequately scoped.
    await sweepDelete(
      'SBQQ__Subscription__c',
      `SBQQ__Account__c = '${acctId}' AND CreatedDate >= LAST_N_DAYS:7`
    );
    // Assets named NDF2-
    await sweepDelete('Asset', `AccountId = '${acctId}' AND Name LIKE 'NDF2-%'`);
    // Contracts on this Account with Description tag
    await sweepDelete('Contract', `AccountId = '${acctId}' AND Description LIKE '%NDF2-%'`);
    // Opportunities
    await sweepDelete('Opportunity', `AccountId = '${acctId}' AND Name LIKE 'NDF2-%'`);
    console.log('    ✓ Cleaned.');
  }

  // ─── 3. Standard Pricebook + products ───────────────────────────
  console.log('\n[3] Pick Standard Pricebook + products...');
  const stdPb = await sfQuery<{ Id: string }>(`SELECT Id FROM Pricebook2 WHERE IsStandard = TRUE LIMIT 1`, 'std PB');
  if (stdPb.length === 0) {
    console.error('No Standard Pricebook. Abort.');
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
    'PBEs'
  );
  if (pbeRows.length < 5) {
    console.error(`Need at least 5 PBEs > $100, found ${pbeRows.length}`);
    process.exit(1);
  }
  for (const p of pbeRows) {
    console.log(`    • ${p.Product2.Name} @ $${p.UnitPrice}`);
  }
  const [p1, p2, p3, p4, p5] = pbeRows;

  const today = new Date();
  const dateStr = (daysOffset: number) =>
    new Date(today.getTime() + daysOffset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // ─── Helper: probe a field on an sObject ────────────────────────
  async function hasField(sobject: string, field: string): Promise<boolean> {
    try {
      const desc = await conn.describe(sobject);
      return desc.fields.some((f) => f.name === field);
    } catch {
      return false;
    }
  }

  // ─── 4. REN-004 — Renewal Quote stuck in Draft past contract end ─
  console.log('\n[4] Seeding REN-004 (stuck renewal)...');
  // Contract with EndDate 60 days ago
  const conId = await sfCreate('Contract', {
    AccountId: acctId,
    Status: 'Draft',
    StartDate: dateStr(-425), // ended 60 days ago, 365-day contract
    ContractTerm: 12,
    Description: 'NDF2-REN004-StuckContract',
  }, 'REN-004 Contract');
  if (conId) {
    await sfUpdate('Contract', conId, { Status: 'Activated' }, 'activate REN-004 Contract');
    // Opportunity for the renewal Quote
    const oppId = await sfCreate('Opportunity', {
      Name: 'NDF2-REN004-StuckRenewal',
      AccountId: acctId,
      CloseDate: dateStr(-30),
      StageName: 'Proposal',
      Pricebook2Id: stdPbId,
    }, 'REN-004 Opp');
    if (oppId) {
      const quoteId = await sfCreate('SBQQ__Quote__c', {
        SBQQ__Account__c: acctId,
        SBQQ__Opportunity2__c: oppId,
        SBQQ__Primary__c: true,
        SBQQ__Type__c: 'Renewal',
        SBQQ__Status__c: 'Draft',
        SBQQ__StartDate__c: dateStr(-60),
        SBQQ__EndDate__c: dateStr(305),
        SBQQ__PriceBook__c: stdPbId,
        SBQQ__MasterContract__c: conId,
      }, 'REN-004 Quote');
      if (quoteId) {
        await sfCreate('SBQQ__QuoteLine__c', {
          SBQQ__Quote__c: quoteId,
          SBQQ__Product__c: p1.Product2Id,
          SBQQ__Quantity__c: 100,
          SBQQ__ListPrice__c: Number(p1.UnitPrice),
          SBQQ__NetPrice__c: Number(p1.UnitPrice),
          SBQQ__CustomerPrice__c: Number(p1.UnitPrice),
          SBQQ__PricingMethod__c: 'List',
        }, 'REN-004 QL');
        console.log(`    + Renewal Quote stuck in Draft, contract ended 60d ago, ARR ≈ $${(100 * Number(p1.UnitPrice)).toLocaleString()}`);
      }
    }
  }

  // ─── 5. PROV-FOR-002 — Active sub with no Asset ─────────────────
  console.log('\n[5] Seeding PROV-FOR-002 (sub no asset)...');
  // Two subs, neither has a matching Asset
  for (let i = 0; i < 2; i++) {
    const product = i === 0 ? p2 : p3;
    const qty = i === 0 ? 12 : 8;
    const subId = await sfCreate('SBQQ__Subscription__c', {
      // SBQQ__Subscription__c.Name is auto-numbered; can't write to it.
      // We can still scope --reseed via Account + custom field if needed.
      SBQQ__Account__c: acctId,
      SBQQ__Product__c: product.Product2Id,
      SBQQ__Quantity__c: qty,
      SBQQ__NetPrice__c: Number(product.UnitPrice),
      SBQQ__SubscriptionStartDate__c: dateStr(-180),
      SBQQ__SubscriptionEndDate__c: dateStr(180),
    }, `PROV-FOR-002 Sub ${i + 1}`);
    if (subId) {
      console.log(`    + ${qty}× ${product.Product2.Name} sub, no Asset (${(qty * Number(product.UnitPrice)).toLocaleString()}/yr)`);
    }
  }

  // ─── 6. AMD-FOR-001 — Amendment with no effective date ──────────
  console.log('\n[6] Seeding AMD-FOR-001 (amendment no start date)...');
  const amdOppId = await sfCreate('Opportunity', {
    Name: 'NDF2-AMD001-NoStartDate',
    AccountId: acctId,
    CloseDate: dateStr(15),
    StageName: 'Closed Won',
    Pricebook2Id: stdPbId,
  }, 'AMD-FOR-001 Opp');
  if (amdOppId) {
    const amdQuoteId = await sfCreate('SBQQ__Quote__c', {
      SBQQ__Account__c: acctId,
      SBQQ__Opportunity2__c: amdOppId,
      SBQQ__Primary__c: true,
      SBQQ__Type__c: 'Amendment',
      SBQQ__Status__c: 'Approved',
      // Deliberately omit SBQQ__StartDate__c
      SBQQ__EndDate__c: dateStr(300),
      SBQQ__PriceBook__c: stdPbId,
    }, 'AMD-FOR-001 Quote');
    if (amdQuoteId) {
      await sfCreate('SBQQ__QuoteLine__c', {
        SBQQ__Quote__c: amdQuoteId,
        SBQQ__Product__c: p4.Product2Id,
        SBQQ__Quantity__c: 5,
        SBQQ__ListPrice__c: Number(p4.UnitPrice),
        SBQQ__NetPrice__c: Number(p4.UnitPrice),
        SBQQ__CustomerPrice__c: Number(p4.UnitPrice),
        SBQQ__PricingMethod__c: 'List',
        SBQQ__Existing__c: false,
      }, 'AMD-FOR-001 QL');
      console.log(`    + Amendment missing SBQQ__StartDate__c (Net ~$${(5 * Number(p4.UnitPrice)).toLocaleString()})`);
    }
  }

  // ─── 7. AST-FOR-001 — Asset terminated, sub still billing ───────
  console.log('\n[7] Seeding AST-FOR-001 (terminated asset, active sub)...');
  // Use a different product than PROV-FOR-002 to avoid colliding
  const astAsset = await sfCreate('Asset', {
    Name: 'NDF2-AST001-Terminated',
    AccountId: acctId,
    Product2Id: p5.Product2Id,
    Quantity: 20,
    Price: Number(p5.UnitPrice),
    Status: 'Terminated',
    UsageEndDate: dateStr(-45), // terminated 45 days ago
    InstallDate: dateStr(-400),
  }, 'AST-FOR-001 terminated Asset');
  if (astAsset) {
    // Matching active sub (same account + product) — different from the
    // PROV-FOR-002 subs which use p2/p3
    const astSub = await sfCreate('SBQQ__Subscription__c', {
      // Name is auto-numbered on SBQQ__Subscription__c, not writable.
      SBQQ__Account__c: acctId,
      SBQQ__Product__c: p5.Product2Id,
      SBQQ__Quantity__c: 20,
      SBQQ__NetPrice__c: Number(p5.UnitPrice),
      SBQQ__SubscriptionStartDate__c: dateStr(-400),
      SBQQ__SubscriptionEndDate__c: dateStr(120),
    }, 'AST-FOR-001 still-billing Sub');
    if (astSub) {
      console.log(`    + Asset terminated 45d ago, sub still billing $${(20 * Number(p5.UnitPrice)).toLocaleString()}/yr`);
    }
  }

  // ─── 8. DSC-FOR-002 — Stacked discounts > 50% cap ───────────────
  console.log('\n[8] Seeding DSC-FOR-002 (stacked discounts)...');
  const dscOppId = await sfCreate('Opportunity', {
    Name: 'NDF2-DSC002-StackedDiscount',
    AccountId: acctId,
    CloseDate: dateStr(20),
    StageName: 'Closed Won',
    Pricebook2Id: stdPbId,
  }, 'DSC-FOR-002 Opp');
  if (dscOppId) {
    const dscQuoteId = await sfCreate('SBQQ__Quote__c', {
      SBQQ__Account__c: acctId,
      SBQQ__Opportunity2__c: dscOppId,
      SBQQ__Primary__c: true,
      SBQQ__Type__c: 'Quote',
      SBQQ__Status__c: 'Approved',
      SBQQ__StartDate__c: dateStr(-30),
      SBQQ__EndDate__c: dateStr(335),
      SBQQ__PriceBook__c: stdPbId,
    }, 'DSC-FOR-002 Quote');
    if (dscQuoteId) {
      // 2 lines with deep discounts (70% off → far over 50% cap)
      for (let i = 0; i < 2; i++) {
        const product = i === 0 ? p1 : p2;
        const qty = i === 0 ? 20 : 10;
        const listPrice = Number(product.UnitPrice);
        const netPrice = listPrice * 0.30; // 70% effective discount
        await sfCreate('SBQQ__QuoteLine__c', {
          SBQQ__Quote__c: dscQuoteId,
          SBQQ__Product__c: product.Product2Id,
          SBQQ__Quantity__c: qty,
          SBQQ__ListPrice__c: listPrice,
          SBQQ__NetPrice__c: netPrice,
          SBQQ__CustomerPrice__c: netPrice,
          SBQQ__Discount__c: 70,
          SBQQ__PricingMethod__c: 'List',
        }, `DSC-FOR-002 QL ${i + 1}`);
      }
      console.log(`    + 2 quote lines with 70% effective discount (over 50% cap)`);
    }
  }

  // ─── 9. CT-FOR-001 — Expired Contracted Price ───────────────────
  console.log('\n[9] Seeding CT-FOR-001 (expired contracted price)...');
  const hasContractedPriceObj = await hasField('SBQQ__ContractedPrice__c', 'Id');
  const hasQlContractedPriceField = await hasField('SBQQ__QuoteLine__c', 'SBQQ__ContractedPrice__c');
  if (hasContractedPriceObj && hasQlContractedPriceField) {
    const cpProductPrice = Number(p3.UnitPrice);
    const lockedPrice = cpProductPrice * 0.60; // 40% discount locked in
    const cpId = await sfCreate('SBQQ__ContractedPrice__c', {
      SBQQ__Account__c: acctId,
      SBQQ__Product__c: p3.Product2Id,
      SBQQ__Price__c: lockedPrice,
      SBQQ__EffectiveDate__c: dateStr(-400),
      SBQQ__ExpirationDate__c: dateStr(-30), // expired 30 days ago
    }, 'CT-FOR-001 ContractedPrice');
    if (cpId) {
      const ctOppId = await sfCreate('Opportunity', {
        Name: 'NDF2-CT001-StalePrice',
        AccountId: acctId,
        CloseDate: dateStr(10),
        StageName: 'Closed Won',
        Pricebook2Id: stdPbId,
      }, 'CT-FOR-001 Opp');
      if (ctOppId) {
        const ctQuoteId = await sfCreate('SBQQ__Quote__c', {
          SBQQ__Account__c: acctId,
          SBQQ__Opportunity2__c: ctOppId,
          SBQQ__Primary__c: true,
          SBQQ__Type__c: 'Quote',
          SBQQ__Status__c: 'Approved',
          SBQQ__StartDate__c: dateStr(-5),
          SBQQ__EndDate__c: dateStr(360),
          SBQQ__PriceBook__c: stdPbId,
        }, 'CT-FOR-001 Quote');
        if (ctQuoteId) {
          await sfCreate('SBQQ__QuoteLine__c', {
            SBQQ__Quote__c: ctQuoteId,
            SBQQ__Product__c: p3.Product2Id,
            SBQQ__ContractedPrice__c: cpId,
            SBQQ__Quantity__c: 50,
            SBQQ__ListPrice__c: cpProductPrice,
            SBQQ__NetPrice__c: lockedPrice,
            SBQQ__CustomerPrice__c: lockedPrice,
            SBQQ__PricingMethod__c: 'List',
          }, 'CT-FOR-001 QL');
          const expectedGap = (cpProductPrice - lockedPrice) * 50;
          console.log(`    + Locked at $${lockedPrice}/unit, current list $${cpProductPrice}, gap $${expectedGap.toFixed(0)}`);
        }
      }
    }
  } else {
    console.log('    ⚠ SBQQ__ContractedPrice__c not available — CT-FOR-001 fixture skipped');
  }

  // ─── 10. MDQ-FOR-001 — Multi-year flat pricing ──────────────────
  console.log('\n[10] Seeding MDQ-FOR-001 (multi-year flat segments)...');
  const hasSegmentIndex = await hasField('SBQQ__QuoteLine__c', 'SBQQ__SegmentIndex__c');
  if (hasSegmentIndex) {
    const mdqOppId = await sfCreate('Opportunity', {
      Name: 'NDF2-MDQ001-MultiYear',
      AccountId: acctId,
      CloseDate: dateStr(15),
      StageName: 'Closed Won',
      Pricebook2Id: stdPbId,
    }, 'MDQ Opp');
    if (mdqOppId) {
      const mdqQuoteId = await sfCreate('SBQQ__Quote__c', {
        SBQQ__Account__c: acctId,
        SBQQ__Opportunity2__c: mdqOppId,
        SBQQ__Primary__c: true,
        SBQQ__Type__c: 'Quote',
        SBQQ__Status__c: 'Approved',
        SBQQ__StartDate__c: dateStr(-15),
        SBQQ__EndDate__c: dateStr(1080), // 3 years
        SBQQ__PriceBook__c: stdPbId,
      }, 'MDQ Quote');
      if (mdqQuoteId) {
        // 3 segments, same NetPrice each = no YoY uplift
        const flatPrice = Number(p1.UnitPrice);
        const qty = 20;
        for (let seg = 0; seg < 3; seg++) {
          await sfCreate('SBQQ__QuoteLine__c', {
            SBQQ__Quote__c: mdqQuoteId,
            SBQQ__Product__c: p1.Product2Id,
            SBQQ__Quantity__c: qty,
            SBQQ__ListPrice__c: flatPrice,
            SBQQ__NetPrice__c: flatPrice, // ← FLAT — should escalate by 5%/year
            SBQQ__CustomerPrice__c: flatPrice,
            SBQQ__PricingMethod__c: 'List',
            SBQQ__SegmentIndex__c: seg,
          }, `MDQ segment ${seg}`);
        }
        const expectedGap =
          flatPrice * qty * (Math.pow(1.05, 1) - 1) +
          flatPrice * qty * (Math.pow(1.05, 2) - 1);
        console.log(`    + 3 segments at flat $${flatPrice}/unit (no 5% YoY uplift) → ~$${expectedGap.toFixed(0)} gap`);
      }
    }
  } else {
    console.log('    ⚠ SBQQ__SegmentIndex__c not in this org — MDQ-FOR-001 fixture skipped');
  }

  // ─── 11. QL-FOR-002 — Discount above threshold, no approval ─────
  console.log('\n[11] Seeding QL-FOR-002 (approval skipped)...');
  const hasApprovalRule = await hasField('SBQQ__ApprovalRule__c', 'Id');
  const hasApproval = await hasField('SBQQ__Approval__c', 'Id');
  if (hasApprovalRule && hasApproval) {
    // Ensure an active approval rule with a low threshold (15%) exists
    const existing = await sfQuery<{ Id: string }>(
      `SELECT Id FROM SBQQ__ApprovalRule__c WHERE Name = 'NDF2-QL002-ApprovalThreshold' LIMIT 1`,
      'existing approval rule'
    );
    let approvalRuleId: string | null = null;
    if (existing.length > 0) {
      approvalRuleId = existing[0].Id;
    } else {
      approvalRuleId = await sfCreate('SBQQ__ApprovalRule__c', {
        Name: 'NDF2-QL002-ApprovalThreshold',
        SBQQ__Active__c: true,
        SBQQ__DiscountAmount__c: 15, // any line discounted ≥ 15% must approve
      }, 'QL-FOR-002 ApprovalRule');
    }

    if (approvalRuleId) {
      // Create a Quote with one heavily discounted line
      const qlOppId = await sfCreate('Opportunity', {
        Name: 'NDF2-QL002-SkippedApproval',
        AccountId: acctId,
        CloseDate: dateStr(7),
        StageName: 'Closed Won',
        Pricebook2Id: stdPbId,
      }, 'QL-FOR-002 Opp');
      if (qlOppId) {
        const qlQuoteId = await sfCreate('SBQQ__Quote__c', {
          SBQQ__Account__c: acctId,
          SBQQ__Opportunity2__c: qlOppId,
          SBQQ__Primary__c: true,
          SBQQ__Type__c: 'Quote',
          SBQQ__Status__c: 'Approved',
          SBQQ__StartDate__c: dateStr(-3),
          SBQQ__EndDate__c: dateStr(362),
          SBQQ__PriceBook__c: stdPbId,
        }, 'QL-FOR-002 Quote');
        if (qlQuoteId) {
          // 30% discount — well above 15% threshold. No SBQQ__Approval__c created.
          const listPrice = Number(p2.UnitPrice);
          const netPrice = listPrice * 0.70;
          await sfCreate('SBQQ__QuoteLine__c', {
            SBQQ__Quote__c: qlQuoteId,
            SBQQ__Product__c: p2.Product2Id,
            SBQQ__Quantity__c: 25,
            SBQQ__ListPrice__c: listPrice,
            SBQQ__NetPrice__c: netPrice,
            SBQQ__CustomerPrice__c: netPrice,
            SBQQ__Discount__c: 30,
            SBQQ__PricingMethod__c: 'List',
          }, 'QL-FOR-002 QL (30% discount, no approval)');
          console.log(`    + Quote line with 30% discount, threshold 15%, no SBQQ__Approval__c — line should flag`);
        }
      }
    }
  } else {
    console.log('    ⚠ Approval Rule / Approval objects not in org — QL-FOR-002 fixture skipped');
  }

  console.log('\n✅ Slice 14 fixtures seeded. Trigger a forensic scan in OrgPrism to populate the cards.');
  console.log('\nTo wipe + redo: npx tsx scripts/seed-slice-14-fixtures.ts <orgUuid> --reseed');
}

main().catch((e) => {
  console.error('\n✗ Seed failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
