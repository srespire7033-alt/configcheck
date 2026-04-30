-- Feedback learning loop (Tier 1 + Tier 2)
-- Tier 1: per-org check suppressions — when a user marks issues as false_positive
-- often enough, we mute that check for that org so future scans skip it.
-- Tier 2: aggregate trust score per check_id across all orgs, exposed via a view
-- so the UI can show "92% of users found this helpful".

-- 1. Extend the status check constraint to include feedback values.
--    'false_positive' = check is wrong, suppress for this org
--    'not_relevant'   = valid finding but doesn't apply to this org
alter table public.issues
  drop constraint if exists issues_status_check;

alter table public.issues
  add constraint issues_status_check
  check (status in ('open', 'acknowledged', 'resolved', 'ignored', 'false_positive', 'not_relevant'));

-- 2. Per-org check suppressions table.
--    Suppressed checks are skipped at scan time for that org.
create table if not exists public.check_suppressions (
  organization_id uuid references public.organizations(id) on delete cascade not null,
  check_id text not null,
  reason text,
  suppressed_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null,
  primary key (organization_id, check_id)
);

create index if not exists idx_check_suppressions_org on public.check_suppressions(organization_id);

alter table public.check_suppressions enable row level security;

create policy "Users can view their org's suppressions"
  on public.check_suppressions for select
  using (
    organization_id in (
      select id from public.organizations where user_id = auth.uid()
    )
  );

-- 3. Aggregate trust score view.
--    For each check_id, computes:
--      - total_feedback: how many issues received any explicit feedback
--      - fixed_count: how many were marked resolved (= true positive signal)
--      - false_positive_count: how many were marked false_positive
--      - not_relevant_count: how many were marked not_relevant
--      - trust_score: percentage of feedback that was positive
--                     ((fixed) / (fixed + false_positive)) * 100
--                     not_relevant excluded — it's neutral signal
create or replace view public.check_trust_scores as
select
  check_id,
  count(*) filter (where status in ('resolved', 'false_positive', 'not_relevant')) as total_feedback,
  count(*) filter (where status = 'resolved') as fixed_count,
  count(*) filter (where status = 'false_positive') as false_positive_count,
  count(*) filter (where status = 'not_relevant') as not_relevant_count,
  case
    when count(*) filter (where status in ('resolved', 'false_positive')) = 0 then null
    else round(
      100.0 * count(*) filter (where status = 'resolved') /
      nullif(count(*) filter (where status in ('resolved', 'false_positive')), 0),
      0
    )
  end as trust_score
from public.issues
group by check_id;

-- 4. Track migration
insert into public.schema_migrations (version) values ('20260430190000_feedback_learning_loop')
on conflict (version) do nothing;
