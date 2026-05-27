import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/db/client';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { AnalyticsEvent, type AnalyticsEventName } from '@/lib/analytics/events';

export const dynamic = 'force-dynamic';

const VALID_EVENTS = new Set<string>(Object.values(AnalyticsEvent));
const MAX_PROPERTIES_BYTES = 4096;

/**
 * POST /api/analytics/track
 * Public ingress for browser-side analytics. The client never writes to
 * Supabase directly; it POSTs here, we validate the event name against the
 * canonical enum (so a compromised client can't pollute the table with
 * arbitrary event names), and we insert with the service-role client.
 *
 * If the request carries a logged-in Supabase session cookie, we attach the
 * user_id automatically so the caller doesn't have to (and so a tampered
 * client can't claim to be a different user).
 */
export async function POST(request: NextRequest) {
  // Generous limit — analytics events can be chatty (modal opens, hovers, etc.)
  // but a single client should never burst more than a few per second.
  const limiter = rateLimit(request, { maxRequests: 60, windowMs: 60_000 });
  if (!limiter.success) return rateLimitResponse(limiter);

  try {
    const body = await request.json();
    const { event, anonymousId, sessionId, properties, path, referrer } = body ?? {};

    // Validate event name against the canonical enum — prevents arbitrary
    // strings from filling the table.
    if (typeof event !== 'string' || !VALID_EVENTS.has(event)) {
      return NextResponse.json({ error: 'invalid event' }, { status: 400 });
    }

    // Cap properties size so a misbehaving client can't dump payloads.
    const props = properties && typeof properties === 'object' ? properties : {};
    const propsJson = JSON.stringify(props);
    if (propsJson.length > MAX_PROPERTIES_BYTES) {
      return NextResponse.json({ error: 'properties too large' }, { status: 413 });
    }

    // Resolve the user from session cookies if present. We don't reject
    // unauthenticated calls — pre-signup events (CONNECT_ORG_MODAL_OPENED on
    // the marketing site, e.g.) are legitimately anonymous.
    let userId: string | null = null;
    try {
      const supabaseAuth = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll: () => request.cookies.getAll(),
            setAll: () => {
              /* no-op: we're not setting cookies on the response */
            },
          },
        }
      );
      const { data: { user } } = await supabaseAuth.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      // Session resolution is best-effort; an unparsable cookie just means
      // we capture the event as anonymous. Don't fail the request.
    }

    const supabase = createServiceClient();
    const { error } = await supabase.from('analytics_events').insert({
      user_id: userId,
      anonymous_id: typeof anonymousId === 'string' ? anonymousId.slice(0, 64) : null,
      event_name: event as AnalyticsEventName,
      properties: props,
      session_id: typeof sessionId === 'string' ? sessionId.slice(0, 64) : null,
      user_agent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
      path: typeof path === 'string' ? path.slice(0, 256) : null,
      referrer: typeof referrer === 'string' ? referrer.slice(0, 512) : null,
    });

    if (error) {
      // Don't surface DB internals to the caller. Log for visibility.
      console.error('[analytics] insert failed:', error.message);
      return NextResponse.json({ error: 'insert failed' }, { status: 500 });
    }

    // 204 No Content keeps the response body tiny on the hot path.
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}
