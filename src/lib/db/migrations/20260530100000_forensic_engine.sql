-- Revenue Leakage Forensics Engine — foundation schema.
--
-- Five new tables, each multi-tenant via RLS, that together let us:
--   1. Record that a forensic scan ran (separate from config scans because
--      they have different lifecycle/cost characteristics)
--   2. Persist per-record findings with VERIFIED $ (real numbers from real
--      transactional records, not heuristic estimates)
--   3. Trace each finding back to its root configuration cause + AI render
--   4. Stage recovery actions for human approval
--   5. Cache pulled transactional records (Quote, Order, Subscription, etc.)
--      with retention controls so we don't re-pull on every dashboard view
--
-- Design choice: separate tables from the existing scans/issues rather than
-- piggybacking. Forensic checks are a different mental model (data
-- reconciliation, not config validation), have different lifecycles
-- (longer, async via Bulk API), and need their own retention/privacy
-- policies. Reusing the existing tables would force every scan to think
-- about both worlds.

-- ─────────────────────────────────────────────────────────────────────
-- 1. forensic_scans — header row per forensic run
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forensic_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Parent config scan that triggered this forensic scan. NULL if a
  -- forensic-only scan was run directly. Lets the UI link back to the
  -- 209-check findings that complement the forensic findings.
  parent_scan_id UUID REFERENCES scans(id) ON DELETE SET NULL,

  -- Lifecycle:
  --   queued       — created, Bulk API jobs not yet submitted
  --   running      — at least one Bulk job is in flight
  --   reconciling  — Bulk jobs done, detector logic running
  --   attributing  — detectors done, attribution engine running
  --   completed    — all done, findings persisted
  --   partial      — completed but some detectors failed
  --   failed       — terminal failure before any findings landed
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'reconciling', 'attributing', 'completed', 'partial', 'failed')),

  -- Which detectors ran in this scan. NULL = all available for the
  -- detected product type. Free tier limits this to ['REN-001'] by Strategy C.
  detectors_requested TEXT[],
  detectors_completed TEXT[] DEFAULT '{}',
  detectors_failed TEXT[] DEFAULT '{}',

  -- Aggregate verified $ from this scan's findings. Stored here for fast
  -- dashboard queries — recomputed when findings land.
  total_verified_usd NUMERIC DEFAULT 0,
  finding_count INTEGER DEFAULT 0,
  records_scanned INTEGER DEFAULT 0,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS forensic_scans_org_idx
  ON forensic_scans (organization_id, started_at DESC);

CREATE INDEX IF NOT EXISTS forensic_scans_active_idx
  ON forensic_scans (status)
  WHERE status IN ('queued', 'running', 'reconciling', 'attributing');

ALTER TABLE forensic_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY forensic_scans_owner_select ON forensic_scans
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY forensic_scans_owner_insert ON forensic_scans
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY forensic_scans_owner_update ON forensic_scans
  FOR UPDATE USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- 2. forensic_findings — one row per leakage finding (per record gap)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forensic_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forensic_scan_id UUID NOT NULL REFERENCES forensic_scans(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Detector that produced this finding. Matches the IDs we use elsewhere:
  -- REN-001, DSC-FOR-001, ORD-FOR-001, etc.
  detector_id TEXT NOT NULL,

  -- Severity is informational. The $ number is the actual driver — a
  -- $10 finding isn't critical even if the detector says so.
  severity TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('critical', 'warning', 'info')),

  -- The headline: how much real money is leaking here.
  entitled_usd NUMERIC NOT NULL,    -- What the contract entitled
  realized_usd NUMERIC NOT NULL,    -- What was actually billed/quoted
  gap_usd NUMERIC NOT NULL,         -- entitled - realized (positive = leak)
  currency_iso_code TEXT NOT NULL DEFAULT 'USD',

  -- Recoverability is a separate signal. Some leakage is structurally
  -- unrecoverable (e.g., closed-and-paid past period with statute-of-
  -- limitations passed). 0.0 = unrecoverable, 1.0 = fully recoverable.
  recoverability_score NUMERIC NOT NULL DEFAULT 1.0
    CHECK (recoverability_score >= 0 AND recoverability_score <= 1),

  -- References back to the actual Salesforce records this finding is
  -- about. Stored as JSONB so we can extend the shape per detector.
  -- Privacy constraint: ONLY Salesforce IDs + financial fields. No PII.
  --   { "primary_record": { "type": "Order", "id": "...", "name": "..." },
  --     "supporting_records": [{ "type": "Contract", "id": "...", ... }] }
  source_record_refs JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Human-readable titles for UI. Generated by detector, not stored
  -- from Salesforce data (so we never leak Account/Contact names).
  title TEXT NOT NULL,
  description TEXT,

  -- Resolution lifecycle. open → in_review → recovered | dismissed.
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_review', 'recovered', 'dismissed')),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,

  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS forensic_findings_scan_idx
  ON forensic_findings (forensic_scan_id);
CREATE INDEX IF NOT EXISTS forensic_findings_org_idx
  ON forensic_findings (organization_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS forensic_findings_detector_idx
  ON forensic_findings (detector_id, status);

ALTER TABLE forensic_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY forensic_findings_owner_select ON forensic_findings
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY forensic_findings_owner_insert ON forensic_findings
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY forensic_findings_owner_update ON forensic_findings
  FOR UPDATE USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- 3. attribution_traces — root cause analysis per finding
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attribution_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id UUID NOT NULL REFERENCES forensic_findings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The 5 attribution root cause classes:
  --   A — Process & system disconnect
  --   B — Manual override
  --   C — Conflicting automation (e.g., flow vs price rule)
  --   D — Missing governance (no validation/approval)
  --   E — Poor data quality (missing/wrong values)
  root_cause_class CHAR(1) NOT NULL CHECK (root_cause_class IN ('A','B','C','D','E')),

  -- The specific config object identified as the root cause. Stored as
  -- IDs + names so we can deep-link to the SF setup page.
  --   root_config_type: 'SBQQ__PriceRule__c', 'Flow', 'ValidationRule', etc.
  --   root_config_id:   Salesforce 15/18-char ID
  --   root_config_name: human-readable label
  root_config_type TEXT NOT NULL,
  root_config_id TEXT,
  root_config_name TEXT NOT NULL,

  -- Reason code is a stable enum the rules engine produces. Used by the
  -- renderer to pick prompt templates. Examples:
  --   'RULE_OVERRIDES_NETPRICE_ON_RENEWAL'
  --   'FLOW_MUTATES_RENEWAL_PRICING_FIELD'
  --   'DISCOUNT_SCHEDULE_FLOORS_UPLIFT'
  reason_code TEXT NOT NULL,

  -- Confidence the rules engine has in this attribution. 0.0-1.0. Lower
  -- when multiple plausible root causes exist; surfaced in UI so the
  -- user knows when to verify manually.
  confidence NUMERIC NOT NULL DEFAULT 1.0
    CHECK (confidence >= 0 AND confidence <= 1),

  -- The deterministic evidence (rule conditions matched, action target
  -- fields, run order, etc.) that the rules engine used to identify this
  -- root cause. The renderer is required to ground its plain-English
  -- explanation in this evidence (no hallucinated specifics).
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- AI-rendered plain English. Two layers: explanation (what happened)
  -- and suggested_fix (what to do). NULL when rendering failed —
  -- finding still usable from the deterministic template fallback.
  ai_explanation TEXT,
  ai_suggested_fix TEXT,
  ai_model TEXT,                -- 'gemini-2.5-flash' or 'claude-haiku-4' etc.
  ai_rendered_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS attribution_traces_finding_idx
  ON attribution_traces (finding_id);
CREATE INDEX IF NOT EXISTS attribution_traces_root_config_idx
  ON attribution_traces (root_config_type, root_config_id);

ALTER TABLE attribution_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY attribution_traces_owner_select ON attribution_traces
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY attribution_traces_owner_insert ON attribution_traces
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY attribution_traces_owner_update ON attribution_traces
  FOR UPDATE USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- 4. recovery_actions — staged recovery payloads pending user approval
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recovery_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id UUID NOT NULL REFERENCES forensic_findings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- v1: CSV export. v2: Salesforce Amendment generation. v3: direct
  -- write via Composite REST. The action_type determines what the
  -- "Commit" button on the UI actually does.
  action_type TEXT NOT NULL
    CHECK (action_type IN ('csv_export', 'amendment_draft', 'composite_patch')),

  -- The payload itself. For csv_export this is the row data; for
  -- amendment_draft this is the SBQQ__Quote__c shape we'd create.
  draft_payload JSONB NOT NULL,

  projected_reclaim_usd NUMERIC NOT NULL,

  -- Approval lifecycle:
  --   pending — staged, not yet approved
  --   approved — user clicked Commit (CSV downloaded; or write queued)
  --   committed — write completed (only applies to amendment/composite)
  --   rejected — user dismissed
  --   expired — auto-expired after 90 days unactioned
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'committed', 'rejected', 'expired')),
  approved_at TIMESTAMPTZ,
  committed_at TIMESTAMPTZ,
  committed_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS recovery_actions_finding_idx
  ON recovery_actions (finding_id);
CREATE INDEX IF NOT EXISTS recovery_actions_pending_idx
  ON recovery_actions (user_id, approval_status)
  WHERE approval_status = 'pending';

ALTER TABLE recovery_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY recovery_actions_owner_select ON recovery_actions
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY recovery_actions_owner_insert ON recovery_actions
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY recovery_actions_owner_update ON recovery_actions
  FOR UPDATE USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- 5. org_data_snapshots — cached transactional records (Bulk API output)
-- ─────────────────────────────────────────────────────────────────────
-- Privacy constraint: only IDs + financial fields. No Account names, no
-- Contact emails, no Opportunity descriptions. The 'no_pii' assertion is
-- enforced at the writing layer (lib/forensics/snapshots.ts), not the
-- DB. Retention defaults to 90 days; UI can offer 7/30/90 per org.
CREATE TABLE IF NOT EXISTS org_data_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Which SObject this snapshot is for: 'SBQQ__Quote__c',
  -- 'SBQQ__QuoteLine__c', 'Order', 'OrderItem', 'SBQQ__Subscription__c',
  -- 'Contract', 'Asset', etc.
  record_type TEXT NOT NULL,

  -- The forensic scan that produced this snapshot. Same snapshot can
  -- be reused by a follow-up forensic scan within the retention window
  -- — saves a Bulk API pull.
  produced_by_scan_id UUID REFERENCES forensic_scans(id) ON DELETE SET NULL,

  -- Window the data covers. For renewal scans we typically pull 24
  -- months of relevant records.
  data_from TIMESTAMPTZ,
  data_to TIMESTAMPTZ,

  record_count INTEGER NOT NULL DEFAULT 0,
  records JSONB NOT NULL DEFAULT '[]'::jsonb,

  retention_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS org_data_snapshots_lookup_idx
  ON org_data_snapshots (organization_id, record_type, created_at DESC);
CREATE INDEX IF NOT EXISTS org_data_snapshots_retention_idx
  ON org_data_snapshots (retention_until)
  WHERE retention_until IS NOT NULL;

ALTER TABLE org_data_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_data_snapshots_owner_select ON org_data_snapshots
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY org_data_snapshots_owner_insert ON org_data_snapshots
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY org_data_snapshots_owner_delete ON org_data_snapshots
  FOR DELETE USING (user_id = auth.uid());

COMMENT ON TABLE forensic_scans IS
  'One row per forensic (revenue leakage) scan. Separate from scans because forensic scans have different lifecycle, async execution via Bulk API, and different cost characteristics.';

COMMENT ON TABLE forensic_findings IS
  'One row per detected revenue leak with VERIFIED $ (gap_usd computed from actual transactional records).';

COMMENT ON TABLE attribution_traces IS
  'Root cause analysis per finding — which config object is responsible, deterministic evidence, and AI-rendered explanation.';

COMMENT ON TABLE recovery_actions IS
  'Staged recovery payloads pending human approval. v1 = CSV export; v2 = Salesforce Amendment draft.';

COMMENT ON TABLE org_data_snapshots IS
  'Cached Bulk API output. PRIVACY: only IDs + financial fields; no PII. 90-day retention by default.';
