import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth/get-user';
import { generateExplanation } from '@/lib/ai/gemini';

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

    const explanation = await generateExplanation({
      title,
      description,
      impact,
      checkId,
      category,
      severity,
    });

    return NextResponse.json({ explanation });
  } catch (error) {
    console.error('AI explain error:', error);
    return NextResponse.json({ error: 'Failed to generate explanation' }, { status: 500 });
  }
}
