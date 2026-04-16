/**
 * Standalone seed script — creates CPQ + Billing test records in the ksolves org.
 * Uses Supabase service role key to get SF credentials, then jsforce to create records.
 *
 * Usage: node scripts/seed-ksolves.mjs
 */
import { createClient } from '@supabase/supabase-js';
import jsforce from 'jsforce';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KSOLVES_ORG_ID = '1eff5a15-249d-472e-bd91-5d6c3150144c';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  // 1. Get org credentials from Supabase
  console.log('Fetching org credentials...');
  const { data: org, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', KSOLVES_ORG_ID)
    .single();

  if (error || !org) {
    console.error('Failed to fetch org:', error?.message);
    process.exit(1);
  }

  console.log(`Org: ${org.name} (${org.instance_url})`);

  // 2. Connect to Salesforce
  const conn = new jsforce.Connection({
    instanceUrl: org.instance_url,
    accessToken: org.access_token,
    version: '59.0',
  });

  // Try a simple query to check if token is valid
  try {
    const identity = await conn.identity();
    console.log(`Connected as: ${identity.username}`);
  } catch (e) {
    // Try refresh
    console.log('Access token expired, attempting refresh...');
    const oauth2 = new jsforce.OAuth2({
      clientId: process.env.SALESFORCE_CLIENT_ID,
      clientSecret: process.env.SALESFORCE_CLIENT_SECRET,
    });
    const refreshConn = new jsforce.Connection({
      instanceUrl: org.instance_url,
      refreshToken: org.refresh_token,
      oauth2,
    });
    try {
      await refreshConn.identity();
      conn.accessToken = refreshConn.accessToken;
      // Update token in Supabase
      await supabase
        .from('organizations')
        .update({ access_token: refreshConn.accessToken })
        .eq('id', KSOLVES_ORG_ID);
      console.log('Token refreshed successfully');
    } catch (e2) {
      console.error('Cannot connect to Salesforce:', e2.message);
      process.exit(1);
    }
  }

  const created = {};
  const errors = [];

  async function create(objectName, data, label) {
    try {
      const result = await conn.sobject(objectName).create(data);
      if (result.success) {
        if (!created[objectName]) created[objectName] = [];
        created[objectName].push(result.id);
        console.log(`  ✅ ${label}: ${result.id}`);
        return result.id;
      } else {
        errors.push(`${label}: ${JSON.stringify(result.errors)}`);
        console.log(`  ❌ ${label}: ${JSON.stringify(result.errors)}`);
        return null;
      }
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
      console.log(`  ❌ ${label}: ${err.message}`);
      return null;
    }
  }

  async function query(soql) {
    try {
      const result = await conn.query(soql);
      return result.records || [];
    } catch {
      return [];
    }
  }

  // ============================================
  // PART 1: CPQ RECORDS
  // ============================================
  console.log('\n=== CREATING CPQ TEST RECORDS ===\n');

  // --- APPROVAL RULES ---
  console.log('📋 Approval Rules...');

  // AR-001: Active rule without approver (critical)
  await create('SBQQ__ApprovalRule__c', {
    Name: 'CC_Test_NoApprover_Rule',
    SBQQ__Active__c: true,
    SBQQ__TargetObject__c: 'Quote',
    SBQQ__EvaluationOrder__c: 900,
  }, 'AR-001 No Approver');

  // AR-003: Duplicate eval order (warning)
  await create('SBQQ__ApprovalRule__c', {
    Name: 'CC_Test_DupOrder_Rule_1',
    SBQQ__Active__c: true,
    SBQQ__TargetObject__c: 'Quote',
    SBQQ__EvaluationOrder__c: 901,
  }, 'AR-003 Dup Order 1');

  await create('SBQQ__ApprovalRule__c', {
    Name: 'CC_Test_DupOrder_Rule_2',
    SBQQ__Active__c: true,
    SBQQ__TargetObject__c: 'Quote',
    SBQQ__EvaluationOrder__c: 901,
  }, 'AR-003 Dup Order 2');

  // AR-005: Inactive rule (info)
  await create('SBQQ__ApprovalRule__c', {
    Name: 'CC_Test_Inactive_Approval',
    SBQQ__Active__c: false,
    SBQQ__TargetObject__c: 'Quote',
  }, 'AR-005 Inactive');

  // --- GUIDED SELLING ---
  console.log('\n🎯 Guided Selling...');

  // GS-003: Inactive process (info)
  await create('SBQQ__GuidedSellingProcess__c', {
    Name: 'CC_Test_Inactive_GS',
    SBQQ__Active__c: false,
  }, 'GS-003 Inactive');

  // GS-001/GS-002: Active process with no inputs/outputs (critical)
  await create('SBQQ__GuidedSellingProcess__c', {
    Name: 'CC_Test_Empty_GS_Process',
    SBQQ__Active__c: true,
  }, 'GS-001/002 Empty Active');

  // --- QUOTE TEMPLATES ---
  console.log('\n📄 Quote Templates...');

  // QT-005: Default template in Draft (critical)
  await create('SBQQ__QuoteTemplate__c', {
    Name: 'CC_Test_Draft_Default_Template',
    SBQQ__Default__c: true,
    SBQQ__Status__c: 'Draft',
  }, 'QT-005 Draft Default');

  // QT-002: Non-active template (info)
  await create('SBQQ__QuoteTemplate__c', {
    Name: 'CC_Test_Inactive_Template',
    SBQQ__Default__c: false,
    SBQQ__Status__c: 'Inactive',
  }, 'QT-002 Inactive');

  // QT-003: Template with no sections (warning)
  await create('SBQQ__QuoteTemplate__c', {
    Name: 'CC_Test_Empty_Template',
    SBQQ__Default__c: false,
    SBQQ__Status__c: 'Active',
  }, 'QT-003 Empty');

  // --- QUOTE CALCULATOR PLUGIN ---
  console.log('\n⚡ Quote Calculator Plugin...');

  // QCP-001: Empty script (critical)
  await create('SBQQ__CustomScript__c', {
    Name: 'CC_Test_Empty_QCP',
    SBQQ__QuoteFields__c: 'SBQQ__NetAmount__c',
  }, 'QCP-001 Empty Script');

  // QCP-002: Script with code but no transpiled code (warning)
  await create('SBQQ__CustomScript__c', {
    Name: 'CC_Test_NoTranspile_QCP',
    SBQQ__Code__c: 'export function onBeforeCalculate(quote, lines, conn) { return Promise.resolve(); }',
    SBQQ__QuoteFields__c: 'SBQQ__NetAmount__c',
  }, 'QCP-002 No Transpiled');

  // QCP-004 triggered automatically by having 2+ scripts (info)

  // --- SUBSCRIPTIONS ---
  console.log('\n🔄 Subscriptions...');

  const accounts = await query('SELECT Id FROM Account LIMIT 1');
  const products = await query('SELECT Id FROM Product2 WHERE IsActive = true LIMIT 1');
  const accountId = accounts[0]?.Id;
  const productId = products[0]?.Id;

  if (accountId) {
    // SR-003: Subscription without contract (critical)
    await create('SBQQ__Subscription__c', {
      SBQQ__Account__c: accountId,
      SBQQ__Product__c: productId,
      SBQQ__Quantity__c: 1,
      SBQQ__NetPrice__c: 100,
    }, 'SR-003 No Contract');

    // SR-001: Zero-value subscription (warning)
    await create('SBQQ__Subscription__c', {
      SBQQ__Account__c: accountId,
      SBQQ__Product__c: productId,
      SBQQ__Quantity__c: 1,
      SBQQ__NetPrice__c: 0,
    }, 'SR-001 Zero Value');

    // SR-004: High quantity (info)
    await create('SBQQ__Subscription__c', {
      SBQQ__Account__c: accountId,
      SBQQ__Product__c: productId,
      SBQQ__Quantity__c: 2000,
      SBQQ__NetPrice__c: 50,
    }, 'SR-004 High Qty');
  } else {
    console.log('  ⚠️  No Account found — skipping subscriptions');
  }

  // ============================================
  // PART 2: BILLING RECORDS
  // ============================================
  console.log('\n=== CREATING BILLING TEST RECORDS ===\n');

  // --- BILLING RULES ---
  console.log('💰 Billing Rules...');

  const goodBillingRuleId = await create('blng__BillingRule__c', {
    Name: 'CC_Test_Good_Billing_Rule',
    blng__Active__c: true,
    blng__InitialBillingTrigger__c: 'Order Product Activation Date',
    blng__PartialPeriodTreatment__c: 'Separate',
    blng__GenerateInvoices__c: 'Yes',
  }, 'Good Billing Rule');

  // BR-001 trigger: Inactive billing rule
  const inactiveBillingRuleId = await create('blng__BillingRule__c', {
    Name: 'CC_Test_Inactive_Billing_Rule',
    blng__Active__c: false,
    blng__InitialBillingTrigger__c: 'Order Product Activation Date',
    blng__PartialPeriodTreatment__c: 'Separate',
    blng__GenerateInvoices__c: 'Yes',
  }, 'BR-001 Inactive');

  // BR-003: Orphaned billing rule
  await create('blng__BillingRule__c', {
    Name: 'CC_Test_Orphaned_Billing_Rule',
    blng__Active__c: true,
    blng__InitialBillingTrigger__c: 'Order Product Activation Date',
    blng__PartialPeriodTreatment__c: 'Separate',
    blng__GenerateInvoices__c: 'Yes',
  }, 'BR-003 Orphaned');

  // BR-004: Duplicate names
  await create('blng__BillingRule__c', {
    Name: 'CC_Test_Duplicate_Rule_Name',
    blng__Active__c: true,
    blng__InitialBillingTrigger__c: 'Order Product Activation Date',
    blng__PartialPeriodTreatment__c: 'Separate',
    blng__GenerateInvoices__c: 'Yes',
  }, 'BR-004 Dup 1');

  await create('blng__BillingRule__c', {
    Name: 'CC_Test_Duplicate_Rule_Name',
    blng__Active__c: true,
    blng__InitialBillingTrigger__c: 'Order Product Activation Date',
    blng__PartialPeriodTreatment__c: 'Separate',
    blng__GenerateInvoices__c: 'Yes',
  }, 'BR-004 Dup 2');

  // --- REV REC RULES ---
  console.log('\n📊 Revenue Recognition Rules...');

  const goodRevRecRuleId = await create('blng__RevenueRecognitionRule__c', {
    Name: 'CC_Test_Good_RevRec_Rule',
    blng__Active__c: true,
    blng__RevenueScheduleType__c: 'Divide',
    blng__CreateRevenueSchedule__c: 'Yes',
  }, 'Good RevRec Rule');

  const inactiveRevRecRuleId = await create('blng__RevenueRecognitionRule__c', {
    Name: 'CC_Test_Inactive_RevRec_Rule',
    blng__Active__c: false,
    blng__RevenueScheduleType__c: 'Divide',
    blng__CreateRevenueSchedule__c: 'Yes',
  }, 'RR-001 Inactive');

  // RR-002: Missing schedule type
  await create('blng__RevenueRecognitionRule__c', {
    Name: 'CC_Test_NoScheduleType_RevRec',
    blng__Active__c: true,
    blng__CreateRevenueSchedule__c: 'Yes',
  }, 'RR-002 No Schedule Type');

  // RR-003: Not creating schedules
  await create('blng__RevenueRecognitionRule__c', {
    Name: 'CC_Test_NoCreate_RevRec',
    blng__Active__c: true,
    blng__RevenueScheduleType__c: 'Divide',
    blng__CreateRevenueSchedule__c: 'No',
  }, 'RR-003 No Create');

  // RR-004: Orphaned
  await create('blng__RevenueRecognitionRule__c', {
    Name: 'CC_Test_Orphaned_RevRec_Rule',
    blng__Active__c: true,
    blng__RevenueScheduleType__c: 'Divide',
    blng__CreateRevenueSchedule__c: 'Yes',
  }, 'RR-004 Orphaned');

  // --- TAX RULES ---
  console.log('\n🏛️ Tax Rules...');

  const goodTaxRuleId = await create('blng__TaxRule__c', {
    Name: 'CC_Test_Good_Tax_Rule',
    blng__Active__c: true,
    blng__TaxableYN__c: 'Yes',
    blng__TaxPercentage__c: 18,
  }, 'Good Tax Rule');

  const inactiveTaxRuleId = await create('blng__TaxRule__c', {
    Name: 'CC_Test_Inactive_Tax_Rule',
    blng__Active__c: false,
    blng__TaxableYN__c: 'Yes',
    blng__TaxPercentage__c: 10,
  }, 'TR-002 Inactive');

  // TR-003: Zero percent
  await create('blng__TaxRule__c', {
    Name: 'CC_Test_Zero_Tax_Rule',
    blng__Active__c: true,
    blng__TaxableYN__c: 'Yes',
    blng__TaxPercentage__c: 0,
  }, 'TR-003 Zero');

  // --- GL RULES ---
  console.log('\n📒 GL Rules...');

  const goodGLRuleId = await create('blng__GLRule__c', {
    Name: 'CC_Test_Good_GL_Rule',
    blng__Active__c: true,
  }, 'Good GL Rule');

  // GL-002: Rule without treatments
  await create('blng__GLRule__c', {
    Name: 'CC_Test_Empty_GL_Rule',
    blng__Active__c: true,
  }, 'GL-002 No Treatments');

  // GL-005: Inactive GL rule (info)
  await create('blng__GLRule__c', {
    Name: 'CC_Test_Inactive_GL_Rule',
    blng__Active__c: false,
  }, 'GL-005 Inactive');

  // GL treatments
  if (goodGLRuleId) {
    // GL-001: Treatment without accounts
    await create('blng__GLTreatment__c', {
      Name: 'CC_Test_NoAccounts_GL_Treatment',
      blng__Active__c: true,
      blng__GLRule__c: goodGLRuleId,
    }, 'GL-001 No Accounts');

    // GL-003: Inactive treatment on active rule
    await create('blng__GLTreatment__c', {
      Name: 'CC_Test_Inactive_GL_Treatment',
      blng__Active__c: false,
      blng__GLRule__c: goodGLRuleId,
    }, 'GL-003 Inactive Treatment');
  }

  // --- INVOICING ---
  console.log('\n🧾 Invoicing...');

  if (accountId) {
    const today = new Date();
    const oldDate = new Date(today);
    oldDate.setDate(oldDate.getDate() - 45);

    // INV-001: Stuck draft invoice (warning)
    await create('blng__Invoice__c', {
      blng__InvoiceStatus__c: 'Draft',
      blng__Account__c: accountId,
      blng__InvoiceDate__c: oldDate.toISOString().split('T')[0],
      blng__DueDate__c: oldDate.toISOString().split('T')[0],
    }, 'INV-001 Stuck Draft');
  }

  // --- PRODUCTS WITH BILLING CONFIG ---
  console.log('\n📦 Products with billing config...');

  // Product missing all rules (triggers PBC-001/002/003, TR-001)
  await create('Product2', {
    Name: 'CC_Test_NoRules_Product',
    IsActive: true,
  }, 'PBC-001/002/003 No Rules');

  // Product with inactive rules
  if (inactiveBillingRuleId && inactiveRevRecRuleId && inactiveTaxRuleId) {
    await create('Product2', {
      Name: 'CC_Test_InactiveRules_Product',
      IsActive: true,
      blng__BillingRule__c: inactiveBillingRuleId,
      blng__RevenueRecognitionRule__c: inactiveRevRecRuleId,
      blng__TaxRule__c: inactiveTaxRuleId,
      SBQQ__ChargeType__c: 'One-Time',
    }, 'PBC-006 Inactive Rules');
  }

  // Recurring product without billing frequency
  if (goodBillingRuleId && goodRevRecRuleId && goodTaxRuleId) {
    await create('Product2', {
      Name: 'CC_Test_RecurringNoFreq_Product',
      IsActive: true,
      blng__BillingRule__c: goodBillingRuleId,
      blng__RevenueRecognitionRule__c: goodRevRecRuleId,
      blng__TaxRule__c: goodTaxRuleId,
      SBQQ__ChargeType__c: 'Recurring',
      SBQQ__BillingType__c: 'Advance',
    }, 'PBC-005 No Frequency');
  }

  // ============================================
  // SUMMARY
  // ============================================
  const totalCreated = Object.values(created).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Created ${totalCreated} records across ${Object.keys(created).length} objects`);
  for (const [obj, ids] of Object.entries(created)) {
    console.log(`   ${obj}: ${ids.length}`);
  }
  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} errors:`);
    for (const e of errors) {
      console.log(`   ${e}`);
    }
  }
}

main().catch(console.error);
