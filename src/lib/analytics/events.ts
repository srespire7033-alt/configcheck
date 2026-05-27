/**
 * Canonical list of analytics event names.
 *
 * Why a typed enum instead of free-form strings:
 *   - Forces consistent naming (snake_case past-tense for "thing happened",
 *     present-tense imperative is reserved for client interactions).
 *   - One place to audit when reviewing what we capture for privacy.
 *   - IDE autocompletion when wiring up new tracking calls.
 *
 * Add new events here first. Keep the count small — every event we add is
 * one more thing to keep meaningful as the product evolves.
 */
export const AnalyticsEvent = {
  // ── Acquisition / signup funnel ────────────────────────────────────────
  SIGNUP_STARTED: 'signup_started',
  SIGNUP_COMPLETED: 'signup_completed',
  LOGIN_COMPLETED: 'login_completed',

  // ── Onboarding & connect flow ──────────────────────────────────────────
  ONBOARDING_STARTED: 'onboarding_started',
  CONNECT_ORG_MODAL_OPENED: 'connect_org_modal_opened',
  ECA_CREDENTIALS_SUBMITTED: 'eca_credentials_submitted',
  OAUTH_CALLBACK_SUCCESS: 'oauth_callback_success',
  OAUTH_CALLBACK_FAILED: 'oauth_callback_failed',

  // ── Activation: first scan ────────────────────────────────────────────
  SCAN_STARTED: 'scan_started',
  SCAN_COMPLETED: 'scan_completed',
  SCAN_FAILED: 'scan_failed',
  SCAN_BLOCKED_INFLIGHT: 'scan_blocked_inflight', // 409 from per-user gate

  // ── Engagement: AI + reports ──────────────────────────────────────────
  AI_EXPLAIN_USED: 'ai_explain_used',
  AI_FIX_USED: 'ai_fix_used',
  PDF_REPORT_DOWNLOADED: 'pdf_report_downloaded',

  // ── Retention signals ────────────────────────────────────────────────
  ORG_DISCONNECTED: 'org_disconnected',
  LEGACY_BANNER_SEEN: 'legacy_banner_seen',
  PLAN_UPGRADED: 'plan_upgraded',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];
