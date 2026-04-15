import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/get-user', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ createServiceClient: vi.fn() }));
vi.mock('@/lib/ai/gemini', () => ({
  generateScanDiffInsights: vi.fn(),
  generateRemediationPlan: vi.fn(),
}));
vi.mock('@/lib/quota', () => ({
  checkQuota: vi.fn().mockResolvedValue({ allowed: true, limit: null, used: 0, remaining: null, resetDate: 'May 1, 2026', isAdmin: false }),
}));

import { getAuthUser } from '@/lib/auth/get-user';
import { createServiceClient } from '@/lib/db/client';
import { generateScanDiffInsights, generateRemediationPlan } from '@/lib/ai/gemini';
import { POST } from '@/app/api/ai/insights/route';

const mockUser = { id: 'user-123', email: 'maulik@example.com' };

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/ai/insights', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('/api/ai/insights', () => {
  let mockSingle: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockInsert: ReturnType<typeof vi.fn>;
  let mockFrom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSingle = vi.fn();
    mockEq = vi.fn().mockReturnValue({ single: mockSingle, eq: vi.fn().mockReturnValue({ single: mockSingle }) });
    mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    mockInsert = vi.fn().mockReturnValue({ then: vi.fn((cb: any) => cb()) });
    mockFrom = vi.fn().mockReturnValue({
      select: mockSelect,
      update: mockUpdate,
      insert: mockInsert,
    });
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });
  });

  // ---- Auth ----

  it('returns 401 if not authenticated', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await POST(makeRequest({ type: 'scan-diff' }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
  });

  // ---- Invalid type ----

  it('returns 400 for invalid type', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

    const res = await POST(makeRequest({ type: 'invalid-type' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid type. Use "scan-diff" or "remediation-plan".');
  });

  it('returns 400 when type is missing', async () => {
    (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid type. Use "scan-diff" or "remediation-plan".');
  });

  // ---- scan-diff ----

  describe('type=scan-diff', () => {
    const scanDiffBody = {
      type: 'scan-diff',
      prevScore: 72,
      newScore: 85,
      newIssues: [{ title: 'New issue' }],
      resolvedIssues: [{ title: 'Fixed issue' }],
      unchangedCount: 5,
      scanAId: 'scan-aaa',
      scanBId: 'scan-bbb',
    };

    it('returns cached result when cache hit', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockSingle.mockResolvedValue({
        data: { ai_scan_diff_cache: { 'scan-aaa_scan-bbb': 'Cached diff insight' } },
        error: null,
      });

      const res = await POST(makeRequest(scanDiffBody));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.insight).toBe('Cached diff insight');
      expect(json.cached).toBe(true);
      expect(generateScanDiffInsights).not.toHaveBeenCalled();
    });

    it('generates and caches insight on cache miss', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      // First call: cache lookup returns empty cache
      // Second call: read existing cache before saving
      mockSingle
        .mockResolvedValueOnce({ data: { ai_scan_diff_cache: {} }, error: null })
        .mockResolvedValueOnce({ data: { ai_scan_diff_cache: {} }, error: null });

      (generateScanDiffInsights as ReturnType<typeof vi.fn>).mockResolvedValue(
        'Score improved from 72 to 85. 1 new issue, 1 resolved.'
      );

      const res = await POST(makeRequest(scanDiffBody));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.insight).toBe('Score improved from 72 to 85. 1 new issue, 1 resolved.');
      expect(json.cached).toBeUndefined();
      expect(generateScanDiffInsights).toHaveBeenCalledWith(
        72, 85,
        [{ title: 'New issue' }],
        [{ title: 'Fixed issue' }],
        5
      );
      // Verify it saves to cache
      expect(mockUpdate).toHaveBeenCalledWith({
        ai_scan_diff_cache: { 'scan-aaa_scan-bbb': 'Score improved from 72 to 85. 1 new issue, 1 resolved.' },
      });
    });

    it('generates insight without caching when no scan IDs provided', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      (generateScanDiffInsights as ReturnType<typeof vi.fn>).mockResolvedValue('Diff insight no cache');

      const res = await POST(
        makeRequest({
          type: 'scan-diff',
          prevScore: 60,
          newScore: 70,
          newIssues: [],
          resolvedIssues: [],
          unchangedCount: 3,
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.insight).toBe('Diff insight no cache');
      // No cache lookup or save attempted
      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('returns 503 when AI service is overloaded', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockSingle.mockResolvedValue({ data: { ai_scan_diff_cache: {} }, error: null });

      const aiError = new Error('Overloaded');
      (aiError as any).status = 503;
      (generateScanDiffInsights as ReturnType<typeof vi.fn>).mockRejectedValue(aiError);

      const res = await POST(makeRequest(scanDiffBody));
      const json = await res.json();

      expect(res.status).toBe(503);
      expect(json.error).toBe('AI service is temporarily overloaded. Please try again in a few seconds.');
    });

    it('returns 500 on general AI error', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockSingle.mockResolvedValue({ data: { ai_scan_diff_cache: {} }, error: null });
      (generateScanDiffInsights as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API key invalid')
      );

      const res = await POST(makeRequest(scanDiffBody));
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to generate drift analysis.');
    });
  });

  // ---- remediation-plan ----

  describe('type=remediation-plan', () => {
    const remediationBody = {
      type: 'remediation-plan',
      issues: [
        { title: 'Missing approval', severity: 'critical' },
        { title: 'Unused price rule', severity: 'low' },
      ],
      overallScore: 65,
      scanId: 'scan-xyz',
    };

    it('returns cached plan when cache hit', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockSingle.mockResolvedValue({
        data: { ai_remediation_plan: 'Cached remediation plan content' },
        error: null,
      });

      const res = await POST(makeRequest(remediationBody));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.plan).toBe('Cached remediation plan content');
      expect(json.cached).toBe(true);
      expect(generateRemediationPlan).not.toHaveBeenCalled();
    });

    it('generates and caches plan on cache miss', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockSingle.mockResolvedValue({ data: { ai_remediation_plan: null }, error: null });
      (generateRemediationPlan as ReturnType<typeof vi.fn>).mockResolvedValue(
        'Step 1: Fix critical issues first. Step 2: Clean up unused rules.'
      );

      const res = await POST(makeRequest(remediationBody));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.plan).toBe('Step 1: Fix critical issues first. Step 2: Clean up unused rules.');
      expect(json.cached).toBeUndefined();
      expect(generateRemediationPlan).toHaveBeenCalledWith(
        remediationBody.issues,
        65
      );
      // Verify it saves to cache
      expect(mockUpdate).toHaveBeenCalledWith({
        ai_remediation_plan: 'Step 1: Fix critical issues first. Step 2: Clean up unused rules.',
      });
    });

    it('generates plan without caching when no scanId provided', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      (generateRemediationPlan as ReturnType<typeof vi.fn>).mockResolvedValue('Plan without cache');

      const res = await POST(
        makeRequest({
          type: 'remediation-plan',
          issues: [{ title: 'Issue' }],
          overallScore: 50,
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.plan).toBe('Plan without cache');
      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('returns 503 when AI service is overloaded', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockSingle.mockResolvedValue({ data: { ai_remediation_plan: null }, error: null });

      const aiError = new Error('Overloaded');
      (aiError as any).status = 503;
      (generateRemediationPlan as ReturnType<typeof vi.fn>).mockRejectedValue(aiError);

      const res = await POST(makeRequest(remediationBody));
      const json = await res.json();

      expect(res.status).toBe(503);
      expect(json.error).toBe('AI service is temporarily overloaded. Please try again in a few seconds.');
    });

    it('returns 500 on general AI error for remediation', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockSingle.mockResolvedValue({ data: { ai_remediation_plan: null }, error: null });
      (generateRemediationPlan as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Token limit exceeded')
      );

      const res = await POST(makeRequest(remediationBody));
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to generate remediation plan.');
    });
  });
});
