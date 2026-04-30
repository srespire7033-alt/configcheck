import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { createRefreshableConnection } from '@/lib/salesforce/client';

/**
 * POST /api/orgs/seed-arm-test-data
 *
 * Seeds an ARM (Revenue Cloud) org with test records that exercise the
 * ARM v1-v4 health checks. Creates a deliberate mix of POSITIVE
 * (should pass) and NEGATIVE (should be flagged) cases so a follow-up
 * scan produces a comprehensive issue list.
 *
 * Records are tagged with the prefix `CC_Test_` so they're easy to
 * identify and clean up later.
 *
 * Request body: { organizationId: string }
 *
 * ⚠️  DEV/TEST ONLY — creates real records in the connected
 * Salesforce org. Only run against a sandbox or scratch org.
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
    const skipped: string[] = [];

    // Helper: create a record. If the SObject doesn't exist on the
    // org (INVALID_TYPE), record it as skipped rather than failing
    // — different ARM rollouts expose different subsets of objects.
    const create = async (
      objectName: string,
      data: Record<string, unknown>,
      label: string
    ): Promise<string | null> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (conn.sobject(objectName) as any).create(data);
        if (result.success) {
          if (!created[objectName]) created[objectName] = [];
          created[objectName].push(result.id);
          console.log(`[SEED-ARM] ✅ ${label}: ${result.id}`);
          return result.id;
        }
        errors.push(`${label}: ${JSON.stringify(result.errors)}`);
        console.error(`[SEED-ARM] ❌ ${label}:`, result.errors);
        return null;
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = err as any;
        const msg = err instanceof Error ? err.message : String(err);
        if (e?.errorCode === 'INVALID_TYPE') {
          skipped.push(`${label} (object ${objectName} not available in this org)`);
          return null;
        }
        errors.push(`${label}: ${msg}`);
        console.error(`[SEED-ARM] ❌ ${label}:`, msg);
        return null;
      }
    };

    console.log('[SEED-ARM] Starting ARM test data creation...');

    // ════════════════════════════════════════════════════════════
    // PRODUCT CATALOG  (Product2)
    // ════════════════════════════════════════════════════════════

    // ✅ POSITIVE: an active product that we'll fully wire up
    const goodProductId = await create(
      'Product2',
      {
        Name: 'CC_Test_Good_Product',
        IsActive: true,
        ProductCode: 'CC_TEST_GOOD',
      },
      'Good Product (positive)'
    );

    // ❌ ARM-001 negative: active product that will have NO selling model
    const orphanProductId = await create(
      'Product2',
      {
        Name: 'CC_Test_Orphan_Product',
        IsActive: true,
        ProductCode: 'CC_TEST_ORPHAN',
      },
      'Orphan Product (negative ARM-001/ARM-018)'
    );

    // ❌ ARM-005 negative: bundle with no components
    const emptyBundleId = await create(
      'Product2',
      {
        Name: 'CC_Test_Empty Bundle',
        IsActive: true,
        ProductCode: 'CC_TEST_EMPTY_BUNDLE',
      },
      'Empty bundle (negative ARM-005)'
    );

    // ❌ ARM-014/ARM-015 setup: an inactive child product
    const inactiveChildId = await create(
      'Product2',
      {
        Name: 'CC_Test_Inactive_Child',
        IsActive: false,
        ProductCode: 'CC_TEST_INACTIVE',
      },
      'Inactive child (negative ARM-014)'
    );

    // ════════════════════════════════════════════════════════════
    // SELLING MODELS  (ProductSellingModel + ProductSellingModelOption)
    // ════════════════════════════════════════════════════════════

    // ✅ POSITIVE: TermDefined model with everything filled in
    const goodModelId = await create(
      'ProductSellingModel',
      {
        Name: 'CC_Test_Good_Annual_Model',
        IsActive: true,
        SellingModelType: 'TermDefined',
        PricingTerm: 12,
        PricingTermUnit: 'Months',
      },
      'Good selling model (positive)'
    );

    // ❌ ARM-002/ARM-011 negative: TermDefined with no PricingTerm and no SellingFrequencyId
    const badModelId = await create(
      'ProductSellingModel',
      {
        Name: 'CC_Test_Bad_Term_Model',
        IsActive: true,
        SellingModelType: 'TermDefined',
      },
      'Bad term model (negative ARM-002 / ARM-011)'
    );

    // ❌ ARM-012 setup: inactive model that will have an active option
    const inactiveModelId = await create(
      'ProductSellingModel',
      {
        Name: 'CC_Test_Inactive_Model',
        IsActive: false,
        SellingModelType: 'TermDefined',
        PricingTerm: 12,
      },
      'Inactive model (negative ARM-012)'
    );

    // ✅ POSITIVE: link good product to good model
    if (goodProductId && goodModelId) {
      await create(
        'ProductSellingModelOption',
        {
          Product2Id: goodProductId,
          ProductSellingModelId: goodModelId,
          IsActive: true,
        },
        'Good product → good model link (positive)'
      );
    }

    // ❌ ARM-012 negative: active option pointing at inactive model
    if (goodProductId && inactiveModelId) {
      await create(
        'ProductSellingModelOption',
        {
          Product2Id: goodProductId,
          ProductSellingModelId: inactiveModelId,
          IsActive: true,
        },
        'Active option on inactive model (negative ARM-012)'
      );
    }

    // ❌ ARM-019 negative: duplicate options for same Product+Model
    if (goodProductId && goodModelId) {
      await create(
        'ProductSellingModelOption',
        {
          Product2Id: goodProductId,
          ProductSellingModelId: goodModelId,
          IsActive: true,
        },
        'Duplicate option (negative ARM-019)'
      );
    }

    // ════════════════════════════════════════════════════════════
    // BUNDLES  (ProductRelatedComponent)
    // ════════════════════════════════════════════════════════════

    // ❌ ARM-013 negative: component with reversed quantities
    if (goodProductId && orphanProductId) {
      await create(
        'ProductRelatedComponent',
        {
          ParentProductId: goodProductId,
          ChildProductId: orphanProductId,
          MinQuantity: 5,
          MaxQuantity: 2,
        },
        'Reversed quantities (negative ARM-013)'
      );
    }

    // ❌ ARM-014 negative: component pointing at inactive child
    if (goodProductId && inactiveChildId) {
      await create(
        'ProductRelatedComponent',
        {
          ParentProductId: goodProductId,
          ChildProductId: inactiveChildId,
          MinQuantity: 1,
          MaxQuantity: 1,
        },
        'Inactive-child component (negative ARM-014)'
      );
    }

    // ════════════════════════════════════════════════════════════
    // PRICE ADJUSTMENTS
    // ════════════════════════════════════════════════════════════

    // ✅ POSITIVE: schedule with valid contiguous tiers
    const goodScheduleId = await create(
      'PriceAdjustmentSchedule',
      {
        Name: 'CC_Test_Good_Volume_Discount',
        IsActive: true,
        AdjustmentMethod: 'Slab',
        AdjustmentType: 'Percent',
      },
      'Good price schedule (positive)'
    );

    if (goodScheduleId) {
      await create(
        'PriceAdjustmentTier',
        {
          PriceAdjustmentScheduleId: goodScheduleId,
          LowerBound: 0,
          UpperBound: 100,
          AdjustmentValue: 5,
        },
        'Good tier 1'
      );
      await create(
        'PriceAdjustmentTier',
        {
          PriceAdjustmentScheduleId: goodScheduleId,
          LowerBound: 100,
          UpperBound: 500,
          AdjustmentValue: 10,
        },
        'Good tier 2'
      );
    }

    // ❌ ARM-016 negative: active schedule with NO tiers
    await create(
      'PriceAdjustmentSchedule',
      {
        Name: 'CC_Test_Empty_Schedule',
        IsActive: true,
      },
      'Empty schedule (negative ARM-016)'
    );

    // ❌ ARM-003 negative: schedule with overlapping tiers
    const overlapScheduleId = await create(
      'PriceAdjustmentSchedule',
      {
        Name: 'CC_Test_Overlap_Schedule',
        IsActive: true,
      },
      'Overlap schedule (negative ARM-003)'
    );
    if (overlapScheduleId) {
      await create(
        'PriceAdjustmentTier',
        {
          PriceAdjustmentScheduleId: overlapScheduleId,
          LowerBound: 0,
          UpperBound: 100,
          AdjustmentValue: 5,
        },
        'Overlap tier 1'
      );
      await create(
        'PriceAdjustmentTier',
        {
          PriceAdjustmentScheduleId: overlapScheduleId,
          LowerBound: 50,
          UpperBound: 200,
          AdjustmentValue: 10,
        },
        'Overlap tier 2 (overlaps tier 1)'
      );
      // ❌ ARM-017 negative: tier with reversed bounds
      await create(
        'PriceAdjustmentTier',
        {
          PriceAdjustmentScheduleId: overlapScheduleId,
          LowerBound: 500,
          UpperBound: 200,
          AdjustmentValue: 15,
        },
        'Reversed-bounds tier (negative ARM-017)'
      );
    }

    // ════════════════════════════════════════════════════════════
    // ATTRIBUTE-BASED ADJUSTMENTS
    // ════════════════════════════════════════════════════════════

    // ❌ ARM-004 negative: undated active rule
    await create(
      'AttributeBasedAdjRule',
      {
        Name: 'CC_Test_Undated_Promo',
        IsActive: true,
      },
      'Undated promo (negative ARM-004)'
    );

    // ❌ ARM-020 negative: expired but still active
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 30);
    await create(
      'AttributeBasedAdjRule',
      {
        Name: 'CC_Test_Expired_Promo',
        IsActive: true,
        EffectiveStartDate: '2025-01-01',
        EffectiveEndDate: yesterday.toISOString().slice(0, 10),
      },
      'Expired-but-active promo (negative ARM-020)'
    );

    // ════════════════════════════════════════════════════════════
    // RATE CARDS
    // ════════════════════════════════════════════════════════════

    // ❌ ARM-021 negative: active rate card with no entries
    await create(
      'RateCard',
      {
        Name: 'CC_Test_Empty_RateCard',
        IsActive: true,
      },
      'Empty rate card (negative ARM-021)'
    );

    // ✅ POSITIVE rate card with proper entry
    const goodRateCardId = await create(
      'RateCard',
      {
        Name: 'CC_Test_Good_RateCard',
        IsActive: true,
      },
      'Good rate card (positive)'
    );
    if (goodRateCardId && goodProductId) {
      await create(
        'RateCardEntry',
        {
          RateCardId: goodRateCardId,
          Product2Id: goodProductId,
          Price: 0.05,
        },
        'Good rate card entry (positive)'
      );
      // ❌ ARM-022 negative: entry with null price
      await create(
        'RateCardEntry',
        {
          RateCardId: goodRateCardId,
          Product2Id: orphanProductId || goodProductId,
        },
        'Zero-price entry (negative ARM-022)'
      );
    }

    // ════════════════════════════════════════════════════════════
    // ATTRIBUTES
    // ════════════════════════════════════════════════════════════

    // ❌ ARM-024 negative: picklist attribute with no values
    await create(
      'AttributeDefinition',
      {
        Name: 'CC_Test_Empty_Picklist',
        Code: 'CC_TEST_EMPTY_PL',
        DataType: 'Picklist',
        IsActive: true,
      },
      'Empty picklist attribute (negative ARM-024)'
    );

    // ❌ ARM-025 negative: required attribute with no default
    await create(
      'AttributeDefinition',
      {
        Name: 'CC_Test_Required_NoDefault',
        Code: 'CC_TEST_REQ_NODEF',
        DataType: 'Text',
        IsActive: true,
        IsRequired: true,
      },
      'Required attr no default (negative ARM-025)'
    );

    // ════════════════════════════════════════════════════════════
    // CONTRACTS  (best-effort — contracts need an Account)
    // ════════════════════════════════════════════════════════════

    // ❌ ARM-039 negative: contract with reversed dates
    // We need an Account to create a Contract. Look one up first.
    let firstAccountId: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await conn.query("SELECT Id FROM Account LIMIT 1");
      firstAccountId = r.records?.[0]?.Id ?? null;
    } catch {
      // ignore
    }
    if (firstAccountId) {
      await create(
        'Contract',
        {
          AccountId: firstAccountId,
          Status: 'Draft',
          StartDate: '2026-12-01',
          ContractTerm: 0, // pair with reversed end date
          // EndDate is system-derived in some orgs; we set Status to draft to allow the create
        },
        'Contract reversed dates (best-effort negative ARM-039)'
      );
    } else {
      skipped.push('Contract — no Account in org to anchor it to');
    }

    // ════════════════════════════════════════════════════════════
    // COST BOOKS
    // ════════════════════════════════════════════════════════════

    // ❌ ARM-049 negative: active cost book with no entries
    await create(
      'CostBook',
      {
        Name: 'CC_Test_Empty_CostBook',
        IsActive: true,
        IsStandard: false,
      },
      'Empty cost book (negative ARM-049)'
    );

    console.log('[SEED-ARM] Done.');

    return NextResponse.json({
      success: errors.length === 0,
      summary: {
        objectsTouched: Object.keys(created).length,
        recordsCreated: Object.values(created).reduce((acc, ids) => acc + ids.length, 0),
        errors: errors.length,
        skipped: skipped.length,
      },
      created,
      errors,
      skipped,
      next_steps: 'Trigger a fresh ARM scan from the dashboard (Run Scan) to see the seeded checks fire.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SEED-ARM] Fatal:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
