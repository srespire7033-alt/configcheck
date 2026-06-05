# Vercel vs Salesforce — contemporaneous comparison v4

**Why v4.** v2 and v3 measured Salesforce against scans that were silently truncating past callout 100 due to the bug Phase 22L fixed. The CPQ-side numbers in those docs reflected a partial scan. v4 is the first comparison where Salesforce completes the full detector pass on both targets.

## Inputs

| Side | Scan | Score | Findings | Detectors | Severity (C/W/I) |
|---|---|---|---|---|---|
| Salesforce CPQ+Billing | `FS-0047` (`a0SVs00000o2a2bMAA`) | **73** | 69 | **48** | — |
| Salesforce ARM | `FS-0048` (`a0SVs00000o2cVpMAI`) | **86** | 21 | **15** | — |
| Vercel CPQ+Billing | `27111bea-…` (org `6a19a55d`) | **42** | 65 | **52** | 21 / 30 / 14 |
| Vercel ARM | `a087edea-…` (org `782a2c29`) | **87** | 16 | **16** | 4 / 10 / 2 |

All four scans completed within ~30 minutes of each other on 2026-06-05.

---

## Headline

| Metric | Vercel | Salesforce (post-22L) | Delta |
|---|---|---|---|
| **CPQ+Billing score** | 42 | **73** | +31 |
| CPQ+Billing detectors | 52 | 48 | −4 |
| CPQ+Billing findings | 65 | 69 | +4 |
| CPQ+Billing leakage | (not surfaced) | **$313,095** | — |
| **ARM score** | 87 | 86 | −1 |
| ARM detectors | 16 | 15 (11 ARM-specific) | −1 |
| ARM findings | 16 | 21 | +5 |

The score gap on CPQ (42 vs 73) is the formula difference — Vercel uses the older linear penalty, Salesforce uses Phase 22d's sqrt curve. **Detector coverage is now near-parity (48 vs 52)** with 36 detectors firing on both sides; the residual ±4 is real and explained below.

---

## CPQ+Billing — set diff

**Both sides (36 detectors)**: AP-001, AP-004, BN-005, BR-002, BR-003, BR-004, CA-004, CP-001, DS-001, DS-002, DS-003, FB-006, GL-001, GL-003, GL-005, IA-003, IA-004, INV-001, LQ-005, PB-001, PB-002, PERF-005, PR-002, PRD-002, PRD-003, QCP-001, RR-001, RR-003, RR-004, SR-001, SR-004, TR-001, TR-002, TR-003, TR-004, UA-001

**Vercel-only (16)** — verified to be either data-correct silence on SF (CPQ direct invocation confirmed via Phase 22k diagnostic) or Vercel placeholder noise:

| Vercel detector | Status |
|---|---|
| BN-001, BR-001 | Bundle / Billing Rule — port exists but predicate not matched on current data |
| CP-003 | Confirmed data-correct silence (all contracted prices have SBQQ__OriginalQuoteLine__c populated) |
| LE-001 | Confirmed data-correct silence (0 LegalEntities on org) |
| PBC-001…006 | Product Billing Config bundle — V emits 1 placeholder per check; SF Phase 22h consolidated to PB-001/2/3/4 (already firing) — these are duplicates renamed in Phase 22h |
| PR-004 | 3+ rules write same field — data state doesn't satisfy (no field has 3+ writers) |
| PRD-005 | Deferred in Phase 22a-3 — intentionally not ported (UA-003 covers the rule-cleanliness aggregate) |
| SR-002, SR-003 | Confirmed data-correct silence (all subs have ProrateMultiplier + Contract set) |
| SV-006 | Predicate not matched on current data |
| TF-001 | Twin Field check — port exists but data doesn't trigger |

**Salesforce-only (12)**:

| SF detector | Why V doesn't have it |
|---|---|
| ARM-001, ARM-002b, ARM-037 | ARM detectors firing on the CPQ org because Phase 22a-0 surface-gating allows them on remote scans; harmless but should be filtered (Phase 22m) |
| PB-003, PB-004 | Phase 22h consolidation — single detector emits multiple variants; V doesn't have these yet |
| PRD-004 | Validation rule missing condition logic — newer detector in SF, no V equivalent |
| PROV-FOR-002 | Forensic detector (active subscription without asset) — SF emits 10 findings; V port pending |
| QL-001, QL-004 | Quote line checks — SF-only |
| QT-002, QT-003, QT-005 | Quote template checks — SF-only |

---

## ARM — set diff

**Both sides (9)**: ARM-001, ARM-002b, ARM-003, ARM-008, ARM-016, ARM-018, ARM-028, ARM-046, ARM-048

**Vercel-only (7)** — all confirmed correctly silent on SF (see `arm-gap-rca.md`):

| V detector | Root cause |
|---|---|
| ARM-009, ARM-030 | `ContextDefinition` object missing on target org |
| ARM-022 | `RateCardEntry` object missing |
| ARM-024, ARM-025 | AttributeDefinition predicates not triggered by current data |
| ARM-040 | `UnitOfMeasureClass` object missing |
| ARM-045 | Genuine data-correct silence (all fulfillment steps have a group) |

V emits placeholder findings for the schema-missing cases regardless of data. SF's silence is the correct behavior — there's no data to flag.

**Salesforce-only (2)**:
- **ARM-014, ARM-015** — newer ARM detectors added in Phase 22c-1 / 22c-3 that V doesn't yet have

---

## What changed between v3 and v4

| Item | v3 (truncated) | v4 (complete) |
|---|---|---|
| CPQ unique detectors firing on SF | ~13 (estimated; we never had clean data) | **48** |
| CPQ findings on SF | reported 55 in v2 (TRUNCATED) | **69** |
| CPQ score on SF | 72 (TRUNCATED data) | **73** |
| Detector parity (both sides) | unknowable | **36** |
| Genuine V-only on CPQ | unknowable | **16** (10 are placeholder/data-state) |
| Genuine S-only on CPQ | unknowable | **12** (mostly real SF advancements) |
| Stuck "Running" scans | 4+ orphan | All scans resolve cleanly |

---

## Verdict

**CPQ:** Salesforce now scans more comprehensively than Vercel (69 findings on real data vs. Vercel's 65, with 36 matching detectors). The 16 V-only detectors break down to ~10 placeholder/data-state false positives + 6 detectors with real but un-triggered predicates. The 12 S-only includes 3 ARM-misfires to clean up + 9 legitimate SF advancements not yet ported back to V.

**ARM:** Effective parity on shared detectors (9 of 11 match perfectly). The 7 V-only ARM detectors are all schema-variance noise — V emits placeholders, SF correctly stays silent. The 2 S-only are real new detectors V hasn't ported.

**Phase 22L unblocked the comparison entirely.** Before today, every Salesforce CPQ scan was silently dying at callout 101 and we were comparing against truncated data. The "Salesforce is missing 16 V-only detectors" v2/v3 narrative was a fiction created by the callout governor, layered on top of a genuine but smaller (~10 detector) parity gap.

## Next-step Phase 22m candidates

1. Filter ARM-001/002b/037 out of CPQ-typed remote scans (the surface-gate let them slip through)
2. Port PROV-FOR-002 (forensic detector) to Vercel for parity
3. Phase 22h port the PBC-001…006 V duplicates so V emits SF's PB-001..004 instead

Lower priority — most parity gaps in this comparison are documented and not silently wrong.
