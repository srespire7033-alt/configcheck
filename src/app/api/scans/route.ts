import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { createRefreshableConnection } from '@/lib/salesforce/client';
import { fetchAllCPQData } from '@/lib/salesforce/queries';
import { fetchAllBillingData, isBillingPackageInstalled } from '@/lib/salesforce/queries-billing';
import { runAnalysis } from '@/lib/analysis/engine';
import { runBillingAnalysis } from '@/lib/analysis/billing-engine';
import { generateExecutiveSummary } from '@/lib/ai/gemini';
import { sendScanNotification } from '@/lib/email/notifications';
import { checkQuota } from '@/lib/quota';
import { detectInstalledPackages, packageDetectionToArray } from '@/lib/salesforce/detect-packages';
import type { ProductType } from '@/types';

// Allow up to 180s for scans (Vercel Pro: 300s max, Hobby: 60s max)
export const maxDuration = 180;

/**
 * POST /api/scans
 * Start a new health check scan for an org.
 * Creates the scan record, returns scanId immediately,
 * then runs the scan in the background via waitUntil.
 * Client polls GET /api/scans?scanId=xxx for status updates.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { organizationId, productType: requestedProductType } = await request.json();

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
    }

    // Default to 'cpq' if not specified; validate product type
    const productType: ProductType = (['cpq', 'cpq_billing', 'arm'] as const).includes(requestedProductType)
      ? requestedProductType
      : 'cpq';

    const supabase = createServiceClient();

    // Get org details (verify ownership)
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .eq('user_id', user.id)
      .single();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Check scan quota
    const quota = await checkQuota(user.id, 'scans');
    if (!quota.allowed) {
      return NextResponse.json({
        error: 'scan_limit_reached',
        message: `You've used all ${quota.limit} scans for this month. Your limit resets on ${quota.resetDate}.`,
        limit: quota.limit,
        used: quota.used,
        resetDate: quota.resetDate,
      }, { status: 429 });
    }

    // Create scan record (pending)
    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .insert({
        organization_id: organizationId,
        user_id: org.user_id,
        status: 'pending',
        scan_type: 'full',
        product_type: productType,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (scanError || !scan) {
      return NextResponse.json({ error: 'Failed to create scan' }, { status: 500 });
    }

    // Use waitUntil to run the scan AFTER the response is sent.
    // This keeps the Vercel function alive for up to maxDuration (180s)
    // while the scan runs in the background.
    waitUntil(
      runScanInBackground(scan.id, org, productType).catch(async (error) => {
        console.error('[SCAN] Scan execution failed:', error);
        const svc = createServiceClient();
        const failUpdate = {
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Scan failed unexpectedly',
          completed_at: new Date().toISOString(),
        };
        // Update regardless of current status to prevent scans stuck in running/pending
        const { error: updateErr } = await svc.from('scans').update(failUpdate).eq('id', scan.id);
        if (updateErr) console.error('[SCAN] Failed to mark scan as failed:', updateErr);
      })
    );

    // Return scanId immediately — client starts polling right away
    return NextResponse.json({ scanId: scan.id, status: 'pending' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/scans?scanId=xxx
 * Get scan status and results
 */
export async function GET(request: NextRequest) {
  const scanId = request.nextUrl.searchParams.get('scanId');
  const orgId = request.nextUrl.searchParams.get('orgId');

  const supabase = createServiceClient();

  if (scanId) {
    const { data: scan, error } = await supabase
      .from('scans')
      .select('*')
      .eq('id', scanId)
      .single();

    if (error || !scan) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    }

    return NextResponse.json(scan, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  }

  if (orgId) {
    const { data: scans, error } = await supabase
      .from('scans')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch scans' }, { status: 500 });
    }

    return NextResponse.json(scans, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  }

  return NextResponse.json({ error: 'scanId or orgId required' }, { status: 400 });
}

/**
 * Background scan execution
 */
async function runScanInBackground(
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

    // Step 2: Fetch data based on product type
    console.log(`[SCAN ${scanId}] Fetching data (product_type: ${productType})...`);
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

    // Step 3: Run analysis
    console.log(`[SCAN ${scanId}] Running CPQ analysis...`);
    const analysisStart = Date.now();
    const result = await runAnalysis(cpqData);
    console.log(`[SCAN ${scanId}] CPQ analysis done in ${Date.now() - analysisStart}ms — ` +
      `Score: ${result.overall_score}/100, ${result.issues.length} issues`);

    // Run billing analysis if data was fetched
    let billingResult = null;
    if (billingData) {
      console.log(`[SCAN ${scanId}] Running billing analysis...`);
      const billingAnalysisStart = Date.now();
      billingResult = await runBillingAnalysis(billingData);
      console.log(`[SCAN ${scanId}] Billing analysis done in ${Date.now() - billingAnalysisStart}ms — ` +
        `Score: ${billingResult.overall_score}/100, ${billingResult.issues.length} issues`);

      // Merge billing issues into result
      result.issues.push(...billingResult.issues);

      // Merge category scores
      result.category_scores = {
        ...result.category_scores,
        ...billingResult.category_scores,
      } as typeof result.category_scores;

      // Recalculate combined overall score (weighted average of CPQ and Billing)
      const cpqWeight = 0.6;
      const billingWeight = 0.4;
      result.overall_score = Math.round(
        result.overall_score * cpqWeight + billingResult.overall_score * billingWeight
      );
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
          totalPriceRules: cpqData.priceRules.length,
          totalProducts: cpqData.products.length,
          totalQuoteLines: cpqData.quoteLines.length,
        }
      );
      console.log(`[SCAN ${scanId}] AI summary generated in ${Date.now() - aiStart}ms`);
    } catch (aiError) {
      console.error(`[SCAN ${scanId}] AI summary failed:`, aiError);
      result.summary = `Health score: ${result.overall_score}/100. Found ${result.issues.length} issue(s).`;
    }

    // Step 5: Save issues to database (batch in chunks for large orgs)
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
      // Insert in batches of 50 to avoid payload limits
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

    // Calculate actual full scan duration
    const totalDurationMs = Date.now() - scanStartTime;

    // Step 6: Update org FIRST (before marking scan completed)
    // This prevents the race condition where the client sees 'completed'
    // but reads stale org data because the org update hasn't happened yet.
    // Also sync the org name from Salesforce in case it changed.
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
        total_price_rules: cpqData.priceRules.length,
        total_products: cpqData.products.length,
        total_quote_lines: cpqData.quoteLines.length,
      })
      .eq('id', org.id as string);

    // Now mark scan as completed (client polls for this status)
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
          data_fetched: {
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
          },
        },
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanId);

    console.log(`[SCAN ${scanId}] ✅ Completed in ${(totalDurationMs / 1000).toFixed(1)}s — Score: ${result.overall_score}/100`);

    // Step 7: Send email notification (await it so we know if it fails)
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
          // Deduplicate by title, critical first, then warning — top 5 unique issues
          const seen = new Set<string>();
          return result.issues
            .sort((a, b) => {
              const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
              return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
            })
            .filter(i => {
              if (i.severity === 'info') return false;
              if (seen.has(i.title)) return false;
              seen.add(i.title);
              return true;
            })
            .slice(0, 5)
            .map(i => ({ title: i.title, severity: i.severity }));
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

    // Send failure notification
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
