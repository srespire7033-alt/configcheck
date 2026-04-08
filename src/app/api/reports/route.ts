import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceClient } from '@/lib/db/client';
import { CPQHealthReport } from '@/lib/report/pdf-generator';
import React from 'react';

/**
 * GET /api/reports?scanId=xxx
 * Generate and download PDF report
 */
export async function GET(request: NextRequest) {
  const scanId = request.nextUrl.searchParams.get('scanId');

  if (!scanId) {
    return NextResponse.json({ error: 'scanId is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    // Fetch scan, issues, org, and user data
    const { data: scan } = await supabase
      .from('scans')
      .select('*')
      .eq('id', scanId)
      .single();

    if (!scan) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    }

    const [issuesRes, orgRes, userRes] = await Promise.all([
      supabase.from('issues').select('*').eq('scan_id', scanId).order('severity'),
      supabase.from('organizations').select('name').eq('id', scan.organization_id).single(),
      supabase.from('users').select('company_name, report_branding_color').eq('id', scan.user_id).single(),
    ]);

    const reportElement = React.createElement(CPQHealthReport, {
      scan,
      issues: issuesRes.data || [],
      orgName: orgRes.data?.name || 'Unknown Org',
      companyName: userRes.data?.company_name || '',
      brandColor: userRes.data?.report_branding_color || '#1B5E96',
    });

    // Cast needed: CPQHealthReport returns Document but TS can't infer DocumentProps
    const pdfBuffer = await renderToBuffer(reportElement as React.ReactElement);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="ConfigCheck-${orgRes.data?.name || 'report'}-${new Date().toISOString().split('T')[0]}.pdf"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate report';
    console.error('PDF generation error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
