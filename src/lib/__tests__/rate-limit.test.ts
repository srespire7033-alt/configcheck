import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rateLimit, rateLimitResponse, _store } from '../rate-limit';

function makeRequest(ip = '192.168.1.1'): Request {
  return new Request('http://localhost/api/test', {
    headers: { 'x-forwarded-for': ip },
  });
}

describe('rateLimit', () => {
  beforeEach(() => {
    _store.clear();
  });

  it('allows requests within the limit', () => {
    const req = makeRequest();
    const config = { maxRequests: 5, windowMs: 60_000 };

    for (let i = 0; i < 5; i++) {
      const result = rateLimit(req, config);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  it('blocks requests over the limit', () => {
    const req = makeRequest();
    const config = { maxRequests: 3, windowMs: 60_000 };

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      const result = rateLimit(req, config);
      expect(result.success).toBe(true);
    }

    // Next request should be blocked
    const blocked = rateLimit(req, config);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets after the window passes', () => {
    const req = makeRequest();
    const config = { maxRequests: 2, windowMs: 1_000 };

    // Use up the limit
    rateLimit(req, config);
    rateLimit(req, config);
    expect(rateLimit(req, config).success).toBe(false);

    // Advance time past the window
    vi.useFakeTimers();
    vi.advanceTimersByTime(1_100);

    const result = rateLimit(req, config);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(1);

    vi.useRealTimers();
  });

  it('tracks different IPs independently', () => {
    const config = { maxRequests: 1, windowMs: 60_000 };

    const result1 = rateLimit(makeRequest('10.0.0.1'), config);
    expect(result1.success).toBe(true);

    const result2 = rateLimit(makeRequest('10.0.0.2'), config);
    expect(result2.success).toBe(true);

    // First IP is now blocked
    const blocked = rateLimit(makeRequest('10.0.0.1'), config);
    expect(blocked.success).toBe(false);
  });

  it('supports custom keys', () => {
    const config = { maxRequests: 1, windowMs: 60_000 };

    const result1 = rateLimit(makeRequest(), config, 'user-123');
    expect(result1.success).toBe(true);

    const blocked = rateLimit(makeRequest('different-ip'), config, 'user-123');
    expect(blocked.success).toBe(false);
  });
});

describe('rateLimitResponse', () => {
  it('returns a 429 response with correct headers', async () => {
    const result = {
      success: false as const,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      limit: 10,
    };

    const response = rateLimitResponse(result);

    expect(response.status).toBe(429);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response.headers.get('X-RateLimit-Reset')).toBe(String(result.resetAt));
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);

    const body = await response.json();
    expect(body.error).toContain('Too many requests');
  });
});
