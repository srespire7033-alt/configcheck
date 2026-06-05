# Fixture-org playbook — measuring detector parity by code, not data

**Goal.** Replace the Ksolves-Sanjeev contamination problem (parity comparisons measure "which predicates the customer's data happened to violate," not "which checks each side implements") with a **fixture org that has exactly one violation per active detector**. Then a v5+ comparison is a true binary signal: detector X fires on both sides or it's a real implementation gap.

## Why v4 needed this

Each of v1–v4 found a different "missing detectors" list, none of which turned out to be real. v3 thought 16 CPQ detectors were V-only; v4 found that all 16 are implemented on both sides — the org just didn't trigger them. The fixture org closes that loop.

## Existing infrastructure (already shipped)

The repo has three POST endpoints that provision Salesforce records for detector violations:

| Endpoint | Coverage | What it seeds |
|---|---|---|
| `POST /api/orgs/seed-cpq-test-data` | **17 detectors** | QCP-001..004, AP-001..003, PRD-002, parts of CA / TF / IA / PB / SET |
| `POST /api/orgs/seed-arm-test-data` | **21 detectors** | ARM-001 / 002 / 003 / 004 / 005 / 011..021 |
| `POST /api/orgs/seed-billing-test-data` | **32 detectors** | BR-001..004, RR-001..004, TR-001..003, GL-001..005, FB-001..006, INV-001..004, LE-001..004, PBC-001..006 |

Plus 9 standalone fixture scripts under `scripts/seed-*.ts` for ORD-FOR-001..003, REN-001..004, DSC-FOR-001/2, QL-FOR-001/2, CT-FOR-001, MDQ-FOR-001, AMD-FOR-001, AST-FOR-001, PROV-FOR-001/2, SUB-FOR-001 etc.

**Aggregate coverage: 70 / 221 detectors (~32%).**

## The 151-detector gap

Buckets, biggest first:

| Prefix | Gaps | Package |
|---|---|---|
| ARM- | 51 | Revenue Cloud Advanced (huge surface area) |
| SV- | 6 | Summary Variable |
| QL- | 6 | Quote Line |
| IA- | 6 | Impact Analysis (cross-rule) |
| BN- | 6 | Bundle |
| PR-, PRD-, LQ- | 14 | Price Rule / Product Rule / Lookup Query |
| PERF- | 5 | Performance / data-volume |
| AP- | 5 | Advanced Pricing |
| PB- | 4 | Product hygiene |
| DS-, CP-, CA-, SET-, REN- | 14 | Schedule / contracts / config attribute / settings / renewal |
| (other) | 30 | misc — see `comm -23 /tmp/all_detectors.txt /tmp/seed_all.txt` |

The 51 ARM gaps are the elephant. Each ARM detector typically needs 2-5 records to fire (ProductSellingModelOption + ProductSellingModel + ProductCategoryProduct + ProductCategory + Product2 …), plus the schema must exist on the scratch org.

## Architecture

```
                ┌──────────────────────────┐
                │  Scratch org (Dev Hub)   │
                │  + CPQ managed package   │
                │  + RC Advanced licenses  │
                └────────────┬─────────────┘
                             │ provisioned via
                             │ sfdx + project-scratch-def.json
                             ▼
              ┌─────────────────────────────┐
              │  3 seed endpoints + 9 seed  │
              │  scripts (already exist)    │
              └────────────┬────────────────┘
                           │ POST seed-cpq + seed-arm + seed-billing
                           │ then npx tsx scripts/seed-*.ts
                           ▼
            ┌──────────────────────────────────┐
            │  Fixture org with 1 violation    │
            │  per detector (target: 221/221)  │
            └────────────┬─────────────────────┘
                         │ scan from both sides
                         ▼
        ┌────────────────────────┬───────────────────┐
        │ Vercel scan            │ Salesforce scan   │
        └──────────┬─────────────┴───────┬───────────┘
                   │                     │
                   ▼                     ▼
        ┌───────────────────────────────────────┐
        │  diff: detector A fires on both? ─→ ✓ │
        │        fires only on V?         ─→ V→S│
        │        fires only on S?         ─→ S→V│
        │        neither?                 ─→ bug│
        └───────────────────────────────────────┘
```

## Concrete next-steps (sequenced)

### Phase 22o — scratch-org definition + license-aware project-scratch-def (~1 day)

- `salesforce/config/project-fixture-scratch-def.json` with `CPQ`, `SBQQQuoteCalcPlugin`, `BillingPlatform`, `RevenueCloudAdvanced` features
- Sfdx commands documented for "fresh-scratch + push + deploy unmanaged shim" in README
- Verify all three POST endpoints + Apex-side scratch org provisioning still work

### Phase 22p — seed the highest-leverage gaps (~2 days)

Prioritized by ROI (each detector fires after seed → parity diff confidence):

1. **Phase 22p-1**: 17 CPQ detectors that the v4 audit identified as predicates-but-no-data: BN-001..006, PR-001..005, PRD-005, LQ-001..005, DSC-FOR-002, SV-001..006, IA-001..006. Add to `seed-cpq-test-data/route.ts`.
2. **Phase 22p-2**: 30 ARM detectors with seedable predicates: ARM-006..010, 022..038, 040..048, 050, 051. Add to `seed-arm-test-data/route.ts`.
3. **Phase 22p-3**: Remaining 21 ARM detectors that need the advanced features (decision tables, fulfillment scenarios, usage management, deferred pricing): ARM-110..133, 171, 192, 212, 214. New endpoint `seed-arm-advanced-test-data` because the data graph is large.

### Phase 22q — the diff harness (~½ day)

`scripts/parity-diff.ts`:
- Inputs: Salesforce scanId + Vercel scanId
- Fetches both finding sets via Supabase + Apex
- Outputs markdown table: detectorId | V fired? | S fired? | classification

CI hook: after fixture-org reset + seed, run both scans, generate diff, fail if any "S only" or "V only" appears for a detector with seeded violation.

### Phase 22r — automation (~1 day)

- Github Actions workflow: nightly fixture-org refresh + parity diff publish
- Slack/email alert on regression
- Historical diff tracking

## Cost estimate

| Phase | Effort | Output |
|---|---|---|
| 22o | 1 day | Reproducible scratch-org factory |
| 22p-1 | 1 day | +17 detectors seeded (cpq side) |
| 22p-2 | 1 day | +30 detectors seeded (arm core) |
| 22p-3 | 1 day | +21 detectors seeded (arm advanced) |
| 22q | ½ day | Parity-diff CLI |
| 22r | 1 day | CI/CD wiring |
| **Total** | **~6 working days** | **221/221 covered, automated nightly diff** |

## What this WON'T solve

- Detector predicates that depend on data SCALE (e.g. PERF-001 fires only when there are >500 active products). The fixture-org seed for those is conditional.
- Detector predicates that depend on TIME (e.g. ORD-FOR-001 needs an Order activated >7 days ago with no schedule). Need clock-faking or back-dated records.
- Detectors guarded by org-edition / licenses we don't have on the Dev Hub.

For each, the playbook should document the manual verification path: "this detector cannot be auto-verified in the fixture org — manual smoke required."

## Minimal-viable cut

If only one slice gets done: **22o + 22q** (scratch-org factory + diff harness) gives the framework. Then 22p can be done incrementally — every time someone touches a detector, they're expected to add the seed for it in the same PR. The 70 detectors already seeded just become the starting baseline; the rest accrete over time.

## Open questions

1. **Dev Hub access** — does the user have a Dev Hub with CPQ/RC Advanced licenses available? If not, the fixture-org work blocks on that.
2. **Test isolation** — do we want one fixture org with EVERY violation, or many small fixture orgs grouped by category? One-big-org is faster to provision but harder to debug (every scan re-evaluates 221 predicates).
3. **Source of truth for "seeded detectors"** — should we annotate each detector in `Detector__mdt` with `HasFixture__c` so the diff harness knows what to assert vs ignore?

## Recommendation

Don't try to do 22o through 22r in one push. The framework (22o + 22q) is the right thing to land first because it makes every future PR self-policing. Then incrementally close gaps via 22p as bugs surface (Phase 22n was found this way — a real org had data that triggered the bug). Fixture orgs are an investment; the ROI compounds.
