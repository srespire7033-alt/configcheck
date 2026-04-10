import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth/get-user';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

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

    const prompt = `You are explaining a Salesforce CPQ configuration issue to someone who is NOT a CPQ expert — they might be a VP of Sales, CFO, or RevOps manager.

## Issue Details
- Check ID: ${checkId}
- Category: ${category}
- Severity: ${severity}
- Title: ${title}
- Technical Description: ${description}
- Business Impact: ${impact}

Explain this in 3 short sections:

**What's happening:** Explain in plain English what this issue means. No jargon. Use analogies if helpful. 2-3 sentences max.

**Why it matters:** Explain the business impact — money, time, or risk. Be specific. 2-3 sentences max.

**What to do:** One clear action item. Not technical steps — just the decision or directive. 1-2 sentences.

Keep it concise. Write like you're explaining to a smart person who doesn't know Salesforce internals.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: 'You explain technical Salesforce CPQ issues in plain, non-technical English for business stakeholders. Be concise, specific, and jargon-free.',
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    return NextResponse.json({ explanation: textBlock?.text || 'Unable to generate explanation.' });
  } catch (error) {
    console.error('AI explain error:', error);
    return NextResponse.json({ error: 'Failed to generate explanation' }, { status: 500 });
  }
}
