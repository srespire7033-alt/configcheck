-- Scheduled Scans table
-- Run this migration in Supabase SQL Editor

CREATE TABLE scan_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'daily', 'weekly', 'monthly')),
  cron_expression TEXT NOT NULL,
  timezone TEXT DEFAULT 'Asia/Kolkata',
  scheduled_date TIMESTAMPTZ,
  day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),
  day_of_month INTEGER CHECK (day_of_month >= 1 AND day_of_month <= 31),
  time_of_day TEXT NOT NULL DEFAULT '06:00',
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE scan_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own schedules"
  ON scan_schedules FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_scan_schedules_next_run ON scan_schedules(next_run_at) WHERE enabled = true;
CREATE INDEX idx_scan_schedules_org ON scan_schedules(organization_id);
