/**
 * Server-side analytics capture. Used by API route handlers and background
 * jobs (scan engine, OAuth callback, etc.).
 *
 * Design notes:
 *   - Fire-and-forget. Analytics must NEVER block or fail the parent request.
 *     Every call is wrapped so a database hiccup can't take down a scan or
 *     an OAuth callback. We log failures to console for visibility but
 *     swallow them.
 *   - No-op in test environments to keep vitest output clean and avoid
 *     hitting Supabase from unit tests.
 *   - Uses the service-role client because the analytics_events table has
 *     RLS enabled with no policies — service-role bypasses RLS.
 */
import { createServiceClient } from '@/lib/db/client';
import type { AnalyticsEventName } from './events';

interface TrackOptions {
  userId?: string | null;
  anonymousId?: string | null;
  properties?: Record<string, unknown>;
  sessionId?: string | null;
  userAgent?: string | null;
  path?: string | null;
  referrer?: string | null;
}

/**
 * Capture an analytics event from server-side code.
 * Returns a Promise that resolves when the row is inserted, but the caller
 * should NOT await it — fire-and-forget is the intended usage.
 *
 * @example
 * track(AnalyticsEvent.SCAN_COMPLETED, {
 *   userId: org.user_id,
 *   properties: { product_type, duration_ms, issue_count, score },
 * });
 */
export async function track(event: AnalyticsEventName, opts: TrackOptions = {}): Promise<void> {
  // Skip in tests — vitest sets NODE_ENV=test
  if (process.env.NODE_ENV === 'test') return;

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from('analytics_events').insert({
      user_id: opts.userId ?? null,
      anonymous_id: opts.anonymousId ?? null,
      event_name: event,
      properties: opts.properties ?? {},
      session_id: opts.sessionId ?? null,
      user_agent: opts.userAgent ?? null,
      path: opts.path ?? null,
      referrer: opts.referrer ?? null,
    });
    if (error) {
      // Non-fatal — log and move on. We don't want telemetry failures to
      // surface to the user or break product features.
      console.error('[analytics] track failed:', event, error.message);
    }
  } catch (err) {
    console.error('[analytics] track threw:', event, err);
  }
}
