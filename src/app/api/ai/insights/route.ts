import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth/get-user';
import { generateScanDiffInsights, generateRemediationPlan } from '@/lib/ai/gemini';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/insights
 * Generate AI insights — scan diff analysis or remediation plan
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type } = body;

    if (type === 'scan-diff') {
      const { prevScore, newScore, newIssues, resolvedIssues, unchangedCount } = body;
      try {
        const insight = await generateScanDiffInsights(
          prevScore,
          newScore,
          newIssues || [],
          resolvedIssues || [],
          unchangedCount || 0
        );
        return NextResponse.json({ insight });
      } catch (aiError) {
        const status = (aiError as { status?: number }).status;
        return NextResponse.json(
          { error: status === 503 ? 'AI service is temporarily overloaded. Please try again in a few seconds.' : 'Failed to generate drift analysis.' },
          { status: status === 503 ? 503 : 500 }
        );
      }
    }

    if (type === 'remediation-plan') {
      const { issues, overallScore } = body;
      try {
        const plan = await generateRemediationPlan(issues, overallScore);
        return NextResponse.json({ plan });
      } catch (aiError) {
        const status = (aiError as { status?: number }).status;
        return NextResponse.json(
          { error: status === 503 ? 'AI service is temporarily overloaded. Please try again in a few seconds.' : 'Failed to generate remediation plan.' },
          { status: status === 503 ? 503 : 500 }
        );
      }
    }

    return NextResponse.json({ error: 'Invalid type. Use "scan-diff" or "remediation-plan".' }, { status: 400 });
  } catch (error) {
    console.error('AI insights error:', error);
    return NextResponse.json({ error: 'Failed to generate insights' }, { status: 500 });
  }
}
