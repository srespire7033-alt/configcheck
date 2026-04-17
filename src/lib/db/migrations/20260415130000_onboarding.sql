-- ============================================
-- Onboarding Fields Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- Add onboarding fields to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_source text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS company_size text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS checklist_dismissed boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS checklist_progress jsonb DEFAULT '{"profile_completed": false, "org_connected": false, "first_scan_run": false, "issue_reviewed": false, "pdf_generated": false, "schedule_created": false}'::jsonb;

-- Add is_admin and notification_emails that were missing from original schema
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notification_emails jsonb DEFAULT '[]'::jsonb;
