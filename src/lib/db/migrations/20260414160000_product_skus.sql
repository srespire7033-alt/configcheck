-- ============================================
-- Migration: Add Product SKU Support
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Add subscribed_products to users (default: CPQ only)
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS subscribed_products jsonb DEFAULT '["cpq"]'::jsonb;

-- 2. Add product_type to scans
ALTER TABLE public.scans
ADD COLUMN IF NOT EXISTS product_type text DEFAULT 'cpq'
CHECK (product_type IN ('cpq', 'cpq_billing', 'arm'));

-- 3. Expand issue category constraint to include billing categories
ALTER TABLE public.issues DROP CONSTRAINT IF EXISTS issues_category_check;
ALTER TABLE public.issues ADD CONSTRAINT issues_category_check CHECK (category IN (
  'price_rules', 'discount_schedules', 'products', 'product_rules',
  'cpq_settings', 'subscriptions', 'twin_fields', 'contracted_prices', 'quote_lines',
  'summary_variables', 'approval_rules', 'quote_calculator_plugin',
  'quote_templates', 'configuration_attributes', 'guided_selling', 'advanced_pricing',
  'performance', 'impact_analysis',
  'billing_rules', 'rev_rec_rules', 'tax_rules', 'finance_books',
  'gl_rules', 'legal_entity', 'product_billing_config', 'invoicing'
));

-- 4. Backfill existing scans as 'cpq' product_type
UPDATE public.scans SET product_type = 'cpq' WHERE product_type IS NULL;

-- 5. Backfill existing users with CPQ subscription
UPDATE public.users SET subscribed_products = '["cpq"]'::jsonb WHERE subscribed_products IS NULL;
