# Vercel vs Salesforce — contemporaneous comparison v3

**Scope:** the third contemporaneous comparison after Phase 22i (schema-tolerant fallback) and Phase 22j (per-query isolation on `ArmCatalogChecksBundle`). v1 and v2 are preserved in their own docs for the diff trail.

## Inputs

| Side | Scan | Score | Findings |
|---|---|---|---|
| Salesforce ARM (post-22j) | `FS-0042` (`a0SVs00000o2NWnMAM`) | TBD | 22 findings, 16 unique detectors |
| Salesforce CPQ+Billing (post-22j) | `FS-0045` (`a0SVs00000o1emfMAA`) | TBD | TBD |
| Vercel ARM | v2 baseline (no re-fire — 22j changes only affect Apex/Salesforce side) | 87 | 16 detectors |
| Vercel CPQ+Billing | v2 baseline | 42 | 65 findings |

(v2 Vercel data is still authoritative because Phase 22h/i/j changed Apex behavior only — Vercel emits the same set of findings as v2.)

---

## ARM — gap progression

| Phase | Salesforce ARM detectors firing | Δ vs Vercel (16 total) |
|---|---|---|
| v2 (pre-22i) | 7 — ARM-003, 008, 014, 015, 016, 028, 132 | −9 (V-only) |
| 22i (PSMO fallback) | 8 — added ARM-046, 048; lost ARM-132 (over-firing fixed) | −8 |
| **22j (per-query isolation) — FS-0042** | **11 — added ARM-001, ARM-002b, ARM-018** | **−5** |

**Phase 22j root cause.** `ArmCatalogChecksBundle.run()` had a single `try/catch` around all five queries. When `ProductCategory.IsActive` (missing on the target org) threw `INVALID_FIELD`, the catch swallowed it and returned an empty result list — silently killing ARM-001, ARM-002b, ARM-010, ARM-018 even though four of them have no dependency on `ProductCategory`. Phase 22j replaces the single try/catch with per-query `OrgQueryService.queryWithFallback(strict, loose)` so each query degrades independently.

Direct call to the bundle on the Ksolves-Sanjeev ARM org (`OrgPrism_ARM` Named Credential) now reports:

```
FIRED:ARM-001  | 1 active product(s) have no selling model
FIRED:ARM-002b | 8 active product(s) with no pricing path
FIRED:ARM-018  | 8 active product(s) without category assignment
```

Also adjusted `evaluateARM010` to treat a `categories` row without an `IsActive` key as active (consistent with how `evaluateARM001` already treats `IsActive`-less PSMO rows post-22i).

## ARM — still V-only after 22j (5 detectors)

| Detector | Apex universe | Root cause |
|---|---|---|
| ARM-009 | `ContextDefinition` object missing on target | Apex returns zero findings cleanly; Vercel emits placeholder |
| ARM-030 | Same as above | Same |
| ARM-022 | `RateCardEntry` object missing on target | Same |
| ARM-040 | `UnitOfMeasureClass` object missing on target | Same |
| ARM-045 | All fulfillment steps have a group (true) | Genuine data state |

For the 4 schema-driven gaps, **zero findings is the correct behavior** — Vercel's placeholder-finding noise is the bug, not Salesforce's silence. The ARM-045 case is just clean data.

---

## CPQ+Billing — V-only diagnostic findings

Direct SOQL on the cpq target via `sf data query` shows that several V-only CPQ detectors **do** have data that should produce findings, meaning a similar bundle-level fix may be needed:

| Detector | Data found | Predicate |
|---|---|---|
| PR-002 | **5 active rules** with no PriceConditions, **2** with no PriceActions | Active price rule lacks conditions or actions |
| PRD-003 | **2 active rules** with no actions and no error conditions | Empty product rule |
| LQ-005 | **3 active selection rules** with null EvaluationOrder (5 total) | Selection rule lacks evaluation order |
| SR-002 | **3 subscriptions** with null/zero ProrateMultiplier | Co-term math will break |
| SR-003 | **3 subscriptions** with null Contract | Orphaned subs |
| IA-004 | **1 contracted price** linked to inactive product | Dead pricing |
| LE-001 | **0 legal entities** on org | Genuine data state — V-only is placeholder noise |
| CP-003 | (unverified) | Contracted prices without source quote line |
| PR-004, PRD-002, PRD-005, IA-003, SV-006 | (unverified — predicates need cross-aggregation, not testable via plain SOQL) | Various |

**Conclusion:** at least 6 of 16 V-only CPQ detectors have data that should fire on Salesforce but doesn't. The same outer-try/catch or bundle-level integration bug pattern that caused the ARM regression likely applies to one or more CPQ bundles (`PriceRuleChecksBundle`, `ProductRuleChecksBundle`, `SubscriptionChecksBundle`, `ImpactAnalysisChecksBundle`, `ContractedPriceChecksBundle`). **Per-bundle code review is Phase 22k future work** — out of scope for 22j.

---

## What still differs (after 22j)

- **ARM:** 5 V-only detectors remain, 4 of which are correctly silent (data/schema-driven). Phase 22j closed 3 of the 8 V-only detectors v2 documented.
- **CPQ+Billing:** 16 V-only detectors. Diagnostic SOQL shows at least 6 should fire on Salesforce — Phase 22k work item.
- **Scoring:** Salesforce ARM score will move once recalculated against FS-0042 (3 new findings of varying severity); CPQ score should be unchanged from v2 since 22j doesn't touch CPQ bundles.

## Verdict

Phase 22i + 22j together close the ARM-side schema-version drift gap and surface a fresh family of CPQ-side bundle bugs that v2 was unable to distinguish from "Vercel placeholder noise." The investigation moved 6+ CPQ detectors from "is this a real difference or just Vercel noise?" to "this is a real bug — file Phase 22k."
