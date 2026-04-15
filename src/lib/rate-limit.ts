import { NextResponse } from 'next/server';

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

// In-memory store keyed by identifier (IP or custom key)
const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 60 seconds to prevent memory leaks
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      // Remove entries where all timestamps are older than 5 minutes
      // (generous max window to avoid premature cleanup)
      const fresh = entry.timestamps.filter((t) => now - t < 5 * 60 * 1000);
      if (fresh.length === 0) {
        store.delete(key);
      } else {
        entry.timestamps = fresh;
      }
    }
  }, 60_000);

  // Allow the process to exit without waiting for the interval
  if (typeof cleanupInterval === 'object' && 'unref' in cleanupInterval) {
    cleanupInterval.unref();
  }
}

function getClientIp(request: Request): string {
  const headers = request.headers;
  // Check common proxy headers
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  return '127.0.0.1';
}

/**
 * Sliding-window rate limiter.
 * Checks whether a request is within the allowed rate and returns the result.
 */
export function rateLimit(
  request: Request,
  config: RateLimitConfig,
  key?: string,
): RateLimitResult {
  ensureCleanup();

  const identifier = key ?? getClientIp(request);
  const now = Date.now();
  const windowStart = now - config.windowMs;

  let entry = store.get(identifier);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(identifier, entry);
  }

  // Remove timestamps outside the current window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= config.maxRequests) {
    // Oldest timestamp still in the window determines when it resets
    const resetAt = entry.timestamps[0] + config.windowMs;
    return {
      success: false,
      remaining: 0,
      resetAt,
      limit: config.maxRequests,
    };
  }

  // Record this request
  entry.timestamps.push(now);

  return {
    success: true,
    remaining: config.maxRequests - entry.timestamps.length,
    resetAt: now + config.windowMs,
    limit: config.maxRequests,
  };
}

/**
 * Build a 429 Too Many Requests response with standard rate-limit headers.
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);

  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(result.resetAt),
        'Retry-After': String(Math.max(retryAfterSeconds, 1)),
      },
    },
  );
}

// Exported for testing purposes
export { store as _store };
