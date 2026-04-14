import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { checkQuota } from '@/lib/quota';
import { generateScanDiffInsights, generateRemediationPlan } from '@/lib/ai/gemini';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/insights
 * Generate AI insights — scan diff analysis or remediation plan
 * Results are cached in the database to avoid re-generating on page refresh.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check AI quota
    const quota = await checkQuota(user.id, 'ai_calls');
    if (!quota.allowed) {
      return NextResponse.json({
        error: 'ai_limit_reached',
        message: `You've used all ${quota.limit} AI calls for this month. Your limit resets on ${quota.resetDate}.`,
        limit: quota.limit,
        used: quota.used,
        resetDate: quota.resetDate,
      }, { status: 429 });
    }

    const body = await request.json();
    const { type } = body;
    const supabase = createServiceClient();

    if (type === 'scan-diff') {
      const { prevScore, newScore, newIssues, resolvedIssues, unchangedCount, scanAId, scanBId } = body;

      // Check cache first if scan IDs are provided
      if (scanAId && scanBId) {
        const cacheKey = `${scanAId}_${scanBId}`;
        const { data: scan } = await supabase
          .from('scans')
          .select('ai_scan_diff_cache')
          .eq('id', scanBId)
          .single();

        const cached = scan?.ai_scan_diff_cache?.[cacheKey];
        if (cached) {
          return NextResponse.json({ insight: cached, cached: true });
        }
      }

      try {
        const insight = await generateScanDiffInsights(
          prevScore,
          newScore,
          newIssues || [],
          resolvedIssues || [],
          unchangedCount || 0
        );

        // Log AI usage (fire-and-forget)
        supabase.from('usage_logs').insert({
          user_id: user.id,
          event_type: 'ai_scan_diff',
          metadata: { scanAId, scanBId },
        }).then(() => {});

        // Save to cache if scan IDs provided
        if (scanAId && scanBId && insight) {
          const cacheKey = `${scanAId}_${scanBId}`;
          const { data: currentScan } = await supabase
            .from('scans')
            .select('ai_scan_diff_cache')
            .eq('id', scanBId)
            .single();

          const existingCache = currentScan?.ai_scan_diff_cache || {};
          await supabase
            .from('scans')
            .update({
              ai_scan_diff_cache: { ...existingCache, [cacheKey]: insight },
            })
            .eq('id', scanBId);
        }

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
      const { issues, overallScore, scanId } = body;

      // Check cache first if scanId provided
      if (scanId) {
        const { data: scan } = await supabase
          .from('scans')
          .select('ai_remediation_plan')
          .eq('id', scanId)
          .single();

        if (scan?.ai_remediation_plan) {
          return NextResponse.json({ plan: scan.ai_remediation_plan, cached: true });
        }
      }

      try {
        const plan = await generateRemediationPlan(issues, overallScore);

        // Log AI usage (fire-and-forget)
        supabase.from('usage_logs').insert({
          user_id: user.id,
          event_type: 'ai_remediation',
          metadata: { scanId },
        }).then(() => {});

        // Save to cache if scanId provided
        if (scanId && plan) {
          await supabase
            .from('scans')
            .update({ ai_remediation_plan: plan })
            .eq('id', scanId);
        }

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
