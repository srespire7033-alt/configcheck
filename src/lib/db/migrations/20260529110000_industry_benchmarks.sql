-- Cross-org industry benchmark framework — DORMANT until ≥5 customers/industry.
--
-- The Revenue Leakage card today says "your org loses $X/yr." Once we have
-- a customer base, the same card can add "median SaaS org in our data
-- loses $Y/yr — you're at the 73rd percentile." That comparison is what
-- pushes browsers into buyers ("oh, we're worse than most? fix it now").
--
-- We don't HAVE that comparison data yet, so this migration just lays the
-- table. A cron will populate it nightly when we cross the 5-customer
-- threshold per industry. Until then, the table is empty and the UI
-- gracefully skips the percentile line.
--
-- Privacy: NO per-customer rows in this table — only AGGREGATE statistics
-- per (industry, check_id). A customer's data is anonymized into the
-- aggregate before being written here. The cron that populates this is
-- the only place we'd ever read across customer boundaries.

CREATE TABLE IF NOT EXISTS industry_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Industry profile this benchmark applies to. Matches the Industry type
  -- in revenue-formulas.ts (saas | manufacturing | services | financial | b2c | other).
  industry TEXT NOT NULL,

  -- Optional per-check breakdown. NULL = overall benchmark (the
  -- portfolio-wide $/yr leakage number). When set, the row represents
  -- the per-check distribution (e.g., "QL-001 typically leaks $X/yr in
  -- saas orgs").
  check_id TEXT,

  -- Distribution stats, all in the primary currency (USD for v1; we'll
  -- add currency-normalized variants once we have multi-currency
  -- customers).
  sample_size INTEGER NOT NULL CHECK (sample_size >= 5),
  median NUMERIC NOT NULL,
  p25 NUMERIC NOT NULL,
  p75 NUMERIC NOT NULL,
  p90 NUMERIC NOT NULL,
  mean NUMERIC NOT NULL,

  -- Lineage so we can re-run a benchmark against historical scans if a
  -- formula version changes.
  formula_version TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes JSONB DEFAULT '[]'::jsonb,

  -- Uniqueness: one row per (industry, check_id, formula_version). NULL
  -- check_id is the "overall" row.
  UNIQUE (industry, check_id, formula_version)
);

CREATE INDEX IF NOT EXISTS industry_benchmarks_lookup_idx
  ON industry_benchmarks (industry, check_id, formula_version);

COMMENT ON TABLE industry_benchmarks IS
  'Aggregate cross-customer benchmarks for revenue leakage. Populated by nightly cron once a given industry has >=5 customers. NO per-customer rows — only anonymized aggregates. Used by the dashboard to add "you are at the Nth percentile" context.';

COMMENT ON COLUMN industry_benchmarks.check_id IS
  'NULL = overall portfolio-wide leakage benchmark. Non-NULL = per-check distribution for that industry.';
