-- ============================================
-- SCHEMA MIGRATIONS TRACKING TABLE
-- ============================================
-- Records which migration files have been applied to this database.
-- Going forward, every new migration should insert a row here as its
-- final statement, e.g.:
--
--     insert into public.schema_migrations (version) values ('20260501120000_my_change');
--
-- Query `select version from public.schema_migrations order by version;`
-- to see which migrations this database is caught up on.

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- Backfill prior migrations so the tracking table reflects actual DB state.
-- These statements are idempotent (on conflict do nothing) so re-running
-- the file is safe.
insert into public.schema_migrations (version) values
  ('20260408120000_init'),
  ('20260410120000_scheduled_scans'),
  ('20260414160000_product_skus'),
  ('20260415130000_onboarding'),
  ('20260415140000_teams'),
  ('20260417000000_schema_migrations_table')
on conflict (version) do nothing;
