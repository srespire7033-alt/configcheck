import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { createConnection } from '@/lib/salesforce/client';
import { fetchAllCPQData } from '@/lib/salesforce/queries';
import { runAnalysis } from '@/lib/analysis/engine';
import { generateExecutiveSummary } from '@/lib/ai/claude';

/**
 * POST /api/scans
 * Start a new health check scan for an org
 */
export async function POST(request: NextRequest) {
  try {
    const { organizationId } = await request.json();

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Get org details
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Create scan record (pending)
    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .insert({
        organization_id: organizationId,
        user_id: org.user_id,
        status: 'pending',
        scan_type: 'full',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (scanError || !scan) {
      return NextResponse.json({ error: 'Failed to create scan' }, { status: 500 });
    }

    // Run scan in background (non-blocking)
    runScanInBackground(scan.id, org).catch((error) => {
      console.error('Background scan failed:', error);
    });

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

    return NextResponse.json(scan);
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

    return NextResponse.json(scans);
  }

  return NextResponse.json({ error: 'scanId or orgId required' }, { status: 400 });
}

/**
 * Background scan execution
 */
async function runScanInBackground(
  scanId: string,
  org: Record<string, unknown>
) {
  const supabase = createServiceClient();

  try {
    // Update status to running
    await supabase
      .from('scans')
      .update({ status: 'running' })
      .eq('id', scanId);

    // Connect to Salesforce
    const conn = createConnection(
      org.instance_url as string,
      org.access_token as string,
      org.refresh_token as string
    );

    // Fetch all CPQ data
    const cpqData = await fetchAllCPQData(conn);

    // Run analysis
    const result = await runAnalysis(cpqData);

    // Generate AI summary
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
    } catch (aiError) {
      console.error('AI summary generation failed:', aiError);
      result.summary = `Health score: ${result.overall_score}/100. Found ${result.issues.length} issue(s).`;
    }

    // Save issues to database
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
      affected_records: issue.affected_records,
      revenue_impact: issue.revenue_impact || null,
      effort_hours: issue.effort_hours || null,
    }));

    if (issuesToInsert.length > 0) {
      await supabase.from('issues').insert(issuesToInsert);
    }

    // Update scan with results
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
        duration_ms: result.duration_ms,
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanId);

    // Update org with latest scan info
    await supabase
      .from('organizations')
      .update({
        last_scan_score: result.overall_score,
        last_scan_at: new Date().toISOString(),
        total_price_rules: cpqData.priceRules.length,
        total_products: cpqData.products.length,
        total_quote_lines: cpqData.quoteLines.length,
      })
      .eq('id', org.id as string);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Scan failed';
    console.error('Scan error:', message);

    await supabase
      .from('scans')
      .update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanId);
  }
}
