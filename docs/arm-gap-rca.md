# ARM remote-scan gap — root cause analysis

**Question:** Why do 12 ARM detectors fire on Vercel scan but return 0 on Salesforce remote scan, even when both are contemporaneous against the same org?

**TL;DR:** Schema-version variance. The Ksolves-Sanjeev ARM org runs an older Revenue Cloud Advanced release where 4 fields/objects the Apex SOQL references don't exist. Apex bundles' try/catch swallows the `INVALID_FIELD`/`INVALID_TYPE` errors silently → 0 findings. Vercel uses a `safeARMQuery` wrapper that also returns empty arrays on these failures, but its check framework appears to emit 1 placeholder finding per check_id regardless — which is what produces the 12 Vercel-only ARM detectors. **Apex's zero-findings behavior is technically more correct than Vercel's placeholder behavior, but it should also work on orgs that DO have these schema elements.**

---

## Diagnostic method

Ran the exact SOQL queries that each of the 12 missing detectors uses, via the production code path (`OrgQueryService.query` with a `DetectorContext` built from `ConnectedOrg__c` + Named Credential `OrgPrism_ARM`), and recorded which succeeded vs which threw HTTP 400.

Also confirmed both paths target the same Salesforce Org Id (`00DdM00000qqFTFUA2`, user `sanjeev.price.manage@revenue.com`) — the org just has two My Domain aliases (`ksolves-b8-dev-ed` and `orgprism-b8-dev-ed`).

## Findings

| Apex SOQL element | Org has? | Error | Detectors affected |
|---|---|---|---|
| `ProductSellingModelOption.IsActive` (field) | ❌ NO | `INVALID_FIELD: No such column 'IsActive' on entity 'ProductSellingModelOption'` | ARM-001, ARM-012, ARM-019, ARM-133 (4) |
| `RateCardEntry` (object) | ❌ NO | `INVALID_TYPE: sObject type 'RateCardEntry' is not supported` | ARM-021, ARM-022, ARM-023 (3) |
| `UnitOfMeasureClass` (object) | ❌ NO | `INVALID_TYPE: sObject type 'UnitOfMeasureClass' is not supported` | ARM-040, ARM-044 (2) |
| `ProductFulfillmentScenario.Status` (field) | ❌ NO | `INVALID_FIELD: No such column 'Status' on entity 'ProductFulfillmentScenario'` | ARM-048 (1) |
| Product2 active, ContextDefinition, AttributeDefinition, FulfillmentStepDefinition | ✅ yes | (succeeded) | (passes) |

The 12 detectors that didn't fire on Apex collapse into 4 root causes, all schema-version drift between this org and the Apex SOQL.

## Why Vercel reports findings anyway

Vercel uses a `safeARMQuery` wrapper in `src/lib/salesforce/queries-arm.ts` that catches errors and returns `[]`. So Vercel's `data.rateCardEntries` is also empty on this org. Yet Vercel's check engine emits 1 placeholder finding per check_id for many of these detectors.

This looks like a Vercel bug where checks emit "0 affected records" findings instead of skipping cleanly. Apex doesn't do this — when a detector's source data is empty/missing, Apex returns zero findings (the correct behavior). **In this specific dimension Apex is more correct than the Vercel reference.**

## Recommended next step — Phase 22i: schema-tolerant SOQL fallback

For the 5 affected Apex bundles, add a `queryWithFallback` pattern:

1. **`OrgQueryService.queryWithFallback(ctx, strictSoql, looseSoql)`** helper — try strict, on specific HTTP 400 patterns try loose, return empty list if both fail.
2. **PSMO queries** drop `IsActive` filter; treat null IsActive as active in-memory.
3. **RateCardEntry / UnitOfMeasureClass bundles** probe sObject existence via a 1-row query before running the main SOQL.
4. **ProductFulfillmentScenario.Status** — fallback to query without Status, in-memory filter.

Scope: ~50 LOC across 5 bundles + 1 helper + tests.

After Phase 22i ships, re-run the comparison on this same org and we expect the V-only ARM list to drop close to zero (the remaining gap being Vercel's placeholder-finding bug, which we don't want to replicate).

## Source files

- `salesforce/force-app/main/default/classes/OrgQueryService.cls` — the remote-query helper that swallows the errors today
- `salesforce/force-app/main/default/classes/ArmCatalogChecksBundle.cls` — owns ARM-001, 010, 018
- `salesforce/force-app/main/default/classes/ArmSellingModelChecksBundle.cls` — owns ARM-012, 019, 133
- `salesforce/force-app/main/default/classes/ArmRateCardProcedureChecksBundle.cls` — owns ARM-021, 022, 023
- `salesforce/force-app/main/default/classes/ArmUsageManagementChecksBundle.cls` — owns ARM-040, 044
- `salesforce/force-app/main/default/classes/ArmOrchestrationChecksBundle.cls` — owns ARM-048

## Test org context

- Salesforce Org Id: `00DdM00000qqFTFUA2`
- User: `sanjeev.price.manage@revenue.com`
- My Domains: `ksolves-b8-dev-ed.develop.my.salesforce.com`, `orgprism-b8-dev-ed.develop.my.salesforce.com`, `revenue.my.salesforce.com`
- Named Credential (Techtorch host): `OrgPrism_ARM`
- ConnectedOrg__c: `a0WVs000002ZkRpMAK`
