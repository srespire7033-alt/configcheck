import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { createConnection } from '@/lib/salesforce/client';
import { fetchAllCPQData } from '@/lib/salesforce/queries';
import type { CPQData } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface ConfigItem {
  id: string;
  name: string;
  type: string;
  active?: boolean;
  details?: string;
}

interface OrgConfig {
  priceRules: ConfigItem[];
  productRules: ConfigItem[];
  discountSchedules: ConfigItem[];
  products: ConfigItem[];
  approvalRules: ConfigItem[];
  customScripts: ConfigItem[];
  quoteTemplates: ConfigItem[];
  summaryVariables: ConfigItem[];
  guidedSellingProcesses: ConfigItem[];
}

interface DiffItem {
  name: string;
  type: string;
  inOrgA: boolean;
  inOrgB: boolean;
  activeInA?: boolean;
  activeInB?: boolean;
  detailsA?: string;
  detailsB?: string;
}

/**
 * POST /api/scans/compare-orgs
 * Compare configurations between two Salesforce orgs (e.g., Sandbox vs Production)
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { orgAId, orgBId } = await request.json();

    if (!orgAId || !orgBId) {
      return NextResponse.json({ error: 'orgAId and orgBId are required' }, { status: 400 });
    }

    if (orgAId === orgBId) {
      return NextResponse.json({ error: 'Cannot compare an org with itself' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Fetch both orgs and verify ownership
    const [orgAResult, orgBResult] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', orgAId).eq('user_id', user.id).single(),
      supabase.from('organizations').select('*').eq('id', orgBId).eq('user_id', user.id).single(),
    ]);

    if (orgAResult.error || !orgAResult.data || orgBResult.error || !orgBResult.data) {
      return NextResponse.json({ error: 'One or both organizations not found' }, { status: 404 });
    }

    const orgA = orgAResult.data;
    const orgB = orgBResult.data;

    // Fetch CPQ data from both orgs in parallel
    const connA = createConnection(orgA.instance_url, orgA.access_token, orgA.refresh_token);
    const connB = createConnection(orgB.instance_url, orgB.access_token, orgB.refresh_token);

    const [dataA, dataB] = await Promise.all([
      fetchAllCPQData(connA),
      fetchAllCPQData(connB),
    ]);

    // Extract config items from each org
    const configA = extractConfig(dataA);
    const configB = extractConfig(dataB);

    // Compare each config type
    const diff = {
      priceRules: diffConfigItems(configA.priceRules, configB.priceRules),
      productRules: diffConfigItems(configA.productRules, configB.productRules),
      discountSchedules: diffConfigItems(configA.discountSchedules, configB.discountSchedules),
      products: diffConfigItems(configA.products, configB.products),
      approvalRules: diffConfigItems(configA.approvalRules, configB.approvalRules),
      customScripts: diffConfigItems(configA.customScripts, configB.customScripts),
      quoteTemplates: diffConfigItems(configA.quoteTemplates, configB.quoteTemplates),
      summaryVariables: diffConfigItems(configA.summaryVariables, configB.summaryVariables),
      guidedSellingProcesses: diffConfigItems(configA.guidedSellingProcesses, configB.guidedSellingProcesses),
    };

    // Calculate summary counts
    const allDiffs = Object.values(diff).flat();
    const onlyInA = allDiffs.filter((d) => d.inOrgA && !d.inOrgB);
    const onlyInB = allDiffs.filter((d) => !d.inOrgA && d.inOrgB);
    const inBoth = allDiffs.filter((d) => d.inOrgA && d.inOrgB);
    const activeDifferences = inBoth.filter((d) => d.activeInA !== d.activeInB);

    return NextResponse.json({
      orgA: { id: orgA.id, name: orgA.name, isSandbox: orgA.is_sandbox },
      orgB: { id: orgB.id, name: orgB.name, isSandbox: orgB.is_sandbox },
      diff,
      summary: {
        totalCompared: allDiffs.length,
        onlyInOrgA: onlyInA.length,
        onlyInOrgB: onlyInB.length,
        inBoth: inBoth.length,
        activeDifferences: activeDifferences.length,
      },
      counts: {
        orgA: {
          priceRules: configA.priceRules.length,
          productRules: configA.productRules.length,
          discountSchedules: configA.discountSchedules.length,
          products: configA.products.length,
          approvalRules: configA.approvalRules.length,
          customScripts: configA.customScripts.length,
        },
        orgB: {
          priceRules: configB.priceRules.length,
          productRules: configB.productRules.length,
          discountSchedules: configB.discountSchedules.length,
          products: configB.products.length,
          approvalRules: configB.approvalRules.length,
          customScripts: configB.customScripts.length,
        },
      },
    });
  } catch (error) {
    console.error('Org comparison error:', error);
    const message = error instanceof Error ? error.message : 'Comparison failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function extractConfig(data: CPQData): OrgConfig {
  return {
    priceRules: data.priceRules.map((r) => ({
      id: r.Id, name: r.Name, type: 'SBQQ__PriceRule__c', active: r.SBQQ__Active__c,
      details: `Order: ${r.SBQQ__EvaluationOrder__c || 'N/A'}, Target: ${r.SBQQ__TargetObject__c || 'N/A'}`,
    })),
    productRules: data.productRules.map((r) => ({
      id: r.Id, name: r.Name, type: 'SBQQ__ProductRule__c', active: r.SBQQ__Active__c,
      details: `Type: ${r.SBQQ__Type__c || 'N/A'}, Order: ${r.SBQQ__EvaluationOrder__c || 'N/A'}`,
    })),
    discountSchedules: data.discountSchedules.map((r) => ({
      id: r.Id, name: r.Name, type: 'SBQQ__DiscountSchedule__c',
      details: `Type: ${r.SBQQ__Type__c || 'N/A'}, Unit: ${r.SBQQ__DiscountUnit__c || 'N/A'}`,
    })),
    products: data.products.map((r) => ({
      id: r.Id, name: r.Name, type: 'Product2', active: r.IsActive,
      details: `Code: ${r.ProductCode || 'N/A'}`,
    })),
    approvalRules: data.approvalRules.map((r) => ({
      id: r.Id, name: r.Name, type: 'SBQQ__ApprovalRule__c', active: r.SBQQ__Active__c,
      details: `Step: ${r.SBQQ__ApprovalStep__c || 'N/A'}`,
    })),
    customScripts: data.customScripts.map((r) => ({
      id: r.Id, name: r.Name, type: 'SBQQ__CustomScript__c',
      details: `Type: ${r.SBQQ__Type__c || 'N/A'}`,
    })),
    quoteTemplates: data.quoteTemplates.map((r) => ({
      id: r.Id, name: r.Name, type: 'SBQQ__QuoteTemplate__c',
      details: `Default: ${r.SBQQ__Default__c ? 'Yes' : 'No'}`,
    })),
    summaryVariables: data.summaryVariables.map((r) => ({
      id: r.Id, name: r.Name, type: 'SBQQ__SummaryVariable__c', active: r.SBQQ__Active__c,
      details: `Function: ${r.SBQQ__AggregateFunction__c || 'N/A'}`,
    })),
    guidedSellingProcesses: data.guidedSellingProcesses.map((r) => ({
      id: r.Id, name: r.Name, type: 'SBQQ__GuidedSellingProcess__c', active: r.SBQQ__Active__c,
    })),
  };
}

function diffConfigItems(itemsA: ConfigItem[], itemsB: ConfigItem[]): DiffItem[] {
  const mapA = new Map(itemsA.map((i) => [i.name, i]));
  const mapB = new Map(itemsB.map((i) => [i.name, i]));
  const allNames = new Set([...Array.from(mapA.keys()), ...Array.from(mapB.keys())]);

  const results: DiffItem[] = [];

  for (const name of Array.from(allNames.values())) {
    const a = mapA.get(name);
    const b = mapB.get(name);

    // Only include items that differ in some way
    const inA = !!a;
    const inB = !!b;
    const activeMatch = a?.active === b?.active;

    if (!inA || !inB || !activeMatch) {
      results.push({
        name,
        type: a?.type || b?.type || '',
        inOrgA: inA,
        inOrgB: inB,
        activeInA: a?.active,
        activeInB: b?.active,
        detailsA: a?.details,
        detailsB: b?.details,
      });
    }
  }

  return results;
}
