/**
 * Shared test utilities for API route testing.
 * Provides mock factories for Supabase, auth, and NextRequest.
 */
import { vi } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mock User ───
export const MOCK_USER = {
  id: 'user-123',
  email: 'test@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2024-01-01T00:00:00Z',
};

// ─── Chainable Supabase Query Mock ───
export interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  _result: { data: unknown; error: unknown; count?: number };
}

export function createMockQueryBuilder(result?: { data?: unknown; error?: unknown; count?: number }): MockQueryBuilder {
  const defaultResult = { data: null, error: null, count: 0, ...result };

  const builder: MockQueryBuilder = {
    _result: defaultResult,
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    single: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  // Make all methods chainable, returning the builder
  for (const key of ['select', 'insert', 'update', 'delete', 'eq', 'gte', 'order', 'limit'] as const) {
    builder[key].mockReturnValue(builder);
  }
  // single() resolves the chain
  builder.single.mockReturnValue(Promise.resolve(defaultResult));

  // Make the builder itself thenable (for queries without .single())
  (builder as unknown as Record<string, unknown>).then = (resolve: (val: unknown) => void) => {
    return Promise.resolve(defaultResult).then(resolve);
  };

  return builder;
}

export function createMockSupabase() {
  const builders: Record<string, MockQueryBuilder> = {};

  const supabase = {
    from: vi.fn((table: string) => {
      if (!builders[table]) {
        builders[table] = createMockQueryBuilder();
      }
      return builders[table];
    }),
    _getBuilder: (table: string) => builders[table],
    _setResult: (table: string, result: { data?: unknown; error?: unknown; count?: number }) => {
      builders[table] = createMockQueryBuilder(result);
    },
  };

  return supabase;
}

// ─── Request Factories ───
export function createGetRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'GET',
  });
}

export function createPostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createPutRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Response Helper ───
export async function parseJsonResponse(response: Response) {
  const json = await response.json();
  return { status: response.status, body: json };
}
