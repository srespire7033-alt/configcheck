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
  subscribed_products jsonb default '["cpq"]'::jsonb,
  email_notifications_enabled boolean default true,
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
  installed_packages jsonb default '[]'::jsonb,
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
  product_type text default 'cpq' check (product_type in ('cpq', 'cpq_billing', 'arm')),
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
  ai_remediation_plan text,
  ai_scan_diff_cache jsonb default '{}'::jsonb,
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
    'performance', 'impact_analysis',
    'billing_rules', 'rev_rec_rules', 'tax_rules', 'finance_books',
    'gl_rules', 'legal_entity', 'product_billing_config', 'invoicing'
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
-- USAGE LOGS TABLE
-- ============================================
create table public.usage_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  event_type text not null check (event_type in ('scan', 'pdf_report', 'ai_remediation', 'ai_scan_diff', 'ai_fix_suggestion')),
  organization_id uuid references public.organizations(id) on delete set null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Auto-log usage when a scan is created
create or replace function public.log_scan_usage()
returns trigger as $$
begin
  insert into public.usage_logs (user_id, event_type, organization_id, metadata)
  values (new.user_id, 'scan', new.organization_id, jsonb_build_object('scan_id', new.id, 'scan_type', new.scan_type));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_scan_created
  after insert on public.scans
  for each row execute function public.log_scan_usage();

-- ============================================
-- SCAN SCHEDULES TABLE
-- ============================================
create table public.scan_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  schedule_type text not null check (schedule_type in ('once', 'daily', 'weekly', 'monthly')),
  cron_expression text not null,
  timezone text default 'Asia/Kolkata',
  scheduled_date timestamptz,
  day_of_week integer check (day_of_week >= 0 and day_of_week <= 6),
  day_of_month integer check (day_of_month >= 1 and day_of_month <= 31),
  time_of_day text not null default '06:00',
  enabled boolean default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
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
create index idx_usage_logs_user_id on public.usage_logs(user_id);
create index idx_usage_logs_event_type on public.usage_logs(event_type);
create index idx_usage_logs_created_at on public.usage_logs(created_at);
create index idx_scan_schedules_next_run on public.scan_schedules(next_run_at) where enabled = true;
create index idx_scan_schedules_org on public.scan_schedules(organization_id);

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

-- Usage Logs: can only read own usage
alter table public.usage_logs enable row level security;

create policy "Users can read own usage"
  on public.usage_logs for select
  using (auth.uid() = user_id);

create policy "Service can insert usage"
  on public.usage_logs for insert
  with check (true);

-- Scan Schedules: can only manage own schedules
alter table public.scan_schedules enable row level security;

create policy "Users can manage own schedules"
  on public.scan_schedules for all
  using (auth.uid() = user_id);
