import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/get-user', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ createServiceClient: vi.fn() }));
vi.mock('@/lib/salesforce/client', () => ({ createRefreshableConnection: vi.fn() }));
vi.mock('@/lib/salesforce/queries', () => ({ fetchAllCPQData: vi.fn() }));
vi.mock('@/lib/analysis/engine', () => ({ runAnalysis: vi.fn() }));
vi.mock('@/lib/ai/gemini', () => ({ generateExecutiveSummary: vi.fn() }));
vi.mock('@/lib/email/notifications', () => ({ sendScanNotification: vi.fn() }));

import { GET, POST } from '@/app/api/scans/route';
import { getAuthUser } from '@/lib/auth/get-user';
import { createServiceClient } from '@/lib/db/client';

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockCreateServiceClient = vi.mocked(createServiceClient);

function createChainMock(result: { data: any; error: any }) {
  const chain: any = {};
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'gte', 'order', 'limit']) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  // Make thenable for non-single queries
  Object.defineProperty(chain, 'then', {
    value: (resolve: any) => Promise.resolve(result).then(resolve),
    configurable: true,
  });
  return chain;
}

function createPostRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/scans', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createGetRequest(params?: string) {
  const url = params
    ? `http://localhost:3000/api/scans?${params}`
    : 'http://localhost:3000/api/scans';
  return new NextRequest(url);
}

describe('POST /api/scans', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 if not authenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null as any);

    const res = await POST(createPostRequest({ organizationId: 'org-1' }));
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 400 if organizationId is missing', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const res = await POST(createPostRequest({}));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('organizationId is required');
  });

  it('returns 404 if organization not found (ownership check fails)', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const orgChain = createChainMock({ data: null, error: { message: 'Not found' } });
    mockCreateServiceClient.mockReturnValue({
      from: vi.fn().mockReturnValue(orgChain),
    } as any);

    const res = await POST(createPostRequest({ organizationId: 'org-999' }));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Organization not found');
  });

  it('returns 404 when org data is null without error', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const orgChain = createChainMock({ data: null, error: null });
    mockCreateServiceClient.mockReturnValue({
      from: vi.fn().mockReturnValue(orgChain),
    } as any);

    const res = await POST(createPostRequest({ organizationId: 'org-999' }));
    expect(res.status).toBe(404);
  });

  it('verifies org ownership by querying with both org id and user id', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const orgChain = createChainMock({ data: null, error: { message: 'Not found' } });
    const fromFn = vi.fn().mockReturnValue(orgChain);
    mockCreateServiceClient.mockReturnValue({ from: fromFn } as any);

    await POST(createPostRequest({ organizationId: 'org-1' }));

    expect(fromFn).toHaveBeenCalledWith('organizations');
    expect(orgChain.eq).toHaveBeenCalledWith('id', 'org-1');
    expect(orgChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('returns 500 if scan insert fails', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const orgData = { id: 'org-1', name: 'Acme Corp', user_id: 'user-1' };
    const orgChain = createChainMock({ data: orgData, error: null });
    const scanChain = createChainMock({ data: null, error: { message: 'Insert failed' } });

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'organizations') return orgChain;
      if (table === 'scans') return scanChain;
      return createChainMock({ data: null, error: null });
    });
    mockCreateServiceClient.mockReturnValue({ from: fromFn } as any);

    const res = await POST(createPostRequest({ organizationId: 'org-1' }));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to create scan');
  });

  it('creates scan in pending status and returns scanId', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const orgData = { id: 'org-1', name: 'Acme Corp', user_id: 'user-1' };
    const scanData = { id: 'scan-123', status: 'pending', organization_id: 'org-1' };
    const orgChain = createChainMock({ data: orgData, error: null });
    const scanChain = createChainMock({ data: scanData, error: null });

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'organizations') return orgChain;
      if (table === 'scans') return scanChain;
      return createChainMock({ data: null, error: null });
    });
    mockCreateServiceClient.mockReturnValue({ from: fromFn } as any);

    const res = await POST(createPostRequest({ organizationId: 'org-1' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.scanId).toBe('scan-123');
    expect(body.status).toBe('pending');
  });

  it('inserts scan record with correct fields', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const orgData = { id: 'org-1', name: 'Acme Corp', user_id: 'user-1' };
    const scanData = { id: 'scan-123', status: 'pending' };
    const orgChain = createChainMock({ data: orgData, error: null });
    const scanChain = createChainMock({ data: scanData, error: null });

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'organizations') return orgChain;
      if (table === 'scans') return scanChain;
      return createChainMock({ data: null, error: null });
    });
    mockCreateServiceClient.mockReturnValue({ from: fromFn } as any);

    await POST(createPostRequest({ organizationId: 'org-1' }));

    expect(scanChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        user_id: 'user-1',
        status: 'pending',
        scan_type: 'full',
      })
    );
    expect(scanChain.select).toHaveBeenCalled();
    expect(scanChain.single).toHaveBeenCalled();
  });
});

describe('GET /api/scans', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns single scan when scanId is provided', async () => {
    const scanData = { id: 'scan-1', status: 'completed', overall_score: 85 };
    const chain = createChainMock({ data: scanData, error: null });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(chain) } as any);

    const res = await GET(createGetRequest('scanId=scan-1'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe('scan-1');
    expect(body.overall_score).toBe(85);
  });

  it('returns 404 when scanId not found', async () => {
    const chain = createChainMock({ data: null, error: { message: 'Not found' } });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(chain) } as any);

    const res = await GET(createGetRequest('scanId=nonexistent'));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Scan not found');
  });

  it('returns list of scans when orgId is provided', async () => {
    const scansData = [
      { id: 'scan-2', status: 'completed', created_at: '2026-04-13' },
      { id: 'scan-1', status: 'completed', created_at: '2026-04-12' },
    ];
    const chain = createChainMock({ data: scansData, error: null });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(chain) } as any);

    const res = await GET(createGetRequest('orgId=org-1'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('scan-2');

    // Verify ordering and limit were applied
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  it('returns 400 when no params provided', async () => {
    const res = await GET(createGetRequest());
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('scanId or orgId required');
  });

  it('returns 500 when orgId query fails with error', async () => {
    const chain = createChainMock({ data: null, error: { message: 'DB error' } });
    mockCreateServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue(chain) } as any);

    const res = await GET(createGetRequest('orgId=org-1'));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to fetch scans');
  });
});
