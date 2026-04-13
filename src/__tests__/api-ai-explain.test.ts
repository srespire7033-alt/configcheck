import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/get-user', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/ai/gemini', () => ({ generateExplanation: vi.fn() }));

import { getAuthUser } from '@/lib/auth/get-user';
import { generateExplanation } from '@/lib/ai/gemini';
import { POST } from '@/app/api/ai/explain/route';

const mockUser = { id: 'user-123', email: 'maulik@example.com' };

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/ai/explain', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('/api/ai/explain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if not authenticated', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await POST(makeRequest({ title: 'Test', description: 'Desc' }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 400 if title is missing', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

    const res = await POST(makeRequest({ description: 'Some description' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('title and description are required');
  });

  it('returns 400 if description is missing', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

    const res = await POST(makeRequest({ title: 'Some title' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('title and description are required');
  });

  it('returns explanation on success', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    (generateExplanation as ReturnType<typeof vi.fn>).mockResolvedValue(
      'This issue means your pricing rules may conflict.'
    );

    const res = await POST(
      makeRequest({
        title: 'Conflicting Price Rules',
        description: 'Two rules target the same product',
        impact: 'High',
        checkId: 'CHK-001',
        category: 'Pricing',
        severity: 'critical',
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.explanation).toBe('This issue means your pricing rules may conflict.');
    expect(generateExplanation).toHaveBeenCalledWith({
      title: 'Conflicting Price Rules',
      description: 'Two rules target the same product',
      impact: 'High',
      checkId: 'CHK-001',
      category: 'Pricing',
      severity: 'critical',
    });
  });

  it('passes optional fields as undefined when not provided', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    (generateExplanation as ReturnType<typeof vi.fn>).mockResolvedValue('Explanation text');

    const res = await POST(makeRequest({ title: 'Title', description: 'Desc' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.explanation).toBe('Explanation text');
    expect(generateExplanation).toHaveBeenCalledWith({
      title: 'Title',
      description: 'Desc',
      impact: undefined,
      checkId: undefined,
      category: undefined,
      severity: undefined,
    });
  });

  it('returns 500 on AI error', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    (generateExplanation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Gemini API failed')
    );

    const res = await POST(
      makeRequest({ title: 'Test', description: 'Test desc' })
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to generate explanation');
  });
});
