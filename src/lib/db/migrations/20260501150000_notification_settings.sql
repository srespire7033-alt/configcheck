-- Per-event notification preferences. JSONB for forward-compat: we'll
-- iterate on event types and channels without further migrations.
--
-- Shape:
-- {
--   "events": {
--     "scan_completed":         { "email": true,  "in_app": true },
--     "scan_failed":            { "email": true,  "in_app": true },
--     "critical_issue_found":   { "email": true,  "in_app": true },
--     "scheduled_scan_ran":     { "email": true,  "in_app": true },
--     "weekly_summary":         { "email": false, "in_app": true },
--     "plan_limit_approaching": { "email": true,  "in_app": true },
--     "plan_limit_reached":     { "email": true,  "in_app": true },
--     "billing_update":         { "email": true,  "in_app": true }
--   },
--   "recipients": [
--     { "email": "alice@co.com", "verified": false, "last_notified_at": null }
--   ]
-- }
--
-- An empty/null setting means "use defaults" — every event on for both
-- email and in-app, recipients pulled from the legacy notification_emails
-- column. The email sender falls back to legacy fields when this column
-- is null so existing users see no behavior change until they save once.

alter table public.users
  add column if not exists notification_settings jsonb;
