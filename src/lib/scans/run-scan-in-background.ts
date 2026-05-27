import { createServiceClient } from '@/lib/db/client';
import { createRefreshableConnection } from '@/lib/salesforce/client';
import { fetchAllCPQData } from '@/lib/salesforce/queries';
import { fetchAllBillingData, isBillingPackageInstalled } from '@/lib/salesforce/queries-billing';
import { fetchAllARMData, getARMQueryFailures, getARMQueryOutcomes } from '@/lib/salesforce/queries-arm';
import { runAnalysis } from '@/lib/analysis/engine';
import { runBillingAnalysis } from '@/lib/analysis/billing-engine';
import { runARMAnalysis } from '@/lib/analysis/arm-engine';
import { generateExecutiveSummary } from '@/lib/ai/gemini';
import { sendScanNotification } from '@/lib/email/notifications';
import { detectInstalledPackages, packageDetectionToArray } from '@/lib/salesforce/detect-packages';
import { track } from '@/lib/analytics/track-server';
import { AnalyticsEvent } from '@/lib/analytics/events';
import type { ProductType } from '@/types';

/**
 * Run a health-check scan end-to-end against a Salesforce org and write
 * results back to the scans/issues/organizations tables.
 *
 * Extracted from src/app/api/scans/route.ts so it can be invoked from
 * non-route entry points (the cron worker, in particular). Next.js route
 * files can only export route handlers + a small set of recognised consts —
 * exporting helpers from there fails the .next type check.
 *
 * The function is fire-and-forget: callers wrap it with `waitUntil(...)`
 * and don't await it. On failure it persists status='failed' and an
 * error_message on the scan row, then sends a failure email.
 */
export async function runScanInBackground(
  scanId: string,
  org: Record<string, unknown>,
  productType: ProductType = 'cpq'
) {
  const supabase = createServiceClient();
  const scanStartTime = Date.now();

  try {
    // Update status to running
    await supabase
      .from('scans')
      .update({ status: 'running' })
      .eq('id', scanId);

    // Step 1: Connect to Salesforce (with auto token refresh)
    console.log(`[SCAN ${scanId}] Connecting to Salesforce...`);
    let conn;
    try {
      const refreshed = await createRefreshableConnection(org.id as string);
      conn = refreshed.conn;
      console.log(`[SCAN ${scanId}] Connected in ${Date.now() - scanStartTime}ms`);
    } catch (connErr: unknown) {
      const connMsg = connErr instanceof Error ? connErr.message : 'Connection failed';
      throw new Error(`Salesforce connection failed: ${connMsg}`);
    }

    // Step 1.5: Refresh installed packages detection
    console.log(`[SCAN ${scanId}] Detecting installed packages...`);
    const detected = await detectInstalledPackages(conn);
    const installedPackages = packageDetectionToArray(detected);
    await supabase
      .from('organizations')
      .update({ installed_packages: installedPackages })
      .eq('id', org.id as string);
    console.log(`[SCAN ${scanId}] Packages: ${installedPackages.join(', ') || 'none detected'}`);

    // Validate the chosen product type against what was detected.
    if (productType === 'arm' && !detected.arm) {
      throw new Error(
        'You requested an ARM scan but Revenue Cloud objects (ProductSellingModel + BillingSchedule) ' +
        'were not found in this org. Please verify Revenue Cloud is licensed and enabled.'
      );
    }
    if (productType !== 'arm' && !detected.cpq && !detected.arm) {
      throw new Error(
        'No supported product detected in this org. OrgPrism currently scans Salesforce CPQ ' +
        '(SBQQ), Salesforce Billing (blng), and Revenue Cloud (ARM). Please verify the relevant ' +
        'package is installed or feature enabled, and try reconnecting.'
      );
    }
    if (productType !== 'arm' && !detected.cpq && detected.arm) {
      throw new Error(
        'This org has Revenue Cloud (ARM) but not Salesforce CPQ installed. ' +
        'Please request an ARM scan instead from the org detail page.'
      );
    }

    // Fetch suppressions once — same list used by every analysis branch.
    const { data: suppressions } = await supabase
      .from('check_suppressions')
      .select('check_id')
      .eq('organization_id', org.id as string);
    const suppressedCheckIds = (suppressions || []).map((s) => s.check_id);
    if (suppressedCheckIds.length > 0) {
      console.log(`[SCAN ${scanId}] Skipping ${suppressedCheckIds.length} suppressed check(s): ${suppressedCheckIds.join(', ')}`);
    }

    // Step 2 + 3: Branch by product type — fetch data, run the matching analysis.
    let result: import('@/types').ScanResult;
    let cpqDataTotals = { priceRules: 0, products: 0, quoteLines: 0 };
    let dataFetchedMeta: Record<string, number> = {};
    let queryFailuresMeta: Array<{ object: string; errorCode: string; errorMsg: string }> = [];
    let queryOutcomesMeta: Record<string, 'ok' | 'invalid_type' | 'error'> = {};

    if (productType === 'arm') {
      console.log(`[SCAN ${scanId}] Fetching ARM (Revenue Cloud) data...`);
      const fetchStart = Date.now();
      const armData = await fetchAllARMData(conn);
      console.log(`[SCAN ${scanId}] ARM data fetched in ${Date.now() - fetchStart}ms — ` +
        `${armData.products.length} products, ${armData.sellingModels.length} selling models, ` +
        `${armData.priceAdjustmentSchedules.length} price adjustments, ` +
        `${armData.productRelatedComponents.length} bundle components`);

      // Capture any silent SOQL failures from the fetch — surfaced on the
      // org-detail page as a "score may be incomplete" warning so users
      // don't trust an artificially-high score driven by missing data.
      queryFailuresMeta = getARMQueryFailures();
      queryOutcomesMeta = getARMQueryOutcomes();
      if (queryFailuresMeta.length > 0) {
        console.warn(`[SCAN ${scanId}] ⚠️ ${queryFailuresMeta.length} ARM SOQL queries failed silently — score may be artificially high. Failed objects: ${queryFailuresMeta.map((f) => f.object).join(', ')}`);
      }

      console.log(`[SCAN ${scanId}] Running ARM analysis...`);
      const analysisStart = Date.now();
      const armResult = await runARMAnalysis(armData, suppressedCheckIds);
      console.log(`[SCAN ${scanId}] ARM analysis done in ${Date.now() - analysisStart}ms — ` +
        `Score: ${armResult.overall_score}/100, ${armResult.issues.length} issues`);

      result = {
        overall_score: armResult.overall_score,
        category_scores: armResult.category_scores,
        issues: armResult.issues,
        summary: '',
        duration_ms: armResult.duration_ms,
      };
      cpqDataTotals = {
        priceRules: 0,
        products: armData.products.length,
        quoteLines: 0,
      };
      // Capture row counts for every ARM object family we queried. Used by
      // the org-detail page to show "data observed in N of M object types"
      // — critical for transparency when the score is suspiciously high
      // because most objects are empty (silent failures or partial-RLM org).
      dataFetchedMeta = {
        products: armData.products.length,
        sellingModels: armData.sellingModels.length,
        sellingModelOptions: armData.sellingModelOptions.length,
        priceAdjustmentSchedules: armData.priceAdjustmentSchedules.length,
        priceAdjustmentTiers: armData.priceAdjustmentTiers.length,
        attributeBasedAdjRules: armData.attributeBasedAdjRules.length,
        productRelatedComponents: armData.productRelatedComponents.length,
        priceBooks: armData.priceBooks.length,
        productCategories: armData.productCategories.length,
        productCategoryProducts: armData.productCategoryProducts.length,
        pricingProcedures: armData.pricingProcedures.length,
        decisionTables: armData.decisionTables.length,
        contextDefinitions: armData.contextDefinitions.length,
        rateCards: armData.rateCards.length,
        rateCardEntries: armData.rateCardEntries.length,
        attributeDefinitions: armData.attributeDefinitions.length,
        attributeCategories: armData.attributeCategories.length,
        attributePicklistValues: armData.attributePicklistValues.length,
        assets: armData.assets.length,
        assetStatePeriods: armData.assetStatePeriods.length,
        assetRelationships: armData.assetRelationships.length,
        contracts: armData.contracts.length,
        contractItemPrices: armData.contractItemPrices.length,
        unitOfMeasureClasses: armData.unitOfMeasureClasses.length,
        usageResources: armData.usageResources.length,
        productUsageGrants: armData.productUsageGrants.length,
        fulfillmentStepDefinitions: armData.fulfillmentStepDefinitions.length,
        fulfillmentStepDefinitionGroups: armData.fulfillmentStepDefinitionGroups.length,
        productFulfillmentScenarios: armData.productFulfillmentScenarios.length,
        fulfillmentTaskAssignmentRules: armData.fulfillmentTaskAssignmentRules.length,
        costBooks: armData.costBooks.length,
        costBookEntries: armData.costBookEntries.length,
        // v5
        pricebookEntries: armData.pricebookEntries.length,
        taxTreatments: armData.taxTreatments.length,
        taxEngines: armData.taxEngines.length,
        taxPolicies: armData.taxPolicies.length,
        taxTreatmentItems: armData.taxTreatmentItems.length,
        billingPolicies: armData.billingPolicies.length,
        billingTreatments: armData.billingTreatments.length,
        billingArrangements: armData.billingArrangements.length,
        billingArrangementLines: armData.billingArrangementLines.length,
        billingMilestonePlans: armData.billingMilestonePlans.length,
        billingMilestonePlanItems: armData.billingMilestonePlanItems.length,
        paymentRetryRuleSets: armData.paymentRetryRuleSets.length,
        generalLedgerAccounts: armData.generalLedgerAccounts.length,
        generalLedgerAcctAsgntRules: armData.generalLedgerAcctAsgntRules.length,
        accountingPeriods: armData.accountingPeriods.length,
        legalEntityAccountingPeriods: armData.legalEntityAccountingPeriods.length,
        documentClauseSets: armData.documentClauseSets.length,
        documentClauses: armData.documentClauses.length,
        productQualifications: armData.productQualifications.length,
        productRampSegments: armData.productRampSegments.length,
        fulfillmentStepDependencyDefs: armData.fulfillmentStepDependencyDefs.length,
      };
    } else {
      // CPQ or CPQ + Billing branch
      console.log(`[SCAN ${scanId}] Fetching CPQ data...`);
      const fetchStart = Date.now();
      const cpqData = await fetchAllCPQData(conn);
      console.log(`[SCAN ${scanId}] CPQ data fetched in ${Date.now() - fetchStart}ms — ` +
        `${cpqData.priceRules.length} price rules, ${cpqData.products.length} products, ` +
        `${cpqData.productRules.length} product rules, ${cpqData.quoteLines.length} quote lines, ` +
        `${cpqData.productOptions.length} product options`);

      // Fetch billing data if product type includes billing
      let billingData = null;
      if (productType === 'cpq_billing') {
        console.log(`[SCAN ${scanId}] Checking for Salesforce Billing package...`);
        const hasBilling = await isBillingPackageInstalled(conn);
        if (hasBilling) {
          console.log(`[SCAN ${scanId}] Billing package detected, fetching billing data...`);
          const billingFetchStart = Date.now();
          billingData = await fetchAllBillingData(conn);
          console.log(`[SCAN ${scanId}] Billing data fetched in ${Date.now() - billingFetchStart}ms`);
        } else {
          console.log(`[SCAN ${scanId}] ⚠️ Billing package not installed — skipping billing checks`);
        }
      }

      console.log(`[SCAN ${scanId}] Running CPQ analysis...`);
      const analysisStart = Date.now();
      result = await runAnalysis(cpqData, suppressedCheckIds);
      console.log(`[SCAN ${scanId}] CPQ analysis done in ${Date.now() - analysisStart}ms — ` +
        `Score: ${result.overall_score}/100, ${result.issues.length} issues`);

      if (billingData) {
        console.log(`[SCAN ${scanId}] Running billing analysis...`);
        const billingAnalysisStart = Date.now();
        const billingResult = await runBillingAnalysis(billingData);
        console.log(`[SCAN ${scanId}] Billing analysis done in ${Date.now() - billingAnalysisStart}ms — ` +
          `Score: ${billingResult.overall_score}/100, ${billingResult.issues.length} issues`);

        result.issues.push(...billingResult.issues);
        result.category_scores = {
          ...result.category_scores,
          ...billingResult.category_scores,
        } as typeof result.category_scores;
        const PENALTY: Record<string, number> = { critical: 2.0, warning: 0.5, info: 0.1 };
        let combinedPenalty = 0;
        for (const issue of result.issues) {
          combinedPenalty += PENALTY[issue.severity] ?? 0;
        }
        result.overall_score = Math.max(0, Math.min(100, Math.round(100 - combinedPenalty)));
      }

      cpqDataTotals = {
        priceRules: cpqData.priceRules.length,
        products: cpqData.products.length,
        quoteLines: cpqData.quoteLines.length,
      };
      dataFetchedMeta = {
        priceRules: cpqData.priceRules.length,
        products: cpqData.products.length,
        productRules: cpqData.productRules.length,
        productOptions: cpqData.productOptions.length,
        quoteLines: cpqData.quoteLines.length,
        discountSchedules: cpqData.discountSchedules.length,
        summaryVariables: cpqData.summaryVariables.length,
        approvalRules: cpqData.approvalRules.length,
        ...(billingData ? {
          billingRules: billingData.billingRules.length,
          revRecRules: billingData.revRecRules.length,
          taxRules: billingData.taxRules.length,
          financeBooks: billingData.financeBooks.length,
          financePeriods: billingData.financePeriods.length,
          glRules: billingData.glRules.length,
          legalEntities: billingData.legalEntities.length,
          invoices: billingData.invoices.length,
        } : {}),
      };
    }

    // Step 4: Generate AI summary
    console.log(`[SCAN ${scanId}] Generating AI summary...`);
    const aiStart = Date.now();
    try {
      result.summary = await generateExecutiveSummary(
        result.issues,
        result.category_scores,
        result.overall_score,
        {
          totalPriceRules: cpqDataTotals.priceRules,
          totalProducts: cpqDataTotals.products,
          totalQuoteLines: cpqDataTotals.quoteLines,
        }
      );
      console.log(`[SCAN ${scanId}] AI summary generated in ${Date.now() - aiStart}ms`);
    } catch (aiError) {
      console.error(`[SCAN ${scanId}] AI summary failed:`, aiError);
      result.summary = `Health score: ${result.overall_score}/100. Found ${result.issues.length} issue(s).`;
    }

    // Step 5: Save issues
    const issuesToInsert = result.issues.map((issue) => ({
      scan_id: scanId,
      organization_id: org.id as string,
      check_id: issue.check_id,
      category: issue.category,
      severity: issue.severity,
      title: issue.title,
      description: issue.description,
      impact: issue.impact,
      recommendation: issue.recommendation,
      affected_records: issue.affected_records || [],
      revenue_impact: issue.revenue_impact || null,
      effort_hours: issue.effort_hours || null,
    }));

    if (issuesToInsert.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < issuesToInsert.length; i += batchSize) {
        const batch = issuesToInsert.slice(i, i + batchSize);
        const { error: insertErr } = await supabase.from('issues').insert(batch);
        if (insertErr) {
          console.error(`[SCAN ${scanId}] Issue batch ${Math.floor(i / batchSize) + 1} insert failed:`, insertErr);
          throw new Error(`Failed to save issues (batch ${Math.floor(i / batchSize) + 1})`);
        }
      }
    }

    const totalDurationMs = Date.now() - scanStartTime;

    // Step 6: Update org first
    let currentOrgName: string | undefined;
    try {
      const nameResult = await conn.query('SELECT Name FROM Organization LIMIT 1');
      currentOrgName = (nameResult.records[0] as { Name: string })?.Name;
      console.log(`[SCAN ${scanId}] SF org name: "${currentOrgName}" (DB name: "${org.name}")`);
    } catch (nameErr) {
      console.error(`[SCAN ${scanId}] Name sync query failed:`, nameErr);
    }

    await supabase
      .from('organizations')
      .update({
        ...(currentOrgName ? { name: currentOrgName } : {}),
        last_scan_score: result.overall_score,
        last_scan_at: new Date().toISOString(),
        total_price_rules: cpqDataTotals.priceRules,
        total_products: cpqDataTotals.products,
        total_quote_lines: cpqDataTotals.quoteLines,
      })
      .eq('id', org.id as string);

    await supabase
      .from('scans')
      .update({
        status: 'completed',
        overall_score: result.overall_score,
        category_scores: result.category_scores,
        summary: result.summary,
        total_issues: result.issues.length,
        critical_count: result.issues.filter((i) => i.severity === 'critical').length,
        warning_count: result.issues.filter((i) => i.severity === 'warning').length,
        info_count: result.issues.filter((i) => i.severity === 'info').length,
        duration_ms: totalDurationMs,
        metadata: {
          revenue_summary: result.revenue_summary || null,
          complexity: result.complexity || null,
          product_type: productType,
          data_fetched: dataFetchedMeta,
          query_failures: queryFailuresMeta.length > 0 ? queryFailuresMeta : null,
          query_outcomes: Object.keys(queryOutcomesMeta).length > 0 ? queryOutcomesMeta : null,
        },
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanId);

    console.log(`[SCAN ${scanId}] ✅ Completed in ${(totalDurationMs / 1000).toFixed(1)}s — Score: ${result.overall_score}/100`);

    void track(AnalyticsEvent.SCAN_COMPLETED, {
      userId: org.user_id as string,
      properties: {
        scan_id: scanId,
        product_type: productType,
        duration_ms: totalDurationMs,
        overall_score: result.overall_score,
        issue_count: result.issues.length,
        critical_count: result.issues.filter((i) => i.severity === 'critical').length,
      },
    });

    // Step 7: Email notification
    try {
      await sendScanNotification(org.user_id as string, {
        scanId,
        orgId: org.id as string,
        orgName: org.name as string,
        overallScore: result.overall_score,
        totalIssues: result.issues.length,
        criticalCount: result.issues.filter((i) => i.severity === 'critical').length,
        warningCount: result.issues.filter((i) => i.severity === 'warning').length,
        infoCount: result.issues.filter((i) => i.severity === 'info').length,
        topIssues: (() => {
          const seen = new Set<string>();
          return result.issues
            .sort((a, b) => {
              const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
              return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
            })
            .filter((i) => {
              if (i.severity === 'info') return false;
              if (seen.has(i.title)) return false;
              seen.add(i.title);
              return true;
            })
            .slice(0, 5)
            .map((i) => ({ title: i.title, severity: i.severity }));
        })(),
        status: 'completed',
      });
      console.log(`[SCAN ${scanId}] 📧 Email notification sent`);
    } catch (emailErr) {
      console.error(`[SCAN ${scanId}] 📧 Email notification failed:`, emailErr);
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Scan failed';
    const totalDurationMs = Date.now() - scanStartTime;
    console.error(`[SCAN ${scanId}] ❌ Failed after ${(totalDurationMs / 1000).toFixed(1)}s:`, message);

    await supabase
      .from('scans')
      .update({
        status: 'failed',
        error_message: message,
        duration_ms: totalDurationMs,
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanId);

    void track(AnalyticsEvent.SCAN_FAILED, {
      userId: org.user_id as string,
      properties: {
        scan_id: scanId,
        product_type: productType,
        duration_ms: totalDurationMs,
        // Just the prefix, never the full message which may contain Salesforce-side IDs
        error_class: message.split(':')[0]?.slice(0, 80) ?? 'unknown',
      },
    });

    try {
      await sendScanNotification(org.user_id as string, {
        scanId,
        orgId: org.id as string,
        orgName: org.name as string,
        overallScore: 0,
        totalIssues: 0,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
        status: 'failed',
        errorMessage: message,
      });
    } catch (emailErr) {
      console.error(`[SCAN ${scanId}] 📧 Failure email failed:`, emailErr);
    }
  }
}
