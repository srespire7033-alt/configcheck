import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/checks/trust-scores
 * Returns aggregate trust scores per check_id from the check_trust_scores view.
 * Trust score = % of explicit feedback (resolved + false_positive) that was positive.
 * Used by the UI to show "X% of users found this helpful" badges.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('check_trust_scores')
    .select('*');

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch trust scores' }, { status: 500 });
  }

  // Convert array to object keyed by check_id for easy lookup on the client
  const scoresByCheckId: Record<string, {
    total_feedback: number;
    fixed_count: number;
    false_positive_count: number;
    not_relevant_count: number;
    trust_score: number | null;
  }> = {};

  for (const row of data || []) {
    scoresByCheckId[row.check_id] = {
      total_feedback: row.total_feedback,
      fixed_count: row.fixed_count,
      false_positive_count: row.false_positive_count,
      not_relevant_count: row.not_relevant_count,
      trust_score: row.trust_score,
    };
  }

  return NextResponse.json(scoresByCheckId, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
