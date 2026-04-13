import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/issues/route';

vi.mock('@/lib/auth/get-user', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ createServiceClient: vi.fn() }));

import { getAuthUser } from '@/lib/auth/get-user';
import { createServiceClient } from '@/lib/db/client';

const mockedGetAuthUser = vi.mocked(getAuthUser);
const mockedCreateServiceClient = vi.mocked(createServiceClient);

/**
 * Creates a chainable Supabase query builder mock.
 * Every method returns the builder itself so chains resolve to { data, error }.
 */
function createQueryBuilder(resolvedValue: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const methods = ['from', 'select', 'eq', 'single', 'order', 'update'];

  for (const method of methods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }

  // The chain is also a thenable so `await query` resolves to { data, error }.
  // Supabase PostgREST builder uses `.then()` under the hood.
  builder.then = (resolve: (val: unknown) => void) => {
    return Promise.resolve(resolvedValue).then(resolve);
  };

  // Allow direct property access for destructuring { data, error }
  Object.defineProperty(builder, 'data', { get: () => resolvedValue.data });
  Object.defineProperty(builder, 'error', { get: () => resolvedValue.error });

  return builder as ReturnType<typeof createServiceClient> & Record<string, ReturnType<typeof vi.fn>>;
}

function makeGetRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/issues');
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url);
}

function makePutRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/issues', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/issues
// ---------------------------------------------------------------------------
describe('GET /api/issues', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetAuthUser.mockResolvedValue(null as never);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when no params provided', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const qb = createQueryBuilder({ data: null, error: null });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'scanId or issueId required' });
  });

  it('returns single issue by issueId', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const issue = { id: 'issue-1', title: 'Test Issue', severity: 'high' };
    const qb = createQueryBuilder({ data: issue, error: null });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await GET(makeGetRequest({ issueId: 'issue-1' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(issue);
    expect(qb.from).toHaveBeenCalledWith('issues');
    expect(qb.select).toHaveBeenCalledWith('*');
    expect(qb.eq).toHaveBeenCalledWith('id', 'issue-1');
    expect(qb.single).toHaveBeenCalled();
  });

  it('returns 404 for non-existent issueId', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const qb = createQueryBuilder({ data: null, error: { message: 'not found' } });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await GET(makeGetRequest({ issueId: 'nonexistent' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Issue not found' });
  });

  it('returns 404 when issueId query returns no data', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const qb = createQueryBuilder({ data: null, error: null });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await GET(makeGetRequest({ issueId: 'missing' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Issue not found' });
  });

  it('returns issues for a scanId', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const issues = [
      { id: 'issue-1', scan_id: 'scan-1', severity: 'high' },
      { id: 'issue-2', scan_id: 'scan-1', severity: 'low' },
    ];
    const qb = createQueryBuilder({ data: issues, error: null });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await GET(makeGetRequest({ scanId: 'scan-1' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(issues);
    expect(qb.from).toHaveBeenCalledWith('issues');
    expect(qb.select).toHaveBeenCalledWith('*');
    expect(qb.eq).toHaveBeenCalledWith('scan_id', 'scan-1');
    expect(qb.order).toHaveBeenCalledWith('severity', { ascending: true });
    expect(qb.order).toHaveBeenCalledWith('category', { ascending: true });
  });

  it('filters by severity', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const issues = [{ id: 'issue-1', severity: 'high' }];
    const qb = createQueryBuilder({ data: issues, error: null });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await GET(makeGetRequest({ scanId: 'scan-1', severity: 'high' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(issues);
    expect(qb.eq).toHaveBeenCalledWith('severity', 'high');
  });

  it('filters by category', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const issues = [{ id: 'issue-1', category: 'pricing' }];
    const qb = createQueryBuilder({ data: issues, error: null });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await GET(makeGetRequest({ scanId: 'scan-1', category: 'pricing' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(issues);
    expect(qb.eq).toHaveBeenCalledWith('category', 'pricing');
  });

  it('filters by status', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const issues = [{ id: 'issue-1', status: 'open' }];
    const qb = createQueryBuilder({ data: issues, error: null });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await GET(makeGetRequest({ scanId: 'scan-1', status: 'open' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(issues);
    expect(qb.eq).toHaveBeenCalledWith('status', 'open');
  });

  it('skips filter when severity is "all"', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const qb = createQueryBuilder({ data: [], error: null });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    await GET(makeGetRequest({ scanId: 'scan-1', severity: 'all' }));

    // eq should be called for scan_id but NOT for severity='all'
    const eqCalls = qb.eq.mock.calls.map((c: unknown[]) => c[0]);
    expect(eqCalls).toContain('scan_id');
    expect(eqCalls).not.toContain('severity');
  });

  it('returns 500 on DB error for scanId query', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const qb = createQueryBuilder({ data: null, error: { message: 'db failure' } });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await GET(makeGetRequest({ scanId: 'scan-1' }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to fetch issues' });
  });
});

// ---------------------------------------------------------------------------
// PUT /api/issues
// ---------------------------------------------------------------------------
describe('PUT /api/issues', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetAuthUser.mockResolvedValue(null as never);

    const res = await PUT(makePutRequest({ issueId: 'issue-1', status: 'resolved' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when no issueId', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const res = await PUT(makePutRequest({ status: 'resolved' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'issueId is required' });
  });

  it('updates issue status', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const qb = createQueryBuilder({ data: null, error: null });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await PUT(makePutRequest({ issueId: 'issue-1', status: 'acknowledged' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(qb.from).toHaveBeenCalledWith('issues');
    expect(qb.update).toHaveBeenCalledWith({ status: 'acknowledged' });
    expect(qb.eq).toHaveBeenCalledWith('id', 'issue-1');
  });

  it('sets resolved_at when status is "resolved"', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const qb = createQueryBuilder({ data: null, error: null });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const before = new Date().toISOString();
    const res = await PUT(makePutRequest({ issueId: 'issue-1', status: 'resolved' }));
    const after = new Date().toISOString();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const updateCall = qb.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateCall.status).toBe('resolved');
    expect(updateCall.resolved_at).toBeDefined();
    // Verify the timestamp is between before and after
    expect(updateCall.resolved_at as string >= before).toBe(true);
    expect(updateCall.resolved_at as string <= after).toBe(true);
  });

  it('updates issue notes', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const qb = createQueryBuilder({ data: null, error: null });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await PUT(makePutRequest({ issueId: 'issue-1', notes: 'Fixed in Sprint 3' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(qb.update).toHaveBeenCalledWith({ notes: 'Fixed in Sprint 3' });
  });

  it('returns 500 on DB error', async () => {
    mockedGetAuthUser.mockResolvedValue({ id: 'user-1' } as never);

    const qb = createQueryBuilder({ data: null, error: { message: 'update failed' } });
    mockedCreateServiceClient.mockReturnValue(qb as never);

    const res = await PUT(makePutRequest({ issueId: 'issue-1', status: 'resolved' }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to update issue' });
  });
});
