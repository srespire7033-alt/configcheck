import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth/get-user';
import { generateExplanation } from '@/lib/ai/gemini';
import { throttleAi } from '@/lib/ai/throttle';
import { track } from '@/lib/analytics/track-server';
import { AnalyticsEvent } from '@/lib/analytics/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/explain
 * Generate a plain-English explanation of what an issue means and why it matters
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { title, description, impact, checkId, category, severity } = await request.json();

    if (!title || !description) {
      return NextResponse.json({ error: 'title and description are required' }, { status: 400 });
    }

    // Server-side throttle keeps bursts within Gemini free-tier 10 RPM.
    await throttleAi(user.id);
    const explanation = await generateExplanation({
      title,
      description,
      impact,
      checkId,
      category,
      severity,
    });

    void track(AnalyticsEvent.AI_EXPLAIN_USED, {
      userId: user.id,
      properties: { check_id: checkId ?? null, category: category ?? null, severity: severity ?? null },
    });
    return NextResponse.json({ explanation });
  } catch (error) {
    console.error('AI explain error:', error);
    return NextResponse.json({ error: 'Failed to generate explanation' }, { status: 500 });
  }
}
