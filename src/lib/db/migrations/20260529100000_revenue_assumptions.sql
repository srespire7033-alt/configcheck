-- Revenue leakage engine — per-user and per-org overrides.
--
-- The engine (src/lib/analysis/revenue-leakage.ts) reads assumptions in
-- this priority order:
--   1. organizations.revenue_assumptions  (per-org override, takes top priority)
--   2. users.revenue_assumptions           (per-user default)
--   3. DEFAULT_ASSUMPTIONS from code       (system fallback: saas, median)
--
-- Both columns are JSONB so the assumption shape can evolve without
-- migrations (e.g., we may later add per-industry confidence thresholds
-- or currency overrides). The shape currently is:
--   { industry: 'saas' | 'manufacturing' | 'services' | 'financial' | 'b2c' | 'other',
--     use_median: boolean,
--     confidence_min_sample: number }
--
-- All fields optional — the engine merges with DEFAULT_ASSUMPTIONS.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS revenue_assumptions JSONB DEFAULT NULL;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS revenue_assumptions JSONB DEFAULT NULL;

COMMENT ON COLUMN users.revenue_assumptions IS
  'Per-user revenue leakage assumptions (industry, median-vs-mean, sample threshold). NULL = use system defaults.';

COMMENT ON COLUMN organizations.revenue_assumptions IS
  'Per-org override of revenue leakage assumptions. Takes priority over users.revenue_assumptions when present.';
