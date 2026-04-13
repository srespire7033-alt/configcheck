import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/get-user', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ createServiceClient: vi.fn() }));

import { GET, POST } from '@/app/api/usage/route';
import { getAuthUser } from '@/lib/auth/get-user';
import { createServiceClient } from '@/lib/db/client';

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockCreateServiceClient = vi.mocked(createServiceClient);

function createRequest(url = 'http://localhost/api/usage', options?: RequestInit) {
  return new NextRequest(url, options);
}

function createBuilder(mockResult: { data: unknown; error: unknown; count?: number }) {
  const builder: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(mockResult),
  };
  Object.defineProperty(builder, 'then', {
    value: (resolve: (v: unknown) => unknown) => Promise.resolve(mockResult).then(resolve),
    configurable: true,
  });
  return builder;
}

/**
 * Creates a mock supabase client where `from()` returns a different builder
 * each time it is called (for the 3 parallel queries in GET).
 */
function createFromSequence(builders: ReturnType<typeof createBuilder>[]) {
  let callIndex = 0;
  const fromFn = vi.fn().mockImplementation(() => {
    const b = builders[callIndex] || builders[builders.length - 1];
    callIndex++;
    return b;
  });
  return { from: fromFn } as any;
}

describe('GET /api/usage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 if not authenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null as any);

    const res = await GET(createRequest());
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns correct usage stats with data', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const totalBuilder = createBuilder({ data: null, error: null, count: 42 });
    const monthBuilder = createBuilder({ data: null, error: null, count: 7 });
    const byTypeBuilder = createBuilder({
      data: [
        { event_type: 'scan', created_at: '2026-04-10T10:00:00Z' },
        { event_type: 'scan', created_at: '2026-04-10T11:00:00Z' },
        { event_type: 'scan', created_at: '2026-04-12T09:00:00Z' },
        { event_type: 'pdf_report', created_at: '2026-04-11T14:00:00Z' },
        { event_type: 'ai_remediation', created_at: '2026-04-11T15:00:00Z' },
        { event_type: 'ai_scan_diff', created_at: '2026-04-12T08:00:00Z' },
        { event_type: 'ai_fix_suggestion', created_at: '2026-04-13T07:00:00Z' },
      ],
      error: null,
    });

    mockCreateServiceClient.mockReturnValue(
      createFromSequence([totalBuilder, monthBuilder, byTypeBuilder])
    );

    const res = await GET(createRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total_scans).toBe(42);
    expect(body.scans_this_month).toBe(7);
    expect(body.ai_calls_this_month).toBe(3); // ai_remediation + ai_scan_diff + ai_fix_suggestion
    expect(body.pdf_reports_this_month).toBe(1);
    expect(body.daily_scans).toEqual({
      '2026-04-10': 2,
      '2026-04-12': 1,
    });
    expect(body.event_counts.scan).toBe(3);
    expect(body.event_counts.pdf_report).toBe(1);
  });

  it('returns zeroed stats when no data exists', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const totalBuilder = createBuilder({ data: null, error: null, count: 0 });
    const monthBuilder = createBuilder({ data: null, error: null, count: 0 });
    const byTypeBuilder = createBuilder({ data: [], error: null });

    mockCreateServiceClient.mockReturnValue(
      createFromSequence([totalBuilder, monthBuilder, byTypeBuilder])
    );

    const res = await GET(createRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total_scans).toBe(0);
    expect(body.scans_this_month).toBe(0);
    expect(body.ai_calls_this_month).toBe(0);
    expect(body.pdf_reports_this_month).toBe(0);
    expect(body.daily_scans).toEqual({});
    expect(body.event_counts).toEqual({});
  });

  it('returns 0 counts when count fields are null', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const totalBuilder = createBuilder({ data: null, error: null, count: undefined });
    const monthBuilder = createBuilder({ data: null, error: null, count: undefined });
    const byTypeBuilder = createBuilder({ data: null, error: null });

    mockCreateServiceClient.mockReturnValue(
      createFromSequence([totalBuilder, monthBuilder, byTypeBuilder])
    );

    const res = await GET(createRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total_scans).toBe(0);
    expect(body.scans_this_month).toBe(0);
  });

  it('builds daily_scans only from scan events', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const byTypeBuilder = createBuilder({
      data: [
        { event_type: 'scan', created_at: '2026-04-10T10:00:00Z' },
        { event_type: 'pdf_report', created_at: '2026-04-10T12:00:00Z' },
        { event_type: 'ai_remediation', created_at: '2026-04-10T14:00:00Z' },
      ],
      error: null,
    });

    mockCreateServiceClient.mockReturnValue(
      createFromSequence([
        createBuilder({ data: null, error: null, count: 1 }),
        createBuilder({ data: null, error: null, count: 1 }),
        byTypeBuilder,
      ])
    );

    const res = await GET(createRequest());
    const body = await res.json();
    // daily_scans should only count 'scan' events, not pdf_report or ai_remediation
    expect(body.daily_scans).toEqual({ '2026-04-10': 1 });
  });
});

describe('POST /api/usage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 if not authenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null as any);

    const res = await POST(
      createRequest('http://localhost/api/usage', {
        method: 'POST',
        body: JSON.stringify({ event_type: 'pdf_report' }),
      })
    );
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 400 for invalid event_type', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const res = await POST(
      createRequest('http://localhost/api/usage', {
        method: 'POST',
        body: JSON.stringify({ event_type: 'invalid_type' }),
      })
    );
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Invalid event_type');
  });

  it('returns 400 when event_type is missing', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const res = await POST(
      createRequest('http://localhost/api/usage', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });

  it('logs event successfully and returns success: true', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const builder = createBuilder({ data: null, error: null });
    const fromFn = vi.fn().mockReturnValue(builder);
    mockCreateServiceClient.mockReturnValue({ from: fromFn } as any);

    const res = await POST(
      createRequest('http://localhost/api/usage', {
        method: 'POST',
        body: JSON.stringify({ event_type: 'pdf_report' }),
      })
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify insert was called with correct data
    expect(fromFn).toHaveBeenCalledWith('usage_logs');
    expect(builder.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      event_type: 'pdf_report',
      organization_id: null,
      metadata: {},
    });
  });

  it('accepts all valid event types', async () => {
    const validTypes = ['pdf_report', 'ai_remediation', 'ai_scan_diff', 'ai_fix_suggestion'];

    for (const eventType of validTypes) {
      vi.resetAllMocks();
      mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

      const builder = createBuilder({ data: null, error: null });
      mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(builder) } as any);

      const res = await POST(
        createRequest('http://localhost/api/usage', {
          method: 'POST',
          body: JSON.stringify({ event_type: eventType }),
        })
      );
      expect(res.status).toBe(200);
    }
  });

  it('passes organization_id and metadata when provided', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const builder = createBuilder({ data: null, error: null });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(builder) } as any);

    const res = await POST(
      createRequest('http://localhost/api/usage', {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'ai_remediation',
          organization_id: 'org-42',
          metadata: { issue_id: 'PR-001', severity: 'critical' },
        }),
      })
    );
    expect(res.status).toBe(200);

    expect(builder.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      event_type: 'ai_remediation',
      organization_id: 'org-42',
      metadata: { issue_id: 'PR-001', severity: 'critical' },
    });
  });

  it('defaults organization_id to null and metadata to {} when omitted', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const builder = createBuilder({ data: null, error: null });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(builder) } as any);

    await POST(
      createRequest('http://localhost/api/usage', {
        method: 'POST',
        body: JSON.stringify({ event_type: 'ai_scan_diff' }),
      })
    );

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: null,
        metadata: {},
      })
    );
  });
});
