import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scans/compare?scanA=xxx&scanB=xxx
 * Compare two scans and return drift analysis
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const scanAId = searchParams.get('scanA');
    const scanBId = searchParams.get('scanB');

    if (!scanAId || !scanBId) {
      return NextResponse.json({ error: 'scanA and scanB query params required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Fetch both scans
    const [scanAResult, scanBResult] = await Promise.all([
      supabase.from('scans').select('*').eq('id', scanAId).single(),
      supabase.from('scans').select('*').eq('id', scanBId).single(),
    ]);

    if (scanAResult.error || scanBResult.error) {
      return NextResponse.json({ error: 'One or both scans not found' }, { status: 404 });
    }

    const scanA = scanAResult.data;
    const scanB = scanBResult.data;

    // Verify both scans belong to user's org
    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', scanA.organization_id)
      .eq('user_id', user.id)
      .single();

    if (!org || scanA.organization_id !== scanB.organization_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Fetch issues for both scans
    const [issuesAResult, issuesBResult] = await Promise.all([
      supabase.from('issues').select('*').eq('scan_id', scanAId),
      supabase.from('issues').select('*').eq('scan_id', scanBId),
    ]);

    const issuesA = issuesAResult.data || [];
    const issuesB = issuesBResult.data || [];

    // Compare: find new, resolved, and unchanged issues
    const issueAKeys = new Set(issuesA.map((i) => `${i.check_id}:${i.title}`));
    const issueBKeys = new Set(issuesB.map((i) => `${i.check_id}:${i.title}`));

    const newIssues = issuesB.filter((i) => !issueAKeys.has(`${i.check_id}:${i.title}`));
    const resolvedIssues = issuesA.filter((i) => !issueBKeys.has(`${i.check_id}:${i.title}`));
    const unchangedIssues = issuesB.filter((i) => issueAKeys.has(`${i.check_id}:${i.title}`));

    // Category score changes
    const categoryChanges: Record<string, { before: number; after: number; delta: number }> = {};
    const scoresA = (scanA.category_scores || {}) as Record<string, number>;
    const scoresB = (scanB.category_scores || {}) as Record<string, number>;

    const allCategories = Array.from(new Set([...Object.keys(scoresA), ...Object.keys(scoresB)]));
    for (const cat of allCategories) {
      const before = scoresA[cat] ?? 100;
      const after = scoresB[cat] ?? 100;
      categoryChanges[cat] = { before, after, delta: after - before };
    }

    return NextResponse.json({
      scanA: { id: scanA.id, score: scanA.overall_score, date: scanA.created_at, totalIssues: scanA.total_issues },
      scanB: { id: scanB.id, score: scanB.overall_score, date: scanB.created_at, totalIssues: scanB.total_issues },
      scoreDelta: (scanB.overall_score || 0) - (scanA.overall_score || 0),
      newIssues,
      resolvedIssues,
      unchangedIssues,
      categoryChanges,
      summary: {
        newCount: newIssues.length,
        resolvedCount: resolvedIssues.length,
        unchangedCount: unchangedIssues.length,
        improved: (scanB.overall_score || 0) > (scanA.overall_score || 0),
      },
    });
  } catch (error) {
    console.error('Scan comparison error:', error);
    return NextResponse.json({ error: 'Failed to compare scans' }, { status: 500 });
  }
}
