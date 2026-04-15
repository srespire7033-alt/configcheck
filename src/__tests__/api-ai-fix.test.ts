import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/get-user', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ createServiceClient: vi.fn() }));
vi.mock('@/lib/ai/gemini', () => ({ generateFixSuggestion: vi.fn() }));
vi.mock('@/lib/quota', () => ({
  checkQuota: vi.fn().mockResolvedValue({ allowed: true, limit: null, used: 0, remaining: null, resetDate: 'May 1, 2026', isAdmin: false }),
}));

import { getAuthUser } from '@/lib/auth/get-user';
import { createServiceClient } from '@/lib/db/client';
import { generateFixSuggestion } from '@/lib/ai/gemini';
import { POST } from '@/app/api/ai/fix/route';

const mockUser = { id: 'user-123', email: 'maulik@example.com' };

const mockIssue = {
  id: 'issue-456',
  check_id: 'CHK-001',
  category: 'Pricing',
  severity: 'critical',
  title: 'Conflicting Price Rules',
  description: 'Two rules target the same product',
  impact: 'Incorrect pricing for end users',
  recommendation: 'Remove the duplicate rule',
  affected_records: ['PriceRule-A', 'PriceRule-B'],
};

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/ai/fix', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('/api/ai/fix', () => {
  let mockSingle: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockFrom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSingle = vi.fn();
    mockEq = vi.fn().mockReturnValue({ single: mockSingle, eq: vi.fn().mockReturnValue({ single: mockSingle }) });
    mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    mockFrom = vi.fn().mockReturnValue({ select: mockSelect, update: mockUpdate });
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });
  });

  it('returns 401 if not authenticated', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await POST(makeRequest({ issueId: 'issue-456' }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 400 if issueId is missing', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('issueId is required');
  });

  it('returns 404 if issue not found in DB', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    mockSingle.mockResolvedValue({ data: null, error: { message: 'Not found' } });

    const res = await POST(makeRequest({ issueId: 'nonexistent-id' }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Issue not found');
  });

  it('returns 404 when DB returns no data and no error', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    mockSingle.mockResolvedValue({ data: null, error: null });

    const res = await POST(makeRequest({ issueId: 'issue-456' }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Issue not found');
  });

  it('returns suggestion on success and saves to DB', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    mockSingle.mockResolvedValue({ data: mockIssue, error: null });
    (generateFixSuggestion as ReturnType<typeof vi.fn>).mockResolvedValue(
      'Delete PriceRule-B and keep PriceRule-A as the canonical rule.'
    );
    // The update chain returns after .eq()
    mockEq.mockReturnValue({ single: mockSingle });

    const res = await POST(makeRequest({ issueId: 'issue-456' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.suggestion).toBe('Delete PriceRule-B and keep PriceRule-A as the canonical rule.');
    expect(generateFixSuggestion).toHaveBeenCalledWith({
      check_id: mockIssue.check_id,
      category: mockIssue.category,
      severity: mockIssue.severity,
      title: mockIssue.title,
      description: mockIssue.description,
      impact: mockIssue.impact,
      recommendation: mockIssue.recommendation,
      affected_records: mockIssue.affected_records,
    });
    // Verify it saved to DB
    expect(mockFrom).toHaveBeenCalledWith('issues');
    expect(mockUpdate).toHaveBeenCalledWith({
      ai_fix_suggestion: 'Delete PriceRule-B and keep PriceRule-A as the canonical rule.',
    });
  });

  it('returns 503 when AI service is overloaded', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    mockSingle.mockResolvedValue({ data: mockIssue, error: null });

    const aiError = new Error('Service overloaded');
    (aiError as any).status = 503;
    (generateFixSuggestion as ReturnType<typeof vi.fn>).mockRejectedValue(aiError);

    const res = await POST(makeRequest({ issueId: 'issue-456' }));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toBe('AI service is temporarily overloaded. Please try again in a few seconds.');
  });

  it('returns 500 on general AI error', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    mockSingle.mockResolvedValue({ data: mockIssue, error: null });
    (generateFixSuggestion as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Model quota exceeded')
    );

    const res = await POST(makeRequest({ issueId: 'issue-456' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to generate AI fix suggestion. Please try again.');
  });

  it('returns 500 with error message on unexpected outer error', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Auth service down')
    );

    const res = await POST(makeRequest({ issueId: 'issue-456' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Auth service down');
  });
});
