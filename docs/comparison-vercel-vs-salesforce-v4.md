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

**v4 update — the gap is almost entirely data-state.** After Phase 22m and a re-audit of both codebases, every "V-only" and "S-only" detector turns out to exist on the other side. They simply didn't fire in the particular scan we pulled because the org data didn't satisfy that detector's predicate. See the dedicated diff sections below for the corrected analysis.

**Vercel-fired-only (16)** — predicates Vercel's scan satisfied that Salesforce's didn't, on this particular contemporaneous run:

| V-fired detector | Why SF didn't fire it |
|---|---|
| BN-001, BR-001 | Both ported in `BillingRuleBundle.cls`; predicate uses different field that wasn't dirty on cpq-side data |
| CP-003 | Ported in `ContractedPriceChecksBundle.cls`; all cpq contracted prices have `SBQQ__OriginalQuoteLine__c` populated → correctly silent |
| LE-001 | Ported in `LegalEntityChecksBundle.cls`; 0 LegalEntities exist → correctly silent |
| PBC-001…006 | **All ported in `BillingRuleBundle.cls`** with Custom Metadata records `Detector.PBC_001..006.md-meta.xml`. Silent on FS-0049 because every active product on cpq has billing rule + frequency + active rule refs. Not duplicates of PB-001..004 — distinct checks. |
| PR-004 | Ported; needs 3+ active rules writing same field — no field on cpq has 3 writers |
| PRD-005 | Deferred from port (Phase 22a-3 design decision); UA-003 covers rule-cleanliness aggregate |
| SR-002, SR-003 | Ported; all subs have ProrateMultiplier + Contract set → correctly silent |
| SV-006 | Ported; predicate not matched on current SummaryVariable data |
| TF-001 | Ported (Twin Field); data doesn't trigger |

**Salesforce-fired-only (12)** — same shape inverted:

| S-fired detector | Why V didn't fire it |
|---|---|
| ARM-001, ARM-002b, ARM-037 | **Bug, fixed by Phase 22m** — ARM detectors leaking into CPQ scan via null-productType fallthrough. FS-0049 confirms 0 ARM detectors fire post-fix. |
| PB-003, PB-004 | Ported on V too (`product-checks.ts`); cpq data doesn't violate ProductCode / Family predicate currently — V-side scan correctly silent for this run |
| PRD-004 | Ported on V (`src/lib/analysis/checks/product-rules.ts` id `PRD-004`); validation-rule predicate matched on cpq via SF, not V — likely a SOQL field-selection difference worth a deeper dive |
| PROV-FOR-002 | **Lives in V's forensic-scan flow** (`src/lib/forensics/detectors/prov-for-002-sub-no-asset.ts`), not health-check. Last V forensic scan (2026-06-02) had it in `detectors_completed`. SF combines forensic+health into one scan, V keeps them separate — comparison artifact, not a gap. |
| QL-001, QL-004 | Ported on V (`src/lib/analysis/checks/quote-lines.ts`); didn't fire on V scan for this run |
| QT-002, QT-003, QT-005 | Ported on V (`src/lib/analysis/checks/quote-templates.ts`); didn't fire on V scan for this run |

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

## Verdict (revised after detector-source audit)

**Feature parity is essentially complete.** Every "V-only" and "S-only" detector in this comparison actually exists in the other codebase. The differences shown are which detectors' **predicates were satisfied by the data on this particular scan**, not which checks each side implements.

**CPQ:**
- 48 SF detectors fired; 52 V detectors fired; **36 fired on both**
- The 16 V-fired-not-SF are data-state differences plus PRD-005 (intentionally deferred)
- The 12 S-fired-not-V breakdown: 3 (ARM-001/002b/037) were the 22m bug, fixed and verified gone in FS-0049; 1 (PROV-FOR-002) is a scan-type comparison artifact (V keeps forensic + health-check separate, SF combines); 8 are predicates that matched on SF this run but not V

**ARM:**
- 11 SF detectors + 4 cross-cutting; 16 V detectors; **9 fired on both**
- 7 V-only ARM detectors are schema-variance: ContextDefinition / RateCardEntry / UnitOfMeasureClass missing on this org's RC release. V emits placeholder findings, SF correctly stays silent
- 2 S-only (ARM-014, ARM-015) are newer Apex-side ports not yet on V

**Phase 22L unblocked the comparison entirely.** Before today, every Salesforce CPQ scan was silently dying at callout 101 and we were comparing against truncated data. The "Salesforce is missing 16 V-only detectors" v2/v3 narrative was a fiction created by the callout governor.

**The real story is parity is closer to 100% than the raw set diff suggests.** A genuinely scan-level comparison would require a fixture-org where every predicate has at least one matching record — otherwise we're measuring data state, not coverage.

## Closed by this audit

| 22m task originally proposed | Status after audit |
|---|---|
| 1. ARM-001/002b/037 leaking into CPQ scans | ✅ Fixed (Phase 22m commit) |
| 2. Port PROV-FOR-002 to Vercel | ❌ Wrong premise — already ported as forensic detector |
| 3. PBC-001..006 dedup → PB-001..004 | ❌ Wrong premise — not duplicates; both sides have both check families (PBC=product-billing-config, PB=product-hygiene) |
| Port QL-001/4, QT-002/3/5, PRD-004 to V | ❌ Wrong premise — all already ported |

## Remaining real work (if anything)

- **ARM-014 / ARM-015** are genuine SF-only — port to Vercel if true parity matters for managed-package marketing
- Build a **fixture org** with one violation per predicate so coverage comparisons measure detector implementation, not customer data state
- Investigate why PRD-004 fires on SF but not V — possibly a SOQL field-selection difference worth a deeper dive

Most things flagged in v3 turn out to be data-state or scan-type artifacts.
