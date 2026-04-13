import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/get-user', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ createServiceClient: vi.fn() }));
vi.mock('xlsx', () => ({
  utils: {
    book_new: () => ({ Sheets: {}, SheetNames: [] }),
    json_to_sheet: () => ({}),
    aoa_to_sheet: () => ({}),
    book_append_sheet: () => {},
    sheet_to_csv: () => 'col1,col2\nval1,val2',
  },
  write: () => Buffer.from('fake-xlsx'),
}));

import { GET } from '@/app/api/exports/route';
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
  Object.defineProperty(chain, 'then', {
    value: (resolve: any) => Promise.resolve(result).then(resolve),
    configurable: true,
  });
  return chain;
}

function createGetRequest(params: string) {
  return new NextRequest(new URL(`http://localhost:3000/api/exports?${params}`));
}

const mockScan = {
  id: 'scan-1',
  organization_id: 'org-1',
  status: 'completed',
  overall_score: 78,
  total_issues: 5,
  critical_count: 1,
  warning_count: 2,
  info_count: 2,
  category_scores: { price_rules: 65, products: 90 },
  summary: 'Test summary',
  completed_at: '2026-04-13T10:00:00Z',
  metadata: null,
};

const mockOrg = { id: 'org-1', name: 'Acme Corp' };

const mockIssues = [
  {
    id: 'issue-1',
    scan_id: 'scan-1',
    check_id: 'PR001',
    category: 'price_rules',
    severity: 'critical',
    title: 'Duplicate price rules',
    description: 'Found duplicate price rules',
    impact: 'Revenue leakage',
    recommendation: 'Remove duplicates',
    status: 'open',
    affected_records: [{ name: 'Rule A' }],
    revenue_impact: 50000,
    effort_hours: 4,
  },
  {
    id: 'issue-2',
    scan_id: 'scan-1',
    check_id: 'PR002',
    category: 'products',
    severity: 'warning',
    title: 'Inactive products in bundles',
    description: 'Bundles contain inactive products',
    impact: 'Quote errors',
    recommendation: 'Update bundles',
    status: 'open',
    affected_records: [],
    revenue_impact: null,
    effort_hours: 2,
  },
];

describe('GET /api/exports', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 if not authenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null as any);

    const res = await GET(createGetRequest('scanId=scan-1'));
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 400 if scanId is missing', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const res = await GET(createGetRequest('format=csv'));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('scanId is required');
  });

  it('returns 404 if scan not found', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const scanChain = createChainMock({ data: null, error: { message: 'Not found' } });
    mockCreateServiceClient.mockReturnValue({
      from: vi.fn().mockReturnValue(scanChain),
    } as any);

    const res = await GET(createGetRequest('scanId=nonexistent'));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Scan not found');
  });

  it('returns 403 if user does not own the organization', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const scanChain = createChainMock({ data: mockScan, error: null });
    const orgChain = createChainMock({ data: null, error: null });
    const issuesChain = createChainMock({ data: mockIssues, error: null });

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'scans') return scanChain;
      if (table === 'organizations') return orgChain;
      if (table === 'issues') return issuesChain;
      return createChainMock({ data: null, error: null });
    });
    mockCreateServiceClient.mockReturnValue({ from: fromFn } as any);

    const res = await GET(createGetRequest('scanId=scan-1'));
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('generates XLSX export by default with correct Content-Type', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const scanChain = createChainMock({ data: mockScan, error: null });
    const orgChain = createChainMock({ data: mockOrg, error: null });
    const issuesChain = createChainMock({ data: mockIssues, error: null });

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'scans') return scanChain;
      if (table === 'organizations') return orgChain;
      if (table === 'issues') return issuesChain;
      return createChainMock({ data: null, error: null });
    });
    mockCreateServiceClient.mockReturnValue({ from: fromFn } as any);

    const res = await GET(createGetRequest('scanId=scan-1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.headers.get('Content-Disposition')).toContain('.xlsx');
  });

  it('generates CSV export when format=csv', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const scanChain = createChainMock({ data: mockScan, error: null });
    const orgChain = createChainMock({ data: mockOrg, error: null });
    const issuesChain = createChainMock({ data: mockIssues, error: null });

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'scans') return scanChain;
      if (table === 'organizations') return orgChain;
      if (table === 'issues') return issuesChain;
      return createChainMock({ data: null, error: null });
    });
    mockCreateServiceClient.mockReturnValue({ from: fromFn } as any);

    const res = await GET(createGetRequest('scanId=scan-1&format=csv'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('.csv');

    const text = await res.text();
    expect(text).toContain('col1,col2');
  });

  it('generates documentation export when type=documentation', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const scanChain = createChainMock({ data: mockScan, error: null });
    const orgChain = createChainMock({ data: mockOrg, error: null });
    const issuesChain = createChainMock({ data: mockIssues, error: null });

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'scans') return scanChain;
      if (table === 'organizations') return orgChain;
      if (table === 'issues') return issuesChain;
      return createChainMock({ data: null, error: null });
    });
    mockCreateServiceClient.mockReturnValue({ from: fromFn } as any);

    const res = await GET(createGetRequest('scanId=scan-1&type=documentation'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.headers.get('Content-Disposition')).toContain('CPQ-Documentation');
  });

  it('generates documentation as CSV when type=documentation and format=csv', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const scanChain = createChainMock({ data: mockScan, error: null });
    const orgChain = createChainMock({ data: mockOrg, error: null });
    const issuesChain = createChainMock({ data: mockIssues, error: null });

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'scans') return scanChain;
      if (table === 'organizations') return orgChain;
      if (table === 'issues') return issuesChain;
      return createChainMock({ data: null, error: null });
    });
    mockCreateServiceClient.mockReturnValue({ from: fromFn } as any);

    const res = await GET(createGetRequest('scanId=scan-1&type=documentation&format=csv'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('CPQ-Documentation');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetAuthUser.mockRejectedValue(new Error('Unexpected failure'));

    const res = await GET(createGetRequest('scanId=scan-1'));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Export failed');
  });

  it('includes org name in the export filename', async () => {
    mockGetAuthUser.mockResolvedValue({ id: 'user-1' } as any);

    const scanChain = createChainMock({ data: mockScan, error: null });
    const orgChain = createChainMock({ data: { id: 'org-1', name: 'Test Org' }, error: null });
    const issuesChain = createChainMock({ data: [], error: null });

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'scans') return scanChain;
      if (table === 'organizations') return orgChain;
      if (table === 'issues') return issuesChain;
      return createChainMock({ data: null, error: null });
    });
    mockCreateServiceClient.mockReturnValue({ from: fromFn } as any);

    const res = await GET(createGetRequest('scanId=scan-1'));
    expect(res.headers.get('Content-Disposition')).toContain('Test-Org');
  });
});
