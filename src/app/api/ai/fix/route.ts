import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { checkQuota } from '@/lib/quota';
import { generateFixSuggestion } from '@/lib/ai/gemini';

/**
 * POST /api/ai/fix
 * Generate AI fix suggestion for a specific issue
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

    const { issueId } = await request.json();

    if (!issueId) {
      return NextResponse.json({ error: 'issueId is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: issue, error } = await supabase
      .from('issues')
      .select('*')
      .eq('id', issueId)
      .single();

    if (error || !issue) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    let suggestion: string;
    try {
      suggestion = await generateFixSuggestion({
        check_id: issue.check_id,
        category: issue.category,
        severity: issue.severity,
        title: issue.title,
        description: issue.description,
        impact: issue.impact,
        recommendation: issue.recommendation,
        affected_records: issue.affected_records,
      });
    } catch (aiError) {
      const status = (aiError as { status?: number }).status;
      if (status === 503) {
        return NextResponse.json(
          { error: 'AI service is temporarily overloaded. Please try again in a few seconds.' },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to generate AI fix suggestion. Please try again.' },
        { status: 500 }
      );
    }

    // Save suggestion to issue record
    await supabase
      .from('issues')
      .update({ ai_fix_suggestion: suggestion })
      .eq('id', issueId);

    return NextResponse.json({ suggestion });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
