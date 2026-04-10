import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import * as XLSX from 'xlsx';
import type { DBIssue, DBScan } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/exports?scanId=xxx&format=csv|xlsx&type=issues|documentation
 * Export scan data as CSV, Excel, or auto-generated CPQ documentation
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const scanId = searchParams.get('scanId');
    const format = searchParams.get('format') || 'xlsx';
    const exportType = searchParams.get('type') || 'issues';

    if (!scanId) {
      return NextResponse.json({ error: 'scanId is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Fetch scan
    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .select('*')
      .eq('id', scanId)
      .single();

    if (scanError || !scan) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    }

    // Verify ownership
    const { data: org } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', scan.organization_id)
      .eq('user_id', user.id)
      .single();

    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Fetch issues
    const { data: issues } = await supabase
      .from('issues')
      .select('*')
      .eq('scan_id', scanId)
      .order('severity', { ascending: true });

    const orgName = org.name || 'Unknown';

    if (exportType === 'documentation') {
      return generateDocumentation(scan as DBScan, issues || [], orgName, format);
    }

    return generateIssuesExport(scan as DBScan, issues || [], orgName, format);
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}

function generateIssuesExport(scan: DBScan, issues: DBIssue[], orgName: string, format: string) {
  const rows = issues.map((issue, idx) => ({
    '#': idx + 1,
    'Check ID': issue.check_id,
    'Severity': issue.severity.toUpperCase(),
    'Category': formatCategory(issue.category),
    'Title': issue.title,
    'Description': issue.description,
    'Business Impact': issue.impact,
    'Recommendation': issue.recommendation,
    'Status': issue.status,
    'Revenue Impact (₹)': issue.revenue_impact ? Math.round(issue.revenue_impact) : '',
    'Effort (Hours)': issue.effort_hours || '',
    'Affected Records': issue.affected_records?.length || 0,
  }));

  // Summary row at top
  const summaryRows = [
    { '#': 'Organization', 'Check ID': orgName, 'Severity': '', 'Category': '', 'Title': '', 'Description': '', 'Business Impact': '', 'Recommendation': '', 'Status': '', 'Revenue Impact (₹)': '', 'Effort (Hours)': '', 'Affected Records': '' },
    { '#': 'Health Score', 'Check ID': `${scan.overall_score}/100`, 'Severity': '', 'Category': '', 'Title': '', 'Description': '', 'Business Impact': '', 'Recommendation': '', 'Status': '', 'Revenue Impact (₹)': '', 'Effort (Hours)': '', 'Affected Records': '' },
    { '#': 'Total Issues', 'Check ID': `${scan.total_issues} (${scan.critical_count} critical, ${scan.warning_count} warnings, ${scan.info_count} info)`, 'Severity': '', 'Category': '', 'Title': '', 'Description': '', 'Business Impact': '', 'Recommendation': '', 'Status': '', 'Revenue Impact (₹)': '', 'Effort (Hours)': '', 'Affected Records': '' },
    { '#': 'Scan Date', 'Check ID': scan.completed_at ? new Date(scan.completed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A', 'Severity': '', 'Category': '', 'Title': '', 'Description': '', 'Business Impact': '', 'Recommendation': '', 'Status': '', 'Revenue Impact (₹)': '', 'Effort (Hours)': '', 'Affected Records': '' },
    { '#': '', 'Check ID': '', 'Severity': '', 'Category': '', 'Title': '', 'Description': '', 'Business Impact': '', 'Recommendation': '', 'Status': '', 'Revenue Impact (₹)': '', 'Effort (Hours)': '', 'Affected Records': '' },
  ];

  const allRows = [...summaryRows, ...rows];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(allRows);

  // Set column widths
  ws['!cols'] = [
    { wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 20 },
    { wch: 50 }, { wch: 60 }, { wch: 40 }, { wch: 50 },
    { wch: 12 }, { wch: 15 }, { wch: 10 }, { wch: 15 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Issues');

  // Category summary sheet
  const scores = (scan.category_scores || {}) as Record<string, number>;
  const categoryRows = Object.entries(scores)
    .sort(([, a], [, b]) => a - b)
    .map(([cat, score]) => ({
      'Category': formatCategory(cat),
      'Score': `${score}/100`,
      'Status': score >= 80 ? 'Healthy' : score >= 60 ? 'Needs Attention' : 'Critical',
      'Issues': issues.filter((i) => i.category === cat).length,
    }));

  const ws2 = XLSX.utils.json_to_sheet(categoryRows);
  ws2['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 18 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Category Scores');

  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `ConfigCheck-${orgName.replace(/\s+/g, '-')}-${dateStr}`;

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  }

  // Default: XLSX
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
    },
  });
}

function generateDocumentation(scan: DBScan, issues: DBIssue[], orgName: string, format: string) {
  const scores = (scan.category_scores || {}) as Record<string, number>;
  const metadata = (scan.metadata || {}) as Record<string, unknown>;
  const complexity = metadata.complexity as { totalScore: number; rating: string; factors: { label: string; count: number }[] } | null;

  const wb = XLSX.utils.book_new();

  // Sheet 1: Executive Summary
  const summaryData = [
    ['CPQ Configuration Documentation'],
    ['Organization', orgName],
    ['Generated', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })],
    ['Health Score', `${scan.overall_score}/100`],
    ['Total Issues', scan.total_issues],
    ['Critical', scan.critical_count],
    ['Warnings', scan.warning_count],
    ['Info', scan.info_count],
    [],
    ['AI Analysis'],
    [scan.summary || 'No summary available'],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  ws1['!cols'] = [{ wch: 25 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Executive Summary');

  // Sheet 2: Configuration Inventory (from complexity data)
  if (complexity?.factors) {
    const inventoryRows = complexity.factors.map((f) => ({
      'Component': f.label,
      'Count': f.count,
      'Status': f.count === 0 ? 'Not Used' : 'Active',
    }));
    const ws2 = XLSX.utils.json_to_sheet(inventoryRows);
    ws2['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Configuration Inventory');
  }

  // Sheet 3: Category Health
  const categoryRows = Object.entries(scores)
    .sort(([, a], [, b]) => a - b)
    .map(([cat, score]) => ({
      'Category': formatCategory(cat),
      'Health Score': `${score}/100`,
      'Status': score >= 80 ? 'Healthy' : score >= 60 ? 'Needs Attention' : 'Critical',
      'Critical Issues': issues.filter((i) => i.category === cat && i.severity === 'critical').length,
      'Warnings': issues.filter((i) => i.category === cat && i.severity === 'warning').length,
      'Info': issues.filter((i) => i.category === cat && i.severity === 'info').length,
    }));
  const ws3 = XLSX.utils.json_to_sheet(categoryRows);
  ws3['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 18 }, { wch: 15 }, { wch: 10 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Category Health');

  // Sheet 4: All Issues (detailed)
  const issueRows = issues.map((issue, idx) => ({
    '#': idx + 1,
    'Check ID': issue.check_id,
    'Severity': issue.severity.toUpperCase(),
    'Category': formatCategory(issue.category),
    'Title': issue.title,
    'Description': issue.description,
    'Business Impact': issue.impact,
    'Recommendation': issue.recommendation,
    'Affected Records': (issue.affected_records || []).map((r) => r.name).join(', '),
  }));
  const ws4 = XLSX.utils.json_to_sheet(issueRows);
  ws4['!cols'] = [
    { wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 20 },
    { wch: 50 }, { wch: 60 }, { wch: 40 }, { wch: 50 }, { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(wb, ws4, 'All Issues');

  // Sheet 5: Recommendations by Priority
  const critical = issues.filter((i) => i.severity === 'critical');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const priorityRows = [
    ...critical.map((i, idx) => ({ 'Priority': idx + 1, 'Severity': 'CRITICAL', 'Title': i.title, 'Action Required': i.recommendation })),
    ...warnings.map((i, idx) => ({ 'Priority': critical.length + idx + 1, 'Severity': 'WARNING', 'Title': i.title, 'Action Required': i.recommendation })),
  ];
  if (priorityRows.length > 0) {
    const ws5 = XLSX.utils.json_to_sheet(priorityRows);
    ws5['!cols'] = [{ wch: 8 }, { wch: 10 }, { wch: 50 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws5, 'Action Plan');
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `CPQ-Documentation-${orgName.replace(/\s+/g, '-')}-${dateStr}`;

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws1);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
    },
  });
}

function formatCategory(cat: string): string {
  const labels: Record<string, string> = {
    price_rules: 'Price Rules',
    discount_schedules: 'Discount Schedules',
    products: 'Products & Bundles',
    product_rules: 'Product Rules',
    cpq_settings: 'CPQ Settings',
    subscriptions: 'Subscriptions',
    twin_fields: 'Twin Fields',
    contracted_prices: 'Contracted Prices',
    quote_lines: 'Quote Lines',
    summary_variables: 'Summary Variables',
    approval_rules: 'Approval Rules',
    quote_calculator_plugin: 'QCP (Custom Scripts)',
    quote_templates: 'Quote Templates',
    configuration_attributes: 'Config Attributes',
    guided_selling: 'Guided Selling',
    advanced_pricing: 'Advanced Pricing',
    performance: 'Performance',
    impact_analysis: 'Impact Analysis',
  };
  return labels[cat] || cat;
}
