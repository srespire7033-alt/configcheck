import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/scans/portfolio-compare
 *
 * Multi-org configuration comparison + greenfield migration recommendations.
 *
 * Use case (from the TechTorch demo call): a consulting firm engages with
 * a client that has N Salesforce orgs (typically from M&A acquisitions)
 * and needs to consolidate them — either by cleaning up the strongest
 * survivor (brownfield) or by spinning up a new clean org and selectively
 * carrying forward the best parts of each source org (greenfield).
 *
 * This endpoint powers both flows. Given an array of orgIds, it:
 *
 *   1. Reads the latest completed scan from each org and pulls
 *      `metadata.data_fetched` (entity counts per object type) plus the
 *      category-level issue distribution.
 *   2. Builds a side-by-side comparison matrix per entity category.
 *   3. For each category, identifies the "cleanest source" org — the org
 *      with the highest "health ratio" (1 - critical_count_in_category /
 *      entity_count). That's the greenfield migration recommendation:
 *      pull this category from THIS org when you build the target.
 *   4. Returns a migration manifest the consultant can hand to delivery.
 *
 * Why we read from the cached scan rather than hitting Salesforce live:
 *   - Scan data is fresh enough for assessment purposes (latest scan is
 *     usually within 24h for active customers).
 *   - Salesforce-side rate limits don't get burned for what's essentially
 *     a read on data we already have.
 *   - Works even when an org is temporarily disconnected — the consultant
 *     can still see historical state.
 */

interface OrgRow {
  id: string;
  name: string;
  is_sandbox: boolean | null;
  connection_status: string | null;
}

interface ScanRow {
  organization_id: string;
  overall_score: number | null;
  total_issues: number | null;
  critical_count: number | null;
  warning_count: number | null;
  info_count: number | null;
  category_scores: Record<string, number> | null;
  metadata: { data_fetched?: Record<string, number> } | null;
  completed_at: string | null;
}

interface CategoryComparison {
  category: string;
  label: string;
  perOrg: Array<{
    org_id: string;
    org_name: string;
    record_count: number;
    critical_issues: number;
    warning_issues: number;
    health_ratio: number; // 0-1 — higher = cleaner per record
  }>;
  greenfieldRecommendation: {
    source_org_id: string;
    source_org_name: string;
    reason: string;
  } | null;
}

// Map data_fetched JSON keys → display label. Same set the existing
// compare-orgs route uses, extended with ARM/RLM entities so the matrix
// is meaningful across all three product types.
const ENTITY_GROUPS: Array<{ category: string; label: string; fetchedKeys: string[]; issueCategories: string[] }> = [
  {
    category: 'products',
    label: 'Products & Catalog',
    fetchedKeys: ['products', 'productOptions', 'productCategories', 'productCategoryProducts'],
    issueCategories: ['products', 'arm_product_catalog'],
  },
  {
    category: 'pricing',
    label: 'Pricing (Rules + Books)',
    fetchedKeys: ['priceRules', 'priceBooks', 'pricebookEntries', 'rateCards', 'rateCardEntries'],
    issueCategories: ['price_rules', 'arm_price_books', 'arm_price_adjustments', 'arm_rate_cards'],
  },
  {
    category: 'bundles',
    label: 'Bundles',
    fetchedKeys: ['productRelatedComponents'],
    issueCategories: ['bundles', 'arm_bundles'],
  },
  {
    category: 'sellingmodels',
    label: 'Selling Models (ARM)',
    fetchedKeys: ['sellingModels', 'sellingModelOptions'],
    issueCategories: ['arm_selling_models'],
  },
  {
    category: 'discounts',
    label: 'Discounts',
    fetchedKeys: ['discountSchedules', 'priceAdjustmentSchedules', 'priceAdjustmentTiers'],
    issueCategories: ['discount_schedules', 'arm_price_adjustments'],
  },
  {
    category: 'approvals',
    label: 'Approvals',
    fetchedKeys: ['approvalRules'],
    issueCategories: ['approval_rules'],
  },
  {
    category: 'quoting',
    label: 'Quoting (Quote Lines, Templates, QCP)',
    fetchedKeys: ['quoteLines', 'quoteTemplates', 'customScripts'],
    issueCategories: ['quote_lines', 'quote_templates', 'quote_calculator_plugin'],
  },
  {
    category: 'billing',
    label: 'Billing Rules',
    fetchedKeys: ['billingRules', 'billingArrangements'],
    issueCategories: ['billing_rules', 'arm_billing_policies'],
  },
  {
    category: 'taxgl',
    label: 'Tax & GL',
    fetchedKeys: ['taxRules', 'glRules', 'taxTreatments', 'taxPolicies', 'generalLedgerAccounts'],
    issueCategories: ['tax_rules', 'gl_rules', 'arm_general_ledger', 'arm_tax'],
  },
  {
    category: 'attributes',
    label: 'Attributes (ARM)',
    fetchedKeys: ['attributeDefinitions', 'attributeCategories', 'attributePicklistValues'],
    issueCategories: ['arm_attributes', 'arm_attribute_pricing'],
  },
  {
    category: 'contracts',
    label: 'Contracts & Assets',
    fetchedKeys: ['contracts', 'contractItemPrices', 'assets'],
    issueCategories: ['contracted_prices', 'arm_contracts', 'arm_assets'],
  },
];

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { organizationIds } = await request.json();
    if (!Array.isArray(organizationIds) || organizationIds.length < 2) {
      return NextResponse.json(
        { error: 'Provide at least 2 organizationIds to compare' },
        { status: 400 }
      );
    }
    if (organizationIds.length > 20) {
      return NextResponse.json(
        { error: 'Maximum 20 orgs per portfolio comparison' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Fetch orgs (ownership-scoped) + latest completed scan per org in parallel.
    const { data: orgs, error: orgsErr } = await supabase
      .from('organizations')
      .select('id, name, is_sandbox, connection_status')
      .in('id', organizationIds)
      .eq('user_id', user.id);

    if (orgsErr || !orgs || orgs.length === 0) {
      return NextResponse.json({ error: 'No accessible organizations found' }, { status: 404 });
    }
    if (orgs.length !== organizationIds.length) {
      return NextResponse.json(
        { error: `Found ${orgs.length} of ${organizationIds.length} requested orgs — check ownership.` },
        { status: 403 }
      );
    }

    // Latest completed scan per org. DISTINCT ON (Postgres) picks the most
    // recent scan per organization_id when ordered by created_at desc.
    const { data: scans } = await supabase
      .from('scans')
      .select(
        'organization_id, overall_score, total_issues, critical_count, warning_count, info_count, category_scores, metadata, completed_at, created_at'
      )
      .eq('status', 'completed')
      .in('organization_id', organizationIds)
      .order('created_at', { ascending: false });

    const latestByOrg = new Map<string, ScanRow>();
    for (const s of (scans ?? []) as ScanRow[]) {
      if (!latestByOrg.has(s.organization_id)) latestByOrg.set(s.organization_id, s);
    }

    // Per-org issue distribution by category — needed for greenfield scoring
    // (we want critical issues PER category, not just total critical).
    const scanIds = Array.from(latestByOrg.values()).map((s) => {
      // We didn't pull scan.id above; resolve from the array. The select
      // returns the parent row; we need scan IDs to query issues.
      return s;
    });
    void scanIds; // we use organization_id instead
    const { data: issues } = await supabase
      .from('issues')
      .select('organization_id, scan_id, category, severity')
      .in('organization_id', organizationIds);

    // Build per-org-per-category issue counts. We restrict to issues
    // belonging to each org's LATEST scan to avoid counting historical
    // findings that the user may have already fixed.
    const latestScanByOrgId = new Map<string, string>();
    for (const s of (scans ?? []) as unknown as Array<{ organization_id: string; id?: string }>) {
      if (!latestScanByOrgId.has(s.organization_id) && s.id) {
        latestScanByOrgId.set(s.organization_id, s.id);
      }
    }
    // The select didn't include id; re-query scan IDs.
    const { data: scanIdRows } = await supabase
      .from('scans')
      .select('id, organization_id, created_at')
      .eq('status', 'completed')
      .in('organization_id', organizationIds)
      .order('created_at', { ascending: false });
    const latestScanIds = new Map<string, string>();
    for (const row of (scanIdRows ?? []) as Array<{ id: string; organization_id: string }>) {
      if (!latestScanIds.has(row.organization_id)) latestScanIds.set(row.organization_id, row.id);
    }

    interface CatBucket {
      [orgId: string]: { [cat: string]: { critical: number; warning: number; info: number } };
    }
    const issueBucket: CatBucket = {};
    for (const i of (issues ?? []) as Array<{
      organization_id: string;
      scan_id: string;
      category: string;
      severity: string;
    }>) {
      const expectedScanId = latestScanIds.get(i.organization_id);
      if (!expectedScanId || i.scan_id !== expectedScanId) continue;
      if (!issueBucket[i.organization_id]) issueBucket[i.organization_id] = {};
      if (!issueBucket[i.organization_id][i.category]) {
        issueBucket[i.organization_id][i.category] = { critical: 0, warning: 0, info: 0 };
      }
      const bucket = issueBucket[i.organization_id][i.category];
      if (i.severity === 'critical') bucket.critical += 1;
      else if (i.severity === 'warning') bucket.warning += 1;
      else bucket.info += 1;
    }

    // Build the per-category comparison matrix
    const categories: CategoryComparison[] = ENTITY_GROUPS.map((group) => {
      const perOrg = (orgs as OrgRow[]).map((org) => {
        const scan = latestByOrg.get(org.id);
        const dataFetched = (scan?.metadata?.data_fetched ?? {}) as Record<string, number>;
        const recordCount = group.fetchedKeys.reduce(
          (sum, key) => sum + (typeof dataFetched[key] === 'number' ? (dataFetched[key] as number) : 0),
          0
        );
        const orgIssues = issueBucket[org.id] ?? {};
        let critical = 0;
        let warning = 0;
        for (const issueCat of group.issueCategories) {
          if (orgIssues[issueCat]) {
            critical += orgIssues[issueCat].critical;
            warning += orgIssues[issueCat].warning;
          }
        }
        // Health ratio: lower critical-density = healthier. Capped at 1.
        // If recordCount is 0, the category doesn't exist in this org —
        // treat as N/A by setting health_ratio = -1 (greenfield logic
        // ignores negative health).
        const health =
          recordCount === 0 ? -1 : Math.max(0, 1 - critical / Math.max(recordCount, 1));
        return {
          org_id: org.id,
          org_name: org.name,
          record_count: recordCount,
          critical_issues: critical,
          warning_issues: warning,
          health_ratio: Math.round(health * 1000) / 1000,
        };
      });

      // Greenfield recommendation: pick the org with the highest health
      // ratio that ALSO has a meaningful record count (top 50th
      // percentile of records in this category across the portfolio).
      // Rationale: an org with 0 records or trivially few records can
      // appear "100% healthy" by default — that's not a useful source
      // for migration. We want a healthy org that ALSO has substance.
      const eligible = perOrg.filter((o) => o.health_ratio >= 0);
      let recommendation: CategoryComparison['greenfieldRecommendation'] = null;
      if (eligible.length > 0) {
        const counts = eligible.map((o) => o.record_count).sort((a, b) => a - b);
        const medianCount = counts[Math.floor(counts.length / 2)] ?? 0;
        const substantiveOrgs = eligible.filter((o) => o.record_count >= Math.max(1, medianCount / 2));
        const winner = substantiveOrgs.length > 0
          ? substantiveOrgs.reduce((best, o) => (o.health_ratio > best.health_ratio ? o : best))
          : eligible.reduce((best, o) => (o.record_count > best.record_count ? o : best));
        recommendation = {
          source_org_id: winner.org_id,
          source_org_name: winner.org_name,
          reason:
            winner.critical_issues === 0
              ? `${winner.record_count} records, zero critical issues — cleanest in the portfolio.`
              : `${winner.record_count} records, only ${winner.critical_issues} critical issue${
                  winner.critical_issues === 1 ? '' : 's'
                } (${Math.round(winner.health_ratio * 100)}% healthy).`,
        };
      }

      return {
        category: group.category,
        label: group.label,
        perOrg,
        greenfieldRecommendation: recommendation,
      };
    });

    // Per-org overview row for the header strip
    const orgOverview = (orgs as OrgRow[]).map((org) => {
      const scan = latestByOrg.get(org.id);
      return {
        id: org.id,
        name: org.name,
        is_sandbox: !!org.is_sandbox,
        connection_status: org.connection_status,
        latest_scan_at: scan?.completed_at ?? null,
        overall_score: scan?.overall_score ?? null,
        total_issues: scan?.total_issues ?? 0,
        critical_count: scan?.critical_count ?? 0,
        warning_count: scan?.warning_count ?? 0,
        info_count: scan?.info_count ?? 0,
      };
    });

    // Migration manifest — flatten the per-category recommendations into
    // a "here's where to source each piece of the greenfield target"
    // checklist consultants can hand to delivery.
    const manifest = categories
      .filter((c) => c.greenfieldRecommendation)
      .map((c) => ({
        category: c.category,
        label: c.label,
        source_org_id: c.greenfieldRecommendation!.source_org_id,
        source_org_name: c.greenfieldRecommendation!.source_org_name,
        reason: c.greenfieldRecommendation!.reason,
      }));

    return NextResponse.json(
      {
        orgs: orgOverview,
        categories,
        migration_manifest: manifest,
        generated_at: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[portfolio-compare] error:', message);
    return NextResponse.json({ error: 'Failed to build portfolio comparison' }, { status: 500 });
  }
}
