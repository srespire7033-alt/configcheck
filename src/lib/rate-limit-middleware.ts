import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, rateLimitResponse } from './rate-limit';

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

type RouteHandler = (
  request: NextRequest,
  context?: unknown,
) => Promise<NextResponse> | NextResponse;

// ── Preset configs ──────────────────────────────────────────────────

/** Default: 60 requests per minute */
export const defaultLimiter: RateLimitConfig = {
  maxRequests: 60,
  windowMs: 60_000,
};

/** Auth endpoints (login/signup): 10 requests per minute */
export const authLimiter: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 60_000,
};

/** Scan triggers (expensive): 5 requests per minute */
export const scanLimiter: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 60_000,
};

/** Data exports: 3 requests per minute */
export const exportLimiter: RateLimitConfig = {
  maxRequests: 3,
  windowMs: 60_000,
};

// ── Wrapper ─────────────────────────────────────────────────────────

/**
 * Wrap an API route handler with rate limiting.
 *
 * Usage:
 * ```ts
 * export const POST = withRateLimit(async (request) => {
 *   // handler logic
 * }, authLimiter);
 * ```
 */
export function withRateLimit(
  handler: RouteHandler,
  config: RateLimitConfig = defaultLimiter,
): RouteHandler {
  return async (request: NextRequest, context?: unknown) => {
    const result = rateLimit(request, config);
    if (!result.success) {
      return rateLimitResponse(result);
    }
    return handler(request, context);
  };
}
