/**
 * Fix seed script — creates only the records that failed in the first run.
 * Fixes: QuoteTemplate (wrong field), RevRec (correct fields), TaxRule (correct field)
 * Skips: Approval Rules and Guided Selling (objects not installed in ksolves org)
 *
 * Usage: node scripts/seed-ksolves-fix.mjs
 */
import { createClient } from '@supabase/supabase-js';
import jsforce from 'jsforce';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KSOLVES_ORG_ID = '1eff5a15-249d-472e-bd91-5d6c3150144c';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  console.log('Fetching org credentials...');
  const { data: org } = await supabase
    .from('organizations').select('*').eq('id', KSOLVES_ORG_ID).single();

  const conn = new jsforce.Connection({
    instanceUrl: org.instance_url, accessToken: org.access_token, version: '59.0',
  });

  try { await conn.identity(); } catch {
    const oauth2 = new jsforce.OAuth2({
      clientId: process.env.SALESFORCE_CLIENT_ID,
      clientSecret: process.env.SALESFORCE_CLIENT_SECRET,
    });
    const rc = new jsforce.Connection({ instanceUrl: org.instance_url, refreshToken: org.refresh_token, oauth2 });
    await rc.identity();
    conn.accessToken = rc.accessToken;
    await supabase.from('organizations').update({ access_token: rc.accessToken }).eq('id', KSOLVES_ORG_ID);
    console.log('Token refreshed');
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

  console.log('\n=== CREATING MISSING RECORDS ===\n');

  // --- QUOTE TEMPLATES (using SBQQ__DeploymentStatus__c, not SBQQ__Status__c) ---
  console.log('📄 Quote Templates...');

  // QT-005: Default template in Draft (critical)
  await create('SBQQ__QuoteTemplate__c', {
    Name: 'CC_Test_Draft_Default_Template',
    SBQQ__Default__c: true,
  }, 'QT-005 Draft Default (no DeploymentStatus = defaults to Draft)');

  // QT-002: Non-active template (info) - create without setting DeploymentStatus
  await create('SBQQ__QuoteTemplate__c', {
    Name: 'CC_Test_Inactive_Template',
    SBQQ__Default__c: false,
  }, 'QT-002 Non-active');

  // QT-003: Template with no sections (warning)
  // Note: We need to create a template but its DeploymentStatus defaults may vary
  // Check what DeploymentStatus picklist values exist
  try {
    const desc = await conn.sobject('SBQQ__QuoteTemplate__c').describe();
    const dsField = desc.fields.find(f => f.name === 'SBQQ__DeploymentStatus__c');
    if (dsField) {
      console.log(`  DeploymentStatus picklist values: ${dsField.picklistValues?.map(v => v.value).join(', ')}`);
    }
  } catch { /* ignore */ }

  // --- REV REC RULES (only blng__Active__c and blng__CreateRevenueSchedule__c exist) ---
  console.log('\n📊 Revenue Recognition Rules...');

  // Good RevRec rule (for RR-001 test - will reference from product)
  const goodRevRecId = await create('blng__RevenueRecognitionRule__c', {
    Name: 'CC_Test_Good_RevRec_Rule',
    blng__Active__c: true,
    blng__CreateRevenueSchedule__c: 'Yes',
  }, 'Good RevRec Rule');

  // RR-001: Inactive rule (will be referenced by product)
  const inactiveRevRecId = await create('blng__RevenueRecognitionRule__c', {
    Name: 'CC_Test_Inactive_RevRec_Rule',
    blng__Active__c: false,
    blng__CreateRevenueSchedule__c: 'Yes',
  }, 'RR-001 Inactive');

  // RR-003: Active rule not creating schedules
  await create('blng__RevenueRecognitionRule__c', {
    Name: 'CC_Test_NoCreate_RevRec',
    blng__Active__c: true,
    blng__CreateRevenueSchedule__c: 'No',
  }, 'RR-003 No Create');

  // RR-004: Orphaned rule
  await create('blng__RevenueRecognitionRule__c', {
    Name: 'CC_Test_Orphaned_RevRec_Rule',
    blng__Active__c: true,
    blng__CreateRevenueSchedule__c: 'Yes',
  }, 'RR-004 Orphaned');

  // --- TAX RULES (only blng__Active__c and blng__TaxableYesNo__c exist) ---
  console.log('\n🏛️ Tax Rules...');

  // Good tax rule
  const goodTaxId = await create('blng__TaxRule__c', {
    Name: 'CC_Test_Good_Tax_Rule',
    blng__Active__c: true,
    blng__TaxableYesNo__c: 'Yes',
  }, 'Good Tax Rule');

  // TR-002: Inactive tax rule (will be referenced by product)
  const inactiveTaxId = await create('blng__TaxRule__c', {
    Name: 'CC_Test_Inactive_Tax_Rule',
    blng__Active__c: false,
    blng__TaxableYesNo__c: 'Yes',
  }, 'TR-002 Inactive');

  // TR-003: Active rule not marked taxable
  await create('blng__TaxRule__c', {
    Name: 'CC_Test_NonTaxable_Rule',
    blng__Active__c: true,
    blng__TaxableYesNo__c: 'No',
  }, 'TR-003 Not Taxable');

  // TR-004: Inactive tax rule for cleanup (info)
  await create('blng__TaxRule__c', {
    Name: 'CC_Test_Dead_Tax_Rule',
    blng__Active__c: false,
    blng__TaxableYesNo__c: 'No',
  }, 'TR-004 Dead Tax');

  // --- GL TREATMENT (fix the duplicate UniqueId issue) ---
  console.log('\n📒 GL Treatment fix...');

  // Query existing GL rules to add inactive treatment
  const glRules = await conn.query("SELECT Id FROM blng__GLRule__c WHERE blng__Active__c = true LIMIT 1");
  if (glRules.records?.length > 0) {
    await create('blng__GLTreatment__c', {
      Name: 'CC_Test_Inactive_GL_Treatment_v2',
      blng__Active__c: false,
      blng__GLRule__c: glRules.records[0].Id,
      blng__UniqueId__c: 'CC_Test_InactiveGLTreatment_' + Date.now(),
    }, 'GL-003 Inactive Treatment');
  }

  // --- PRODUCTS WITH INACTIVE RULES ---
  console.log('\n📦 Products with inactive billing rules...');

  // Get existing good billing rule
  const billingRules = await conn.query("SELECT Id FROM blng__BillingRule__c WHERE blng__Active__c = false AND Name LIKE 'CC_Test%' LIMIT 1");
  const inactiveBillingId = billingRules.records?.[0]?.Id;

  if (inactiveBillingId && inactiveRevRecId && inactiveTaxId) {
    await create('Product2', {
      Name: 'CC_Test_InactiveRules_Product',
      IsActive: true,
      blng__BillingRule__c: inactiveBillingId,
      blng__RevenueRecognitionRule__c: inactiveRevRecId,
      blng__TaxRule__c: inactiveTaxId,
      SBQQ__ChargeType__c: 'One-Time',
    }, 'PBC-006 Product with inactive rules');
  }

  // Recurring product without billing frequency
  const goodBillingRules = await conn.query("SELECT Id FROM blng__BillingRule__c WHERE blng__Active__c = true LIMIT 1");
  const goodBillingId = goodBillingRules.records?.[0]?.Id;

  if (goodBillingId && goodRevRecId && goodTaxId) {
    await create('Product2', {
      Name: 'CC_Test_RecurringNoFreq_Product',
      IsActive: true,
      blng__BillingRule__c: goodBillingId,
      blng__RevenueRecognitionRule__c: goodRevRecId,
      blng__TaxRule__c: goodTaxId,
      SBQQ__ChargeType__c: 'Recurring',
      SBQQ__BillingType__c: 'Advance',
    }, 'PBC-005 Recurring No Frequency');
  }

  // ============================================
  const totalCreated = Object.values(created).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Created ${totalCreated} records across ${Object.keys(created).length} objects`);
  for (const [obj, ids] of Object.entries(created)) {
    console.log(`   ${obj}: ${ids.length}`);
  }
  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} errors:`);
    for (const e of errors) console.log(`   ${e}`);
  }
}

main().catch(console.error);
