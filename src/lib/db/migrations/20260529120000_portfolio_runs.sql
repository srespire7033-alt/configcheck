-- Portfolio comparison orchestration.
--
-- A "portfolio run" is a single user action — "compare these N orgs" —
-- that may need to trigger fresh scans before the comparison can be
-- shown. Without this table we have no way to:
--   (a) tell the progress page "you're waiting on these specific N scans",
--   (b) recover if the user closes the tab (we still need to finish the
--       work and notify them by email),
--   (c) audit how many portfolio runs are happening (admin analytics).
--
-- Why an array column for scan_ids instead of a junction table: each run
-- is capped at 20 orgs (matches the portfolio-compare API), so the array
-- never grows unbounded. Junction would be over-engineered for the cap.

CREATE TABLE IF NOT EXISTS portfolio_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Orgs the user selected for this comparison. The order is preserved
  -- so the comparison UI can render columns left-to-right consistently.
  organization_ids UUID[] NOT NULL,

  -- Scans this run is waiting on or has consumed. Same ordering as
  -- organization_ids — index N in scan_ids is the scan for org N.
  -- May contain CACHED scan IDs (if the org was fresh enough to skip
  -- re-scanning) AND newly-kicked-off scan IDs interleaved.
  scan_ids UUID[] NOT NULL,

  -- Lifecycle:
  --   pending     — created, nothing kicked off yet (transient)
  --   running     — at least one referenced scan is still running
  --   completed   — every referenced scan reached 'completed'
  --   partial     — terminal: some scans failed, some succeeded
  --   failed      — terminal: every scan failed (rare)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'partial', 'failed')),

  -- When the user opted into email notification on the modal. Independent
  -- of the org-level scan_completed setting because portfolio runs are a
  -- separate event class.
  notify_on_complete BOOLEAN NOT NULL DEFAULT FALSE,
  notified_at TIMESTAMPTZ,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Free-form audit notes: which orgs used cached scans, which got
  -- re-scanned, why. Helps debug "why did this comparison have stale
  -- data?" weeks later.
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS portfolio_runs_user_idx
  ON portfolio_runs (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS portfolio_runs_status_idx
  ON portfolio_runs (status)
  WHERE status IN ('pending', 'running');

-- RLS: a user only sees their own runs.
ALTER TABLE portfolio_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY portfolio_runs_owner_select ON portfolio_runs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY portfolio_runs_owner_insert ON portfolio_runs
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY portfolio_runs_owner_update ON portfolio_runs
  FOR UPDATE USING (user_id = auth.uid());

COMMENT ON TABLE portfolio_runs IS
  'Orchestrates a multi-org portfolio comparison. Tracks which scans the comparison is waiting on so the user can close the tab and come back to a finished result.';
