import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/get-user', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ createServiceClient: vi.fn() }));

import { GET } from '@/app/api/orgs/route';
import { getAuthUser } from '@/lib/auth/get-user';
import { createServiceClient } from '@/lib/db/client';

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockCreateServiceClient = vi.mocked(createServiceClient);

function createRequest(url = 'http://localhost/api/orgs') {
  return new NextRequest(url);
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

describe('GET /api/orgs', () => {
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

  it('returns a single org when orgId is provided', async () => {
    const orgData = { id: 'org-1', name: 'Acme Corp', user_id: 'user-1' };
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const builder = createBuilder({ data: orgData, error: null });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(builder) } as any);

    const res = await GET(createRequest('http://localhost/api/orgs?orgId=org-1'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe('org-1');
    expect(body.name).toBe('Acme Corp');
  });

  it('returns 404 when orgId is provided but org not found', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const builder = createBuilder({ data: null, error: { message: 'Not found' } });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(builder) } as any);

    const res = await GET(createRequest('http://localhost/api/orgs?orgId=nonexistent'));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Organization not found');
  });

  it('returns 404 when orgId query returns data=null and no error', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const builder = createBuilder({ data: null, error: null });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(builder) } as any);

    const res = await GET(createRequest('http://localhost/api/orgs?orgId=org-999'));
    expect(res.status).toBe(404);
  });

  it('returns list of all user orgs ordered by created_at desc with critical_count: 0', async () => {
    const orgsData = [
      { id: 'org-2', name: 'Beta Inc', is_sandbox: false, connection_status: 'connected', last_scan_score: 85, last_scan_at: '2026-04-12', cpq_package_version: '240.1' },
      { id: 'org-1', name: 'Alpha LLC', is_sandbox: true, connection_status: 'connected', last_scan_score: 72, last_scan_at: '2026-04-10', cpq_package_version: '238.5' },
    ];
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const builder = createBuilder({ data: orgsData, error: null });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(builder) } as any);

    const res = await GET(createRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('org-2');
    expect(body[0].critical_count).toBe(0);
    expect(body[1].critical_count).toBe(0);
  });

  it('returns empty array when user has no orgs', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const builder = createBuilder({ data: [], error: null });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(builder) } as any);

    const res = await GET(createRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns 500 when database query fails for org list', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const builder = createBuilder({ data: null, error: { message: 'DB connection failed' } });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(builder) } as any);

    const res = await GET(createRequest());
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to fetch organizations');
  });

  it('returns empty array when data is null but no error for org list', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const builder = createBuilder({ data: null, error: null });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(builder) } as any);

    const res = await GET(createRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual([]);
  });
});
