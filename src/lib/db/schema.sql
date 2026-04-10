-- ============================================
-- ConfigCheck Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
create table public.users (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  company_name text,
  company_logo_url text,
  report_branding_color text default '#1B5E96',
  timezone text default 'Asia/Kolkata',
  avatar_url text,
  plan text default 'free' check (plan in ('free', 'solo', 'practice', 'partner')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-create user row when they sign up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- ORGANIZATIONS TABLE
-- ============================================
create table public.organizations (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  name text not null,
  salesforce_org_id text not null,
  instance_url text not null,
  access_token text not null,
  refresh_token text not null,
  is_sandbox boolean default false,
  connection_status text default 'connected' check (connection_status in ('connected', 'expired', 'error')),
  cpq_package_version text,
  total_quote_lines integer,
  total_price_rules integer,
  total_products integer,
  last_scan_score integer,
  last_scan_at timestamptz,
  last_connected_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- SCANS TABLE
-- ============================================
create table public.scans (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  status text default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  scan_type text default 'full' check (scan_type in ('full', 'quick')),
  overall_score integer,
  category_scores jsonb,
  summary text,
  total_issues integer default 0,
  critical_count integer default 0,
  warning_count integer default 0,
  info_count integer default 0,
  duration_ms integer,
  metadata jsonb,
  report_url text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================
-- ISSUES TABLE
-- ============================================
create table public.issues (
  id uuid default uuid_generate_v4() primary key,
  scan_id uuid references public.scans(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  check_id text not null,
  category text not null check (category in (
    'price_rules', 'discount_schedules', 'products', 'product_rules',
    'cpq_settings', 'subscriptions', 'twin_fields', 'contracted_prices', 'quote_lines',
    'summary_variables', 'approval_rules', 'quote_calculator_plugin',
    'quote_templates', 'configuration_attributes', 'guided_selling', 'advanced_pricing',
    'performance', 'impact_analysis'
  )),
  severity text not null check (severity in ('critical', 'warning', 'info')),
  title text not null,
  description text not null,
  impact text not null,
  recommendation text not null,
  affected_records jsonb default '[]'::jsonb,
  ai_fix_suggestion text,
  status text default 'open' check (status in ('open', 'acknowledged', 'resolved', 'ignored')),
  resolved_at timestamptz,
  notes text,
  revenue_impact decimal,
  effort_hours decimal,
  created_at timestamptz default now()
);

-- ============================================
-- INDEXES
-- ============================================
create index idx_organizations_user_id on public.organizations(user_id);
create index idx_scans_organization_id on public.scans(organization_id);
create index idx_scans_user_id on public.scans(user_id);
create index idx_scans_status on public.scans(status);
create index idx_issues_scan_id on public.issues(scan_id);
create index idx_issues_organization_id on public.issues(organization_id);
create index idx_issues_severity on public.issues(severity);
create index idx_issues_status on public.issues(status);

-- ============================================
-- AUTO-UPDATE updated_at
-- ============================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_users_updated_at
  before update on public.users
  for each row execute function public.update_updated_at();

create trigger update_organizations_updated_at
  before update on public.organizations
  for each row execute function public.update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Users: can only read/update own row
alter table public.users enable row level security;

create policy "Users can read own data"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update own data"
  on public.users for update
  using (auth.uid() = id);

-- Organizations: can only access own orgs
alter table public.organizations enable row level security;

create policy "Users can read own orgs"
  on public.organizations for select
  using (auth.uid() = user_id);

create policy "Users can insert own orgs"
  on public.organizations for insert
  with check (auth.uid() = user_id);

create policy "Users can update own orgs"
  on public.organizations for update
  using (auth.uid() = user_id);

create policy "Users can delete own orgs"
  on public.organizations for delete
  using (auth.uid() = user_id);

-- Scans: can only access own scans
alter table public.scans enable row level security;

create policy "Users can read own scans"
  on public.scans for select
  using (auth.uid() = user_id);

create policy "Users can insert own scans"
  on public.scans for insert
  with check (auth.uid() = user_id);

create policy "Users can update own scans"
  on public.scans for update
  using (auth.uid() = user_id);

-- Issues: can access issues for own orgs
alter table public.issues enable row level security;

create policy "Users can read own issues"
  on public.issues for select
  using (
    organization_id in (
      select id from public.organizations where user_id = auth.uid()
    )
  );

create policy "Users can insert own issues"
  on public.issues for insert
  with check (
    organization_id in (
      select id from public.organizations where user_id = auth.uid()
    )
  );

create policy "Users can update own issues"
  on public.issues for update
  using (
    organization_id in (
      select id from public.organizations where user_id = auth.uid()
    )
  );
