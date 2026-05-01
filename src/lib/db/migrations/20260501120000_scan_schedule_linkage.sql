-- ============================================
-- LINK SCANS TO THE SCHEDULE THAT TRIGGERED THEM
-- ============================================
-- Background: scan_schedules currently only stores `last_run_at` (a single
-- timestamp), so the UI can't show "the last 5 scheduled runs and their
-- success/failure status" — there's no way to look up which scans came from
-- which schedule.
--
-- Adding `triggered_by_schedule_id` to `scans` is the lightest fix: the
-- cron worker tags scans it creates, and the UI can query
--   `select * from scans where triggered_by_schedule_id = ? order by created_at desc limit 5;`
-- to surface the recent-runs list per schedule.
--
-- Manual scans leave the column NULL (the default), so existing rows are
-- unaffected and no backfill is needed.

alter table public.scans
  add column if not exists triggered_by_schedule_id uuid references public.scan_schedules(id) on delete set null;

-- Per-schedule history queries are the dominant access pattern, so index it.
create index if not exists idx_scans_triggered_by_schedule_id
  on public.scans (triggered_by_schedule_id, created_at desc)
  where triggered_by_schedule_id is not null;

insert into public.schema_migrations (version) values
  ('20260501120000_scan_schedule_linkage')
on conflict (version) do nothing;
