'use client';

/**
 * Browser-side analytics capture. Buffers events and POSTs them to
 * /api/analytics/track. Server-rendered events use track-server.ts instead.
 *
 * Design notes:
 *   - Anonymous ID is generated once on first call and stored in
 *     localStorage. It survives logout/login so we can stitch pre-signup
 *     activity to the user after auth.
 *   - Session ID is sessionStorage so it resets when the tab closes —
 *     gives us "sessions per day" granularity for funnel math.
 *   - Honors browser Do Not Track signal. If DNT is on, we no-op.
 *   - All calls are fire-and-forget; no awaiting. Failures are silently
 *     swallowed so a flaky analytics endpoint can never break the UI.
 *   - Uses navigator.sendBeacon when available (page unload events).
 */

import type { AnalyticsEventName } from './events';

const ANON_ID_KEY = 'orgprism_anon_id';
const SESSION_ID_KEY = 'orgprism_session_id';

function genId(): string {
  // 22 chars of base36 — collision-resistant enough for analytics.
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 12)
  );
}

function getAnonymousId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id = genId();
      localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage blocked (private mode, etc.) — use ephemeral ID
    return genId();
  }
}

function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = sessionStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = genId();
      sessionStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    return genId();
  }
}

function isDNT(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Standard DNT header value '1' = user wants to opt out
  return navigator.doNotTrack === '1';
}

/**
 * Fire-and-forget event capture from the browser.
 *
 * @example
 * track(AnalyticsEvent.CONNECT_ORG_MODAL_OPENED, { source: 'dashboard' });
 */
export function track(event: AnalyticsEventName, properties: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  if (isDNT()) return;

  const payload = JSON.stringify({
    event,
    anonymousId: getAnonymousId(),
    sessionId: getSessionId(),
    properties,
    path: window.location.pathname,
    referrer: document.referrer || null,
  });

  try {
    // Prefer sendBeacon for unload-safety (e.g. navigation away from page).
    // Falls through to fetch when payload exceeds beacon limit (~64 KB)
    // or when the browser doesn't support it.
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      const ok = navigator.sendBeacon('/api/analytics/track', blob);
      if (ok) return;
    }
    void fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Silent: telemetry failure must never bubble to the user.
    });
  } catch {
    // Silent
  }
}
