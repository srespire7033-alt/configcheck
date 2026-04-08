import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { generateFixSuggestion } from '@/lib/ai/claude';

/**
 * POST /api/ai/fix
 * Generate AI fix suggestion for a specific issue
 */
export async function POST(request: NextRequest) {
  try {
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

    const suggestion = await generateFixSuggestion({
      check_id: issue.check_id,
      category: issue.category,
      severity: issue.severity,
      title: issue.title,
      description: issue.description,
      impact: issue.impact,
      recommendation: issue.recommendation,
      affected_records: issue.affected_records,
    });

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
