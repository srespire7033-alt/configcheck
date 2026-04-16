import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { createRefreshableConnection } from '@/lib/salesforce/client';

/**
 * POST /api/orgs/seed-cpq-test-data
 *
 * Seeds Salesforce org with CPQ test records to cover categories currently at 100%.
 * Targets: approval_rules, guided_selling, quote_templates, quote_calculator_plugin, subscriptions
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
          console.log(`[SEED-CPQ] ✅ Created ${label}: ${result.id}`);
          return result.id;
        } else {
          errors.push(`${label}: ${JSON.stringify(result.errors)}`);
          console.error(`[SEED-CPQ] ❌ Failed ${label}:`, result.errors);
          return null;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${label}: ${msg}`);
        console.error(`[SEED-CPQ] ❌ Error ${label}:`, msg);
        return null;
      }
    };

    // Helper: query a record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = async (soql: string): Promise<any[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (conn as any).query(soql);
        return result.records || [];
      } catch {
        return [];
      }
    };

    console.log('[SEED-CPQ] Starting CPQ test data creation...');

    // ============================================
    // 1. APPROVAL RULES (AR-001 to AR-005)
    // ============================================

    // ❌ AR-001: Active approval rule WITHOUT approver (critical)
    await create('SBQQ__ApprovalRule__c', {
      Name: 'CC_Test_NoApprover_Rule',
      SBQQ__Active__c: true,
      SBQQ__TargetObject__c: 'Quote',
      SBQQ__EvaluationOrder__c: 900,
    }, 'Approval Rule Without Approver (AR-001)');

    // ❌ AR-003: Duplicate evaluation order (warning) — two rules same order
    await create('SBQQ__ApprovalRule__c', {
      Name: 'CC_Test_DupOrder_Rule_1',
      SBQQ__Active__c: true,
      SBQQ__TargetObject__c: 'Quote',
      SBQQ__EvaluationOrder__c: 901,
    }, 'Dup Order Rule 1 (AR-003)');

    await create('SBQQ__ApprovalRule__c', {
      Name: 'CC_Test_DupOrder_Rule_2',
      SBQQ__Active__c: true,
      SBQQ__TargetObject__c: 'Quote',
      SBQQ__EvaluationOrder__c: 901,
    }, 'Dup Order Rule 2 (AR-003)');

    // ❌ AR-005: Inactive approval rule (info)
    await create('SBQQ__ApprovalRule__c', {
      Name: 'CC_Test_Inactive_Approval',
      SBQQ__Active__c: false,
      SBQQ__TargetObject__c: 'Quote',
    }, 'Inactive Approval Rule (AR-005)');

    // ============================================
    // 2. GUIDED SELLING (GS-001 to GS-004)
    // ============================================

    // ❌ GS-003: Inactive guided selling process (info)
    await create('SBQQ__GuidedSellingProcess__c', {
      Name: 'CC_Test_Inactive_GS',
      SBQQ__Active__c: false,
    }, 'Inactive Guided Selling (GS-003)');

    // ❌ GS-001/GS-002: Active process with no inputs and no outputs (critical)
    // Creating the process alone without child input/output records will trigger both
    await create('SBQQ__GuidedSellingProcess__c', {
      Name: 'CC_Test_Empty_GS_Process',
      SBQQ__Active__c: true,
    }, 'Empty Active GS Process (GS-001/GS-002)');

    // ============================================
    // 3. QUOTE TEMPLATES (QT-001 to QT-005)
    // ============================================

    // ❌ QT-005: Default template that is NOT active (critical)
    await create('SBQQ__QuoteTemplate__c', {
      Name: 'CC_Test_Draft_Default_Template',
      SBQQ__Default__c: true,
      SBQQ__Status__c: 'Draft',
    }, 'Default Template in Draft (QT-005)');

    // ❌ QT-002: Non-active template (info)
    await create('SBQQ__QuoteTemplate__c', {
      Name: 'CC_Test_Inactive_Template',
      SBQQ__Default__c: false,
      SBQQ__Status__c: 'Inactive',
    }, 'Inactive Template (QT-002)');

    // ❌ QT-003: Active template with no sections (warning)
    await create('SBQQ__QuoteTemplate__c', {
      Name: 'CC_Test_Empty_Template',
      SBQQ__Default__c: false,
      SBQQ__Status__c: 'Active',
    }, 'Empty Template No Sections (QT-003)');

    // ============================================
    // 4. QUOTE CALCULATOR PLUGIN (QCP-001 to QCP-004)
    // ============================================

    // ❌ QCP-001: Empty QCP script (critical)
    await create('SBQQ__CustomScript__c', {
      Name: 'CC_Test_Empty_QCP',
      SBQQ__QuoteFields__c: 'SBQQ__NetAmount__c',
    }, 'Empty QCP Script (QCP-001)');

    // ❌ QCP-002: QCP with code but no transpiled code (warning)
    await create('SBQQ__CustomScript__c', {
      Name: 'CC_Test_NoTranspile_QCP',
      SBQQ__Code__c: 'export function onBeforeCalculate(quote, lines, conn) { return Promise.resolve(); }',
      SBQQ__QuoteFields__c: 'SBQQ__NetAmount__c',
    }, 'QCP Without Transpiled Code (QCP-002)');

    // Creating 2 QCP scripts above already triggers QCP-004 (multiple scripts, info)

    // ============================================
    // 5. SUBSCRIPTIONS (SR-001 to SR-004)
    // ============================================

    // Need an Account for subscriptions
    const accounts = await query('SELECT Id FROM Account LIMIT 1');
    const accountId = accounts.length > 0 ? accounts[0].Id : null;

    if (accountId) {
      // Need a product for subscriptions
      const products = await query("SELECT Id FROM Product2 WHERE IsActive = true LIMIT 1");
      const productId = products.length > 0 ? products[0].Id : null;

      // ❌ SR-003: Subscription without contract (critical)
      await create('SBQQ__Subscription__c', {
        SBQQ__Account__c: accountId,
        SBQQ__Product__c: productId,
        SBQQ__Quantity__c: 1,
        SBQQ__NetPrice__c: 100,
      }, 'Subscription Without Contract (SR-003)');

      // ❌ SR-001: Zero-value subscription (warning)
      await create('SBQQ__Subscription__c', {
        SBQQ__Account__c: accountId,
        SBQQ__Product__c: productId,
        SBQQ__Quantity__c: 1,
        SBQQ__NetPrice__c: 0,
      }, 'Zero-Value Subscription (SR-001)');

      // ❌ SR-004: High quantity subscription (info)
      await create('SBQQ__Subscription__c', {
        SBQQ__Account__c: accountId,
        SBQQ__Product__c: productId,
        SBQQ__Quantity__c: 2000,
        SBQQ__NetPrice__c: 50,
      }, 'High Quantity Subscription (SR-004)');
    } else {
      errors.push('No Account found — skipped subscription creation');
    }

    // ============================================
    // SUMMARY
    // ============================================

    const totalCreated = Object.values(created).reduce((sum, arr) => sum + arr.length, 0);

    console.log(`[SEED-CPQ] Done! Created ${totalCreated} records across ${Object.keys(created).length} objects.`);
    if (errors.length > 0) {
      console.log(`[SEED-CPQ] ${errors.length} errors occurred.`);
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
        'AR-001': 'CC_Test_NoApprover_Rule — active rule without approver (critical)',
        'AR-003': 'CC_Test_DupOrder_Rule_1/2 — same evaluation order 901 (warning)',
        'AR-005': 'CC_Test_Inactive_Approval — inactive approval rule (info)',
        'GS-001/002': 'CC_Test_Empty_GS_Process — active with no inputs or outputs (critical)',
        'GS-003': 'CC_Test_Inactive_GS — inactive process (info)',
        'QT-005': 'CC_Test_Draft_Default_Template — default but Draft status (critical)',
        'QT-002': 'CC_Test_Inactive_Template — non-active template (info)',
        'QT-003': 'CC_Test_Empty_Template — no sections (warning)',
        'QCP-001': 'CC_Test_Empty_QCP — empty script (critical)',
        'QCP-002': 'CC_Test_NoTranspile_QCP — no transpiled code (warning)',
        'QCP-004': 'Two QCP scripts exist — multiple scripts (info)',
        'SR-003': 'Subscription without contract (critical)',
        'SR-001': 'Zero-value subscription (warning)',
        'SR-004': 'High quantity subscription >1000 (info)',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Seed failed';
    console.error('[SEED-CPQ] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
