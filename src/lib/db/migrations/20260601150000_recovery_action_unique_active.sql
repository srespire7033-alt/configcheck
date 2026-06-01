-- Recovery action idempotency at the DB level.
--
-- The stage endpoints try to enforce 'at most one active recovery_action
-- per finding' in application code, but that check has a race window:
-- two concurrent stage calls (e.g., the per-finding Stage button and
-- the Attribution Map's bulk-stage triggered close together) can BOTH
-- pass their pre-INSERT existence checks and BOTH insert. Result:
-- duplicate active actions for the same finding.
--
-- Partial unique index makes the database the source of truth. At most
-- ONE row per finding with status in (pending, approved, committed).
-- Rejected and expired rows can coexist with the active row so re-staging
-- from rejected → pending preserves history without violating uniqueness.

CREATE UNIQUE INDEX IF NOT EXISTS recovery_actions_one_active_per_finding_idx
  ON recovery_actions (finding_id)
  WHERE approval_status IN ('pending', 'approved', 'committed');
