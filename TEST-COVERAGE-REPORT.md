# OrgPrism — Test Coverage Report

**Date:** 2026-05-29
**Total Tests:** 1,163 | **Passed:** 1,163 | **Failed:** 0
**Test Files:** 52 | **Health Checks Covered:** 209 | **Categories:** 49 | **Execution Time:** ~2.6s

> Salesforce Revenue Cloud audit platform. Automated quality gates on every commit, TypeScript strict, drift-guarded marketing numbers, full CI/CD via Vercel.

---

## 1. At a glance

| Metric | Value |
|---|---|
| Total tests | **1,163** |
| Test files | 52 |
| Pass rate | **100%** |
| Wall time | ~2.6 seconds |
| TypeScript | Strict mode, zero `any` |
| ESLint | Clean |
| Production build | Passes on every commit |

---

## 2. Testing types covered

Every test file mixes multiple types — positive (does it detect?), negative (does it avoid false positives?), boundary (exact thresholds), edge (empty / null / extreme values).

| Type | Description | Coverage |
|---|---|---|
| **Unit** | Individual check functions tested in isolation with crafted data | All 209 checks |
| **Integration** | Full engine runs end-to-end with realistic org configurations | CPQ + Billing + ARM engines |
| **Positive** | Verifies system correctly DETECTS issues in problematic data | Every check |
| **Negative** | Verifies system does NOT raise false positives on clean data | Every check |
| **Boundary** | Tests at exact thresholds (e.g., 49 rules = OK, 50 = flag; 2 loops = OK, 3 = flag) | PERF + custom-scripts + AI throttle |
| **Edge cases** | Empty arrays, null values, whitespace strings, extreme counts | All suites |
| **Score validation** | Ensures scores stay 0-100, weights work correctly, severity impacts scores | `engine.test.ts`, `integration-scan-scenarios.test.ts` |
| **Data integrity** | Validates all issues have required fields (check_id, category, severity, affected_records) | `integration-scan-scenarios.test.ts` |
| **API contract** | Request/response shape, status codes, auth gates | 17 routes |
| **Drift guard** | Marketing copy numbers must match live arrays | `check-counts.test.ts` |

---

## 3. Coverage by domain

### Analysis engine — 34 files · 989 tests

One `*-comprehensive.test.ts` file per check category, plus integration scenarios and engine-level orchestration tests.

**CPQ check suite** (92 checks across 19 categories):
- `price-rules-comprehensive.test.ts` + `price-rules.test.ts`
- `discount-schedules-comprehensive.test.ts`
- `products-comprehensive.test.ts`
- `product-rules-comprehensive.test.ts`
- `cpq-settings-comprehensive.test.ts`
- `quote-lines-comprehensive.test.ts`
- `subscriptions-comprehensive.test.ts`
- `twin-fields-comprehensive.test.ts`
- `contracted-prices-comprehensive.test.ts`
- `summary-variables-comprehensive.test.ts` + `summary-variables.test.ts`
- `approval-rules-comprehensive.test.ts` + `approval-rules.test.ts`
- `custom-scripts-comprehensive.test.ts` + `custom-scripts.test.ts`
- `quote-templates-comprehensive.test.ts`
- `configuration-attributes-comprehensive.test.ts`
- `guided-selling-comprehensive.test.ts`
- `advanced-pricing-comprehensive.test.ts` + `advanced-pricing.test.ts`
- `performance-comprehensive.test.ts` + `performance.test.ts`
- `impact-analysis-comprehensive.test.ts` + `impact-analysis.test.ts`
- `usage-analytics-comprehensive.test.ts` + `usage-analytics.test.ts`
- `bundle-integrity-comprehensive.test.ts`
- `lookup-queries-comprehensive.test.ts`

**Billing check suite** (39 checks across 8 categories):
- `billing-rules-comprehensive.test.ts`
- `rev-rec-rules-comprehensive.test.ts`
- `tax-rules-comprehensive.test.ts`
- `finance-books-comprehensive.test.ts`
- `gl-rules-comprehensive.test.ts`
- `legal-entity-comprehensive.test.ts`
- `product-billing-config-comprehensive.test.ts`
- `invoicing-comprehensive.test.ts`

**ARM check suite** (78 checks across 22 categories):
- `arm-checks-positive-negative.test.ts`
- `arm-engine-dryrun.test.ts`

**Engine-level orchestration:**
- `engine.test.ts` — CPQ engine orchestration, scoring, category aggregation
- `integration-scan-scenarios.test.ts` — Realistic multi-issue org scenarios

**Drift guard:**
- `check-counts.test.ts` — 8 assertions tying marketing numbers to live arrays

### API routes — 14 files · 136 tests

- `api-auth-me.test.ts` — current user GET + PUT
- `api-orgs.test.ts` — list, create, disconnect
- `api-scans.test.ts` — start, status, listing
- `api-issues.test.ts` — list, update status
- `api-exports.test.ts` — JSON data export
- `api-usage.test.ts` — usage stats

### AI integrations — 3 files · 27 tests

- `api-ai-explain.test.ts` — issue-explain endpoint
- `api-ai-fix.test.ts` — issue-fix suggestion endpoint
- `api-ai-insights.test.ts` — scan diff + remediation plan

---

## 4. Quality gates

Every commit to `master` must pass all of these before Vercel will promote it to production:

| Gate | Command | Status |
|---|---|---|
| **1,163 unit tests pass** | `npm test` | ✅ |
| **TypeScript strict** | `tsc --noEmit` | ✅ |
| **ESLint clean** | `eslint src` | ✅ |
| **Production build** | `next build` | ✅ |
| **Drift guard** | `check-counts.test.ts` | ✅ |
| **Vercel preview deploy** | auto on push | ✅ |

---

## 5. Test patterns established

| Pattern | Used in | Why |
|---|---|---|
| **Positive + negative pair** | Every check | "Crafted-bad data triggers; crafted-good data doesn't" — guarantees no false positives or false negatives |
| **Boundary at threshold** | PERF, custom-scripts, AI throttle | Catches off-by-one bugs in heuristics (e.g., throttle is 7.5s exactly, not 7 or 8) |
| **Empty / null / unset** | ARM data normalization, defensive arrays | Real customer data has gaps; engine must never crash on missing fields |
| **Mock chain factories** | API route tests | Single helper builds a Supabase client mock with every method on a chain |
| **Drift assertion** | `check-counts.test.ts` | Marketing numbers must equal live array lengths or CI fails |
| **Realistic data integration** | `integration-scan-scenarios.test.ts` | Multi-issue org configurations exercise the full pipeline, not just isolated checks |

---

## 6. What's protected from regression

### Critical correctness
- Score stays 0–100 regardless of input
- Severity weights compute correctly
- Issue counts (critical / warning / info) match the issues array
- Affected records are always populated for findings
- Empty org → zero issues, no crashes

### Security boundaries
- Export endpoint strips `access_token`, `refresh_token`, `sf_client_id`, `sf_client_secret`
- Auth gate rejects expired sessions with 401
- Issue PUT rejects invalid status values
- Cron endpoints require Bearer `CRON_SECRET`

### AI integration safety
- Throttle enforces 7.5s gap between AI calls per user
- Retry handles 429 / 503 / network errors with exponential backoff
- Failed Gemini calls don't kill the scan
- Quota check blocks AI calls when monthly limit reached

### Scan engine resilience
- Missing data fields don't crash checks (ARM data normalization)
- Concurrent scans rejected with 409 (per-user serial gate)
- Stuck scans auto-recover via cron worker
- Per-org BYO-ECA credentials flow through to jsforce auto-refresh

---

## 7. Growth over time

| Date | Tests | Files | Health Checks | Categories | Notes |
|---|---:|---:|---:|---:|---|
| 2026-04-13 | 603 | 29 | 68 | 17 | CPQ-only baseline (initial release) |
| 2026-05-01 | ~900 | ~40 | 131 | 27 | Billing suite added |
| 2026-05-27 | 1,155 | 51 | 208 | 49 | ARM (Revenue Cloud) suite shipped |
| **2026-05-29** | **1,163** | **52** | **209** | **49** | **ARM-002b + drift guard added** |

Roughly **1.93× test growth and 3.07× check growth in ~7 weeks** — every new check ships with at least one positive + one negative test.

---

## 8. Running the suite

```bash
# Full run (~2.6 seconds)
npm test

# Watch mode for development
npm run test:watch

# Just the drift guard
npx vitest run src/__tests__/check-counts.test.ts

# Run a specific suite
npx vitest run src/__tests__/arm-checks-positive-negative.test.ts
```

---

## 9. Visualization

A polished HTML version of this report sits alongside this Markdown file at `test-coverage-report.html`. Open it in a browser for the dashboard-style view with stat tiles, badges, and grids.

---

*Generated 2026-05-29 · OrgPrism is built on Next.js 14 + Supabase Postgres + Vitest 3*
*Live at [orgprism.vercel.app](https://orgprism.vercel.app)*
