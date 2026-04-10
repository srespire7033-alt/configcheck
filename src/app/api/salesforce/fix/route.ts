import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { createConnection } from '@/lib/salesforce/client';
import { Connection } from 'jsforce';

export const dynamic = 'force-dynamic';

type FixType =
  | 'deactivate_rule'
  | 'resequence_price_rules'
  | 'resequence_product_rules'
  | 'fix_tier_gaps'
  | 'deactivate_inactive_rules';

interface FixRequest {
  orgId: string;
  issueId?: string;
  fixType: FixType;
  recordIds?: string[];
}

interface FixResult {
  success: boolean;
  fixType: FixType;
  recordsAffected: number;
  details: string;
}

/**
 * POST /api/salesforce/fix
 * Apply a one-click fix to Salesforce org
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: FixRequest = await request.json();
    const { orgId, issueId, fixType, recordIds } = body;

    if (!orgId || !fixType) {
      return NextResponse.json({ error: 'orgId and fixType are required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Get org and verify ownership
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .eq('user_id', user.id)
      .single();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Create Salesforce connection
    const conn = createConnection(
      org.instance_url as string,
      org.access_token as string,
      org.refresh_token as string
    );

    // Apply the fix
    let result: FixResult;

    switch (fixType) {
      case 'deactivate_rule':
        result = await deactivateRules(conn, recordIds || []);
        break;
      case 'resequence_price_rules':
        result = await resequencePriceRules(conn);
        break;
      case 'resequence_product_rules':
        result = await resequenceProductRules(conn);
        break;
      case 'fix_tier_gaps':
        result = await fixDiscountTierGaps(conn, recordIds || []);
        break;
      case 'deactivate_inactive_rules':
        result = await deactivateStaleRules(conn);
        break;
      default:
        return NextResponse.json({ error: 'Unknown fix type' }, { status: 400 });
    }

    // If an issue was specified, mark it as resolved
    if (issueId && result.success) {
      await supabase
        .from('issues')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          notes: `Auto-fixed via One-Click Fix: ${result.details}`,
        })
        .eq('id', issueId);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Fix error:', error);
    const message = error instanceof Error ? error.message : 'Fix failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Deactivate specific price rules or product rules by ID
 */
async function deactivateRules(conn: Connection, recordIds: string[]): Promise<FixResult> {
  if (recordIds.length === 0) {
    return { success: false, fixType: 'deactivate_rule', recordsAffected: 0, details: 'No record IDs provided' };
  }

  let affected = 0;

  // Try price rules first
  for (const id of recordIds) {
    try {
      await conn.sobject('SBQQ__PriceRule__c').update({ Id: id, SBQQ__Active__c: false });
      affected++;
    } catch {
      // Try as product rule
      try {
        await conn.sobject('SBQQ__ProductRule__c').update({ Id: id, SBQQ__Active__c: false });
        affected++;
      } catch (innerErr) {
        console.error(`Failed to deactivate ${id}:`, innerErr);
      }
    }
  }

  return {
    success: affected > 0,
    fixType: 'deactivate_rule',
    recordsAffected: affected,
    details: `Deactivated ${affected} of ${recordIds.length} rule(s)`,
  };
}

/**
 * Resequence price rules: assign clean evaluation order 10, 20, 30...
 */
async function resequencePriceRules(conn: Connection): Promise<FixResult> {
  const result = await conn.query(
    "SELECT Id, Name, SBQQ__EvaluationOrder__c FROM SBQQ__PriceRule__c WHERE SBQQ__Active__c = true ORDER BY SBQQ__EvaluationOrder__c ASC NULLS LAST, Name ASC"
  );

  const rules = result.records as { Id: string; Name: string; SBQQ__EvaluationOrder__c: number | null }[];

  if (rules.length === 0) {
    return { success: true, fixType: 'resequence_price_rules', recordsAffected: 0, details: 'No active price rules to resequence' };
  }

  const updates = rules.map((rule, idx) => ({
    Id: rule.Id,
    SBQQ__EvaluationOrder__c: (idx + 1) * 10,
  }));

  await conn.sobject('SBQQ__PriceRule__c').update(updates);

  return {
    success: true,
    fixType: 'resequence_price_rules',
    recordsAffected: updates.length,
    details: `Resequenced ${updates.length} active price rules (10, 20, 30...)`,
  };
}

/**
 * Resequence product rules: assign clean evaluation order 10, 20, 30...
 */
async function resequenceProductRules(conn: Connection): Promise<FixResult> {
  const result = await conn.query(
    "SELECT Id, Name, SBQQ__EvaluationOrder__c FROM SBQQ__ProductRule__c WHERE SBQQ__Active__c = true ORDER BY SBQQ__EvaluationOrder__c ASC NULLS LAST, Name ASC"
  );

  const rules = result.records as { Id: string; Name: string; SBQQ__EvaluationOrder__c: number | null }[];

  if (rules.length === 0) {
    return { success: true, fixType: 'resequence_product_rules', recordsAffected: 0, details: 'No active product rules to resequence' };
  }

  const updates = rules.map((rule, idx) => ({
    Id: rule.Id,
    SBQQ__EvaluationOrder__c: (idx + 1) * 10,
  }));

  await conn.sobject('SBQQ__ProductRule__c').update(updates);

  return {
    success: true,
    fixType: 'resequence_product_rules',
    recordsAffected: updates.length,
    details: `Resequenced ${updates.length} active product rules (10, 20, 30...)`,
  };
}

/**
 * Fix discount tier gaps: close gaps between tier upper/lower bounds
 */
async function fixDiscountTierGaps(conn: Connection, scheduleIds: string[]): Promise<FixResult> {
  let totalFixed = 0;

  // If no specific IDs, find all schedules with gaps
  let targetIds = scheduleIds;
  if (targetIds.length === 0) {
    const schedules = await conn.query(
      "SELECT Id FROM SBQQ__DiscountSchedule__c LIMIT 100"
    );
    targetIds = (schedules.records as { Id: string }[]).map((r) => r.Id);
  }

  for (const scheduleId of targetIds) {
    const tiersResult = await conn.query(
      `SELECT Id, SBQQ__LowerBound__c, SBQQ__UpperBound__c, SBQQ__Discount__c
       FROM SBQQ__DiscountTier__c
       WHERE SBQQ__Schedule__c = '${scheduleId}'
       ORDER BY SBQQ__LowerBound__c ASC`
    );

    const tiers = tiersResult.records as {
      Id: string;
      SBQQ__LowerBound__c: number;
      SBQQ__UpperBound__c: number;
    }[];

    if (tiers.length < 2) continue;

    const updates: { Id: string; SBQQ__LowerBound__c: number }[] = [];

    for (let i = 1; i < tiers.length; i++) {
      const prevUpper = tiers[i - 1].SBQQ__UpperBound__c;
      const currLower = tiers[i].SBQQ__LowerBound__c;

      // If there's a gap (current lower > previous upper + 1)
      if (currLower > prevUpper + 1) {
        updates.push({
          Id: tiers[i].Id,
          SBQQ__LowerBound__c: prevUpper + 1,
        });
      }
    }

    if (updates.length > 0) {
      await conn.sobject('SBQQ__DiscountTier__c').update(updates);
      totalFixed += updates.length;
    }
  }

  return {
    success: true,
    fixType: 'fix_tier_gaps',
    recordsAffected: totalFixed,
    details: totalFixed > 0
      ? `Closed ${totalFixed} gap(s) across ${targetIds.length} discount schedule(s)`
      : 'No tier gaps found to fix',
  };
}

/**
 * Deactivate all inactive (stale) rules that are already marked inactive
 * This is a cleanup action — deletes rules that are inactive and cluttering
 */
async function deactivateStaleRules(conn: Connection): Promise<FixResult> {
  // Find inactive price rules
  const prResult = await conn.query(
    "SELECT Id FROM SBQQ__PriceRule__c WHERE SBQQ__Active__c = false"
  );
  const prIds = (prResult.records as { Id: string }[]).map((r) => r.Id);

  // Find inactive product rules
  const prdResult = await conn.query(
    "SELECT Id FROM SBQQ__ProductRule__c WHERE SBQQ__Active__c = false"
  );
  const prdIds = (prdResult.records as { Id: string }[]).map((r) => r.Id);

  let deleted = 0;

  // Delete inactive price rules
  if (prIds.length > 0) {
    await conn.sobject('SBQQ__PriceRule__c').destroy(prIds);
    deleted += prIds.length;
  }

  // Delete inactive product rules
  if (prdIds.length > 0) {
    await conn.sobject('SBQQ__ProductRule__c').destroy(prdIds);
    deleted += prdIds.length;
  }

  return {
    success: true,
    fixType: 'deactivate_inactive_rules',
    recordsAffected: deleted,
    details: `Removed ${deleted} inactive rule(s) (${prIds.length} price, ${prdIds.length} product)`,
  };
}
