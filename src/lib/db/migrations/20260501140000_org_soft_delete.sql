-- Soft-delete organizations so scan history is preserved across
-- disconnect / reconnect. The DELETE /api/orgs flow now sets
-- disconnected_at instead of hard-deleting, and the OAuth reconnect
-- flow clears it back to NULL when the same Salesforce org connects
-- again under the same user.

alter table public.organizations
  add column if not exists disconnected_at timestamptz null;

-- Tokens are no longer required once an org is disconnected — we wipe
-- them at disconnect time (security: don't keep credentials for an org
-- the user explicitly let go of). They get repopulated on reconnect.
alter table public.organizations
  alter column access_token drop not null;
alter table public.organizations
  alter column refresh_token drop not null;

create index if not exists idx_organizations_user_disconnected
  on public.organizations (user_id, disconnected_at);
