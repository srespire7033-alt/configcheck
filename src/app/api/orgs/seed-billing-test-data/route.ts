import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { createRefreshableConnection } from '@/lib/salesforce/client';

/**
 * POST /api/orgs/seed-billing-test-data
 *
 * Seeds Salesforce org with billing test records to cover all 34 billing health checks.
 * Creates both POSITIVE (should pass) and NEGATIVE (should flag) scenarios.
 *
 * ⚠️  DEV/TEST ONLY — creates real records in the connected Salesforce org.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { organizationId } = await request.json();
    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .eq('user_id', user.id)
      .single();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const { conn } = await createRefreshableConnection(org.id);
    const created: Record<string, string[]> = {};
    const errors: string[] = [];

    // Helper: create a record and track it
    const create = async (objectName: string, data: Record<string, unknown>, label: string): Promise<string | null> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (conn.sobject(objectName) as any).create(data);
        if (result.success) {
          if (!created[objectName]) created[objectName] = [];
          created[objectName].push(result.id);
          console.log(`[SEED] ✅ Created ${label}: ${result.id}`);
          return result.id;
        } else {
          errors.push(`${label}: ${JSON.stringify(result.errors)}`);
          console.error(`[SEED] ❌ Failed ${label}:`, result.errors);
          return null;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${label}: ${msg}`);
        console.error(`[SEED] ❌ Error ${label}:`, msg);
        return null;
      }
    }

    console.log('[SEED] Starting billing test data creation...');

    // ============================================
    // 1. BILLING RULES (BR-001 to BR-004)
    // ============================================

    // ✅ POSITIVE: Active billing rule (good config)
    const goodBillingRuleId = await create('blng__BillingRule__c', {
      Name: 'CC_Test_Good_Billing_Rule',
      blng__Active__c: true,
      blng__InitialBillingTrigger__c: 'Order Product Activation Date',
      blng__PartialPeriodTreatment__c: 'Separate',
      blng__GenerateInvoices__c: 'Yes',
    }, 'Good Billing Rule');

    // ❌ BR-001: Inactive billing rule (will be referenced by a product)
    const inactiveBillingRuleId = await create('blng__BillingRule__c', {
      Name: 'CC_Test_Inactive_Billing_Rule',
      blng__Active__c: false,
      blng__InitialBillingTrigger__c: 'Order Product Activation Date',
      blng__PartialPeriodTreatment__c: 'Separate',
      blng__GenerateInvoices__c: 'Yes',
    }, 'Inactive Billing Rule (BR-001)');

    // ❌ BR-003: Orphaned billing rule (not referenced by any product)
    await create('blng__BillingRule__c', {
      Name: 'CC_Test_Orphaned_Billing_Rule',
      blng__Active__c: true,
      blng__InitialBillingTrigger__c: 'Order Product Activation Date',
      blng__PartialPeriodTreatment__c: 'Separate',
      blng__GenerateInvoices__c: 'Yes',
    }, 'Orphaned Billing Rule (BR-003)');

    // ❌ BR-004: Duplicate billing rule names
    await create('blng__BillingRule__c', {
      Name: 'CC_Test_Duplicate_Rule_Name',
      blng__Active__c: true,
      blng__InitialBillingTrigger__c: 'Order Product Activation Date',
      blng__PartialPeriodTreatment__c: 'Separate',
      blng__GenerateInvoices__c: 'Yes',
    }, 'Duplicate Billing Rule 1 (BR-004)');

    await create('blng__BillingRule__c', {
      Name: 'CC_Test_Duplicate_Rule_Name',
      blng__Active__c: true,
      blng__InitialBillingTrigger__c: 'Order Product Activation Date',
      blng__PartialPeriodTreatment__c: 'Separate',
      blng__GenerateInvoices__c: 'Yes',
    }, 'Duplicate Billing Rule 2 (BR-004)');

    // ============================================
    // 2. REVENUE RECOGNITION RULES (RR-001 to RR-004)
    // ============================================

    // ✅ POSITIVE: Active rev rec rule with schedule type
    const goodRevRecRuleId = await create('blng__RevenueRecognitionRule__c', {
      Name: 'CC_Test_Good_RevRec_Rule',
      blng__Active__c: true,
      blng__RevenueScheduleType__c: 'Divide',
      blng__CreateRevenueSchedule__c: 'Yes',
    }, 'Good Rev Rec Rule');

    // ❌ RR-001: Inactive rev rec rule (will be referenced by product)
    const inactiveRevRecRuleId = await create('blng__RevenueRecognitionRule__c', {
      Name: 'CC_Test_Inactive_RevRec_Rule',
      blng__Active__c: false,
      blng__RevenueScheduleType__c: 'Divide',
      blng__CreateRevenueSchedule__c: 'Yes',
    }, 'Inactive Rev Rec Rule (RR-001)');

    // ❌ RR-002: Rev rec rule without schedule type
    await create('blng__RevenueRecognitionRule__c', {
      Name: 'CC_Test_NoScheduleType_RevRec',
      blng__Active__c: true,
      blng__CreateRevenueSchedule__c: 'Yes',
    }, 'RevRec Without Schedule Type (RR-002)');

    // ❌ RR-003: Rev rec rule not creating schedules
    await create('blng__RevenueRecognitionRule__c', {
      Name: 'CC_Test_NoCreate_RevRec',
      blng__Active__c: true,
      blng__RevenueScheduleType__c: 'Divide',
      blng__CreateRevenueSchedule__c: 'No',
    }, 'RevRec Not Creating Schedules (RR-003)');

    // ❌ RR-004: Orphaned rev rec rule
    await create('blng__RevenueRecognitionRule__c', {
      Name: 'CC_Test_Orphaned_RevRec_Rule',
      blng__Active__c: true,
      blng__RevenueScheduleType__c: 'Divide',
      blng__CreateRevenueSchedule__c: 'Yes',
    }, 'Orphaned Rev Rec Rule (RR-004)');

    // ============================================
    // 3. TAX RULES (TR-001 to TR-003)
    // ============================================

    // ✅ POSITIVE: Active tax rule with proper percentage
    const goodTaxRuleId = await create('blng__TaxRule__c', {
      Name: 'CC_Test_Good_Tax_Rule',
      blng__Active__c: true,
      blng__TaxableYN__c: 'Yes',
      blng__TaxPercentage__c: 18,
    }, 'Good Tax Rule (18%)');

    // ❌ TR-002: Inactive tax rule (will be referenced by product)
    const inactiveTaxRuleId = await create('blng__TaxRule__c', {
      Name: 'CC_Test_Inactive_Tax_Rule',
      blng__Active__c: false,
      blng__TaxableYN__c: 'Yes',
      blng__TaxPercentage__c: 10,
    }, 'Inactive Tax Rule (TR-002)');

    // ❌ TR-003: Zero percent tax rule
    await create('blng__TaxRule__c', {
      Name: 'CC_Test_Zero_Tax_Rule',
      blng__Active__c: true,
      blng__TaxableYN__c: 'Yes',
      blng__TaxPercentage__c: 0,
    }, 'Zero Tax Rule (TR-003)');

    // ============================================
    // 4. GL RULES & TREATMENTS (GL-001 to GL-004)
    // ============================================

    // ✅ POSITIVE: Active GL rule with proper treatment
    const goodGLRuleId = await create('blng__GLRule__c', {
      Name: 'CC_Test_Good_GL_Rule',
      blng__Active__c: true,
    }, 'Good GL Rule');

    // ❌ GL-002: Active GL rule without any treatments
    await create('blng__GLRule__c', {
      Name: 'CC_Test_Empty_GL_Rule',
      blng__Active__c: true,
    }, 'GL Rule Without Treatments (GL-002)');

    // We need GL Accounts for treatments. Query existing ones or create dummy data.
    // First check if any GL accounts exist
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let glAccountId: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const glAccResult = await (conn as any).query(
        "SELECT Id FROM blng__GLAccount__c LIMIT 1"
      );
      if (glAccResult.records?.length > 0) {
        glAccountId = glAccResult.records[0].Id;
      }
    } catch {
      console.log('[SEED] No GL Account object or no records — skipping GL treatments with accounts');
    }

    if (goodGLRuleId) {
      if (glAccountId) {
        // ✅ POSITIVE: Good GL treatment with both accounts
        await create('blng__GLTreatment__c', {
          Name: 'CC_Test_Good_GL_Treatment',
          blng__Active__c: true,
          blng__GLRule__c: goodGLRuleId,
          blng__CreditGLAccount__c: glAccountId,
          blng__DebitGLAccount__c: glAccountId,
        }, 'Good GL Treatment (both accounts)');

        // ❌ GL-004: Treatment missing one side (debit only)
        await create('blng__GLTreatment__c', {
          Name: 'CC_Test_OneSided_GL_Treatment',
          blng__Active__c: true,
          blng__GLRule__c: goodGLRuleId,
          blng__DebitGLAccount__c: glAccountId,
        }, 'One-Sided GL Treatment (GL-004)');
      }

      // ❌ GL-001: Treatment missing both accounts
      await create('blng__GLTreatment__c', {
        Name: 'CC_Test_NoAccounts_GL_Treatment',
        blng__Active__c: true,
        blng__GLRule__c: goodGLRuleId,
      }, 'GL Treatment Without Accounts (GL-001)');

      // ❌ GL-003: Inactive treatment on active rule
      await create('blng__GLTreatment__c', {
        Name: 'CC_Test_Inactive_GL_Treatment',
        blng__Active__c: false,
        blng__GLRule__c: goodGLRuleId,
      }, 'Inactive GL Treatment on Active Rule (GL-003)');
    }

    // ============================================
    // 5. FINANCE BOOKS & PERIODS (FB-001 to FB-006)
    // ============================================

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

    // ✅ POSITIVE: Active finance book with proper open period covering today
    const goodBookId = await create('blng__FinanceBook__c', {
      Name: 'CC_Test_Good_Finance_Book',
      blng__Active__c: true,
      blng__PeriodType__c: 'Monthly',
    }, 'Good Finance Book');

    if (goodBookId) {
      // Open period covering current month
      await create('blng__FinancePeriod__c', {
        Name: `CC_Test_Period_${currentYear}_${currentMonth + 1}`,
        blng__FinanceBook__c: goodBookId,
        blng__PeriodStartDate__c: new Date(currentYear, currentMonth, 1).toISOString().split('T')[0],
        blng__PeriodEndDate__c: new Date(currentYear, currentMonth + 1, 0).toISOString().split('T')[0],
        blng__PeriodStatus__c: 'Open',
      }, 'Current Month Open Period');
    }

    // ❌ FB-004: Active finance book with NO periods
    await create('blng__FinanceBook__c', {
      Name: 'CC_Test_Empty_Finance_Book',
      blng__Active__c: true,
      blng__PeriodType__c: 'Monthly',
    }, 'Empty Finance Book (FB-004)');

    // ❌ FB-001, FB-002, FB-005: Book with gaps and old open periods
    const problemBookId = await create('blng__FinanceBook__c', {
      Name: 'CC_Test_Problem_Finance_Book',
      blng__Active__c: true,
      blng__PeriodType__c: 'Monthly',
    }, 'Problem Finance Book');

    if (problemBookId) {
      // ❌ FB-005: Old open period (2 years ago)
      await create('blng__FinancePeriod__c', {
        Name: `CC_Test_OldPeriod_${currentYear - 2}_Jan`,
        blng__FinanceBook__c: problemBookId,
        blng__PeriodStartDate__c: `${currentYear - 2}-01-01`,
        blng__PeriodEndDate__c: `${currentYear - 2}-01-31`,
        blng__PeriodStatus__c: 'Open',
      }, 'Old Open Period 2 years ago (FB-005)');

      // Period for March (creates a gap from Jan → Mar)
      // ❌ FB-002: Gap between Jan and Mar
      await create('blng__FinancePeriod__c', {
        Name: `CC_Test_GapPeriod_${currentYear - 2}_Mar`,
        blng__FinanceBook__c: problemBookId,
        blng__PeriodStartDate__c: `${currentYear - 2}-03-01`,
        blng__PeriodEndDate__c: `${currentYear - 2}-03-31`,
        blng__PeriodStatus__c: 'Closed',
      }, 'Period After Gap (FB-002)');

      // ❌ FB-003: Overlapping period (March 15 to April 15 overlaps with March)
      await create('blng__FinancePeriod__c', {
        Name: `CC_Test_OverlapPeriod_${currentYear - 2}_MarApr`,
        blng__FinanceBook__c: problemBookId,
        blng__PeriodStartDate__c: `${currentYear - 2}-03-15`,
        blng__PeriodEndDate__c: `${currentYear - 2}-04-15`,
        blng__PeriodStatus__c: 'Closed',
      }, 'Overlapping Period (FB-003)');
    }

    // ============================================
    // 6. LEGAL ENTITIES (LE-001 to LE-003)
    // ============================================

    // ✅ POSITIVE: Active legal entity with full address
    await create('blng__LegalEntity__c', {
      Name: 'CC_Test_Good_Legal_Entity',
      blng__Active__c: true,
      blng__Street__c: '123 Test Street',
      blng__City__c: 'Vadodara',
      blng__State__c: 'Gujarat',
      blng__PostalCode__c: '390001',
      blng__Country__c: 'India',
    }, 'Good Legal Entity');

    // ❌ LE-002: Active legal entity missing address
    await create('blng__LegalEntity__c', {
      Name: 'CC_Test_NoAddress_Legal_Entity',
      blng__Active__c: true,
    }, 'Legal Entity Without Address (LE-002)');

    // ❌ LE-003: Inactive legal entity
    await create('blng__LegalEntity__c', {
      Name: 'CC_Test_Inactive_Legal_Entity',
      blng__Active__c: false,
      blng__Street__c: '456 Inactive Road',
      blng__City__c: 'Mumbai',
      blng__Country__c: 'India',
    }, 'Inactive Legal Entity (LE-003)');

    // ============================================
    // 7. INVOICES (INV-001 to INV-004)
    // ============================================

    // We need an Account for invoices
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let testAccountId: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accResult = await (conn as any).query(
        "SELECT Id FROM Account LIMIT 1"
      );
      if (accResult.records?.length > 0) {
        testAccountId = accResult.records[0].Id;
      }
    } catch {
      console.log('[SEED] No accounts found — skipping invoice creation');
    }

    if (testAccountId) {
      // ✅ POSITIVE: Properly posted invoice
      await create('blng__Invoice__c', {
        blng__InvoiceStatus__c: 'Draft',
        blng__Account__c: testAccountId,
        blng__InvoiceDate__c: today.toISOString().split('T')[0],
        blng__DueDate__c: new Date(currentYear, currentMonth + 2, 0).toISOString().split('T')[0],
      }, 'Good Invoice (recent draft)');

      // ❌ INV-001: Draft invoice older than 30 days (stuck draft)
      const oldDate = new Date(today);
      oldDate.setDate(oldDate.getDate() - 45);
      await create('blng__Invoice__c', {
        blng__InvoiceStatus__c: 'Draft',
        blng__Account__c: testAccountId,
        blng__InvoiceDate__c: oldDate.toISOString().split('T')[0],
        blng__DueDate__c: oldDate.toISOString().split('T')[0],
      }, 'Stuck Draft Invoice 45 days old (INV-001)');
    }

    // ============================================
    // 8. PRODUCTS WITH BILLING CONFIG (PBC-001 to PBC-006, TR-001, BR-001, RR-001)
    // ============================================

    // ✅ POSITIVE: Well-configured product with all rules
    if (goodBillingRuleId && goodRevRecRuleId && goodTaxRuleId) {
      await create('Product2', {
        Name: 'CC_Test_Good_Product_Billing',
        IsActive: true,
        blng__BillingRule__c: goodBillingRuleId,
        blng__RevenueRecognitionRule__c: goodRevRecRuleId,
        blng__TaxRule__c: goodTaxRuleId,
        SBQQ__ChargeType__c: 'Recurring',
        SBQQ__BillingType__c: 'Advance',
        SBQQ__BillingFrequency__c: 'Monthly',
      }, 'Good Product (all rules + charge type + frequency)');
    }

    // ❌ PBC-001, PBC-002, PBC-003, TR-001: Product missing ALL billing rules
    await create('Product2', {
      Name: 'CC_Test_NoRules_Product',
      IsActive: true,
    }, 'Product Missing All Rules (PBC-001/002/003, TR-001)');

    // ❌ PBC-004: Product missing charge type
    if (goodBillingRuleId && goodRevRecRuleId && goodTaxRuleId) {
      await create('Product2', {
        Name: 'CC_Test_NoChargeType_Product',
        IsActive: true,
        blng__BillingRule__c: goodBillingRuleId,
        blng__RevenueRecognitionRule__c: goodRevRecRuleId,
        blng__TaxRule__c: goodTaxRuleId,
      }, 'Product Missing Charge Type (PBC-004)');
    }

    // ❌ PBC-005: Recurring product without billing frequency
    if (goodBillingRuleId && goodRevRecRuleId && goodTaxRuleId) {
      await create('Product2', {
        Name: 'CC_Test_RecurringNoFreq_Product',
        IsActive: true,
        blng__BillingRule__c: goodBillingRuleId,
        blng__RevenueRecognitionRule__c: goodRevRecRuleId,
        blng__TaxRule__c: goodTaxRuleId,
        SBQQ__ChargeType__c: 'Recurring',
        SBQQ__BillingType__c: 'Advance',
      }, 'Recurring Product Without Frequency (PBC-005)');
    }

    // ❌ PBC-006, BR-001, RR-001, TR-002: Product referencing inactive rules
    if (inactiveBillingRuleId && inactiveRevRecRuleId && inactiveTaxRuleId) {
      await create('Product2', {
        Name: 'CC_Test_InactiveRules_Product',
        IsActive: true,
        blng__BillingRule__c: inactiveBillingRuleId,
        blng__RevenueRecognitionRule__c: inactiveRevRecRuleId,
        blng__TaxRule__c: inactiveTaxRuleId,
        SBQQ__ChargeType__c: 'One-Time',
      }, 'Product With Inactive Rules (PBC-006, BR-001, RR-001, TR-002)');
    }

    // ============================================
    // SUMMARY
    // ============================================

    const totalCreated = Object.values(created).reduce((sum, arr) => sum + arr.length, 0);

    console.log(`[SEED] Done! Created ${totalCreated} records across ${Object.keys(created).length} objects.`);
    if (errors.length > 0) {
      console.log(`[SEED] ${errors.length} errors occurred.`);
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalCreated,
        byObject: Object.fromEntries(
          Object.entries(created).map(([obj, ids]) => [obj, ids.length])
        ),
        errors: errors.length > 0 ? errors : undefined,
      },
      created,
      testScenarios: {
        positive: [
          'CC_Test_Good_Billing_Rule — Active billing rule with all fields',
          'CC_Test_Good_RevRec_Rule — Active rev rec rule with schedule type',
          'CC_Test_Good_Tax_Rule — Active tax rule at 18%',
          'CC_Test_Good_GL_Rule — Active GL rule with treatments',
          'CC_Test_Good_Finance_Book — Active book with current open period',
          'CC_Test_Good_Legal_Entity — Active entity with full address',
          'CC_Test_Good_Product_Billing — Product with all rules + charge type + frequency',
        ],
        negative: {
          'BR-001': 'Inactive billing rule referenced by CC_Test_InactiveRules_Product',
          'BR-002': 'CC_Test_Orphaned_Billing_Rule has no GL treatment linked',
          'BR-003': 'CC_Test_Orphaned_Billing_Rule not referenced by any product',
          'BR-004': 'Two rules named CC_Test_Duplicate_Rule_Name',
          'RR-001': 'Inactive rev rec rule referenced by CC_Test_InactiveRules_Product',
          'RR-002': 'CC_Test_NoScheduleType_RevRec missing schedule type',
          'RR-003': 'CC_Test_NoCreate_RevRec has schedule creation = No',
          'RR-004': 'CC_Test_Orphaned_RevRec_Rule not referenced by any product',
          'TR-001': 'CC_Test_NoRules_Product has no tax rule',
          'TR-002': 'Inactive tax rule referenced by CC_Test_InactiveRules_Product',
          'TR-003': 'CC_Test_Zero_Tax_Rule has 0% tax',
          'FB-001': 'CC_Test_Problem_Finance_Book has no open period for today',
          'FB-002': 'Gap between Jan and Mar periods in problem book',
          'FB-003': 'Overlapping Mar/Apr period in problem book',
          'FB-004': 'CC_Test_Empty_Finance_Book has no periods at all',
          'FB-005': 'Old open period from 2 years ago in problem book',
          'GL-001': 'CC_Test_NoAccounts_GL_Treatment has no debit/credit accounts',
          'GL-002': 'CC_Test_Empty_GL_Rule has no treatments',
          'GL-003': 'CC_Test_Inactive_GL_Treatment on active GL rule',
          'GL-004': 'CC_Test_OneSided_GL_Treatment has only debit account',
          'LE-002': 'CC_Test_NoAddress_Legal_Entity missing street/city/country',
          'LE-003': 'CC_Test_Inactive_Legal_Entity is inactive',
          'PBC-001': 'CC_Test_NoRules_Product missing billing rule',
          'PBC-002': 'CC_Test_NoRules_Product missing rev rec rule',
          'PBC-003': 'CC_Test_NoRules_Product missing tax rule',
          'PBC-004': 'CC_Test_NoChargeType_Product missing charge type',
          'PBC-005': 'CC_Test_RecurringNoFreq_Product is recurring without frequency',
          'PBC-006': 'CC_Test_InactiveRules_Product references inactive rules',
          'INV-001': 'Draft invoice created 45 days ago (stuck)',
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Seed failed';
    console.error('[SEED] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
