-- ============================================
-- Teams & Multi-User Access Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- ============================================
-- NEW TABLES
-- ============================================

-- Teams table
create table public.teams (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  slug text not null unique,
  owner_id uuid references public.users(id) on delete restrict not null,
  plan text default 'practice' check (plan in ('practice', 'partner')),
  logo_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index idx_teams_slug on public.teams(slug);
create index idx_teams_owner_id on public.teams(owner_id);

create trigger update_teams_updated_at
  before update on public.teams
  for each row execute function public.update_updated_at();

-- Team members table
create table public.team_members (
  id uuid default uuid_generate_v4() primary key,
  team_id uuid references public.teams(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'viewer')),
  invited_by uuid references public.users(id) on delete set null,
  joined_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(team_id, user_id)
);

create index idx_team_members_team_id on public.team_members(team_id);
create index idx_team_members_user_id on public.team_members(user_id);

-- Team invitations table
create table public.team_invitations (
  id uuid default uuid_generate_v4() primary key,
  team_id uuid references public.teams(id) on delete cascade not null,
  email text not null,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  invited_by uuid references public.users(id) on delete set null not null,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  status text default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz default now()
);

create index idx_team_invitations_token on public.team_invitations(token);
create index idx_team_invitations_email on public.team_invitations(email);
create index idx_team_invitations_team_id on public.team_invitations(team_id);

-- Team activity log
create table public.team_activity_log (
  id uuid default uuid_generate_v4() primary key,
  team_id uuid references public.teams(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index idx_team_activity_team_id on public.team_activity_log(team_id);
create index idx_team_activity_created_at on public.team_activity_log(created_at);

-- ============================================
-- ALTER EXISTING TABLES
-- ============================================

-- Add team_id to organizations (nullable — solo users unaffected)
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS team_id uuid references public.teams(id) on delete set null;
CREATE INDEX IF NOT EXISTS idx_organizations_team_id ON public.organizations(team_id);

-- Add team_id to usage_logs
ALTER TABLE public.usage_logs ADD COLUMN IF NOT EXISTS team_id uuid references public.teams(id) on delete set null;
CREATE INDEX IF NOT EXISTS idx_usage_logs_team_id ON public.usage_logs(team_id);

-- Add active_team_id to users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS active_team_id uuid references public.teams(id) on delete set null;

-- ============================================
-- RLS HELPER FUNCTIONS
-- ============================================

create or replace function public.is_team_member(p_team_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$ language sql security definer stable;

create or replace function public.is_team_admin(p_team_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$ language sql security definer stable;

-- ============================================
-- RLS POLICIES FOR NEW TABLES
-- ============================================

alter table public.teams enable row level security;

create policy "Team members can read their team"
  on public.teams for select
  using (public.is_team_member(id));

create policy "Only owner can update team"
  on public.teams for update
  using (owner_id = auth.uid());

create policy "Only owner can delete team"
  on public.teams for delete
  using (owner_id = auth.uid());

create policy "Authenticated users can create teams"
  on public.teams for insert
  with check (auth.uid() = owner_id);

alter table public.team_members enable row level security;

create policy "Team members can see fellow members"
  on public.team_members for select
  using (public.is_team_member(team_id));

create policy "Admins can manage members"
  on public.team_members for insert
  with check (public.is_team_admin(team_id));

create policy "Admins can update members"
  on public.team_members for update
  using (public.is_team_admin(team_id));

create policy "Admins can remove members or self-leave"
  on public.team_members for delete
  using (
    public.is_team_admin(team_id)
    or user_id = auth.uid()
  );

alter table public.team_invitations enable row level security;

create policy "Team admins can manage invitations"
  on public.team_invitations for all
  using (public.is_team_admin(team_id));

alter table public.team_activity_log enable row level security;

create policy "Team members can read activity"
  on public.team_activity_log for select
  using (public.is_team_member(team_id));

create policy "Service can insert activity"
  on public.team_activity_log for insert
  with check (true);

-- ============================================
-- UPDATE EXISTING RLS POLICIES (team-aware)
-- ============================================

-- Organizations: add team access
drop policy if exists "Users can read own orgs" on public.organizations;
create policy "Users can read own or team orgs"
  on public.organizations for select
  using (
    auth.uid() = user_id
    or (team_id is not null and public.is_team_member(team_id))
  );

drop policy if exists "Users can update own orgs" on public.organizations;
create policy "Users can update own or team orgs"
  on public.organizations for update
  using (
    auth.uid() = user_id
    or (team_id is not null and public.is_team_admin(team_id))
  );

drop policy if exists "Users can delete own orgs" on public.organizations;
create policy "Users can delete own or team orgs"
  on public.organizations for delete
  using (
    auth.uid() = user_id
    or (team_id is not null and public.is_team_admin(team_id))
  );

-- Scans: add team access
drop policy if exists "Users can read own scans" on public.scans;
create policy "Users can read own or team scans"
  on public.scans for select
  using (
    auth.uid() = user_id
    or organization_id in (
      select id from public.organizations
      where team_id is not null and public.is_team_member(team_id)
    )
  );

-- Issues: add team access
drop policy if exists "Users can read own issues" on public.issues;
create policy "Users can read own or team issues"
  on public.issues for select
  using (
    organization_id in (
      select id from public.organizations
      where user_id = auth.uid()
        or (team_id is not null and public.is_team_member(team_id))
    )
  );

drop policy if exists "Users can update own issues" on public.issues;
create policy "Users can update own or team issues"
  on public.issues for update
  using (
    organization_id in (
      select id from public.organizations
      where user_id = auth.uid()
        or (team_id is not null and public.is_team_admin(team_id))
    )
  );
