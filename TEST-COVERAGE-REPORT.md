# ConfigCheck — Test Coverage Report

**Date:** 2026-04-13
**Total Tests:** 603 | **Passed:** 603 | **Failed:** 0
**Test Files:** 29 | **Health Checks:** 68 | **Categories:** 17 | **Execution Time:** ~2.2s

---

## 1. Testing Types Covered

| Testing Type | Description | Files |
|---|---|---|
| **Unit Testing** | Individual check functions tested in isolation with crafted data | 17 `*-comprehensive.test.ts` files + 8 basic test files |
| **Integration Testing** | Full engine runs end-to-end with realistic org configurations | `integration-scan-scenarios.test.ts`, `engine.test.ts` |
| **Positive Testing** | Verifies system correctly DETECTS issues in problematic data | All files — `should flag...`, `should trigger...`, `DETECT:` tests |
| **Negative Testing** | Verifies system does NOT raise false positives on clean data | All files — `should pass...`, `should skip...`, `should NOT trigger...` tests |
| **Boundary Testing** | Tests at exact thresholds (e.g., 49 rules = OK, 50 = flag; 2 loops = OK, 3 = flag) | `performance-comprehensive.test.ts`, `custom-scripts-comprehensive.test.ts` |
| **Edge Case Testing** | Empty arrays, null values, whitespace strings, extreme counts | All comprehensive files + `integration-scan-scenarios.test.ts` |
| **Score Validation** | Ensures scores stay 0-100, weights work correctly, severity impacts scores | `integration-scan-scenarios.test.ts`, `engine.test.ts` |
| **Data Integrity Testing** | Validates all issues have required fields (check_id, category, severity, etc.) | `integration-scan-scenarios.test.ts` — Scenario 5 |
| **Regression Testing** | Original basic tests still pass alongside new comprehensive tests | All basic test files |

---

## 2. All Categories & Checks Covered (68 Checks / 17 Categories)

### Price Rules (PR-001 to PR-005) — 31 tests

| Check ID | Check Name | Severity | Positive Tests (Detects Issues) | Negative Tests (No False Positives) |
|---|---|---|---|---|
| PR-001 | Conflicting Price Rules | Critical | Same order + same target field; Multiple conflicts | Unique orders; Different target fields; Inactive skipped; Empty |
| PR-002 | Dead Price Rules | Warning | No conditions; No actions; Both missing | Has conditions + actions; Inactive skipped |
| PR-003 | Evaluation Order Gaps | Warning | Large gap (10 to 100); Multiple gaps | Sequential orders; Single rule; Empty |
| PR-004 | Multiple Rules Same Field | Warning | 3+ rules target same field | Each targets different field; Under threshold |
| PR-005 | Missing Evaluation Order | Info | Null eval order on active rule | All have orders; Inactive with null skipped |

### Discount Schedules (DS-001 to DS-004) — 26 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| DS-001 | Tier Overlap | Critical | Overlapping ranges; Multiple overlaps; Cross-schedule | Non-overlapping; Single tier; Adjacent boundaries |
| DS-002 | Tier Gaps | Warning | Gap between tiers; Multiple gaps | Continuous coverage; Single tier; Unsorted tiers |
| DS-003 | Negative Discounts | Warning | -5% surcharge; Multiple negatives; Cross-schedule | All positive; Zero discount; Empty |
| DS-004 | Orphaned Schedules | Info | Empty tiers; Null tiers; Multiple empty grouped | Has tiers; Empty array |

### Products (PB-001 to PB-004) — 28 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| PB-001 | No Price Book Entry | Critical | Active product without PBE; Multiple orphans | All have entries; Inactive skipped; Empty |
| PB-002 | Orphaned Bundle Options | Warning | Inactive parent; Inactive child | Both active; Empty options |
| PB-003 | Missing Subscription Type | Critical | Recurring + no SubscriptionType; Multiple | One-Time; Has SubscriptionType; Inactive |
| PB-004 | Duplicate Product Codes | Warning | 2 products same code; 3 products same code | Unique codes; Inactive skipped; No code |

### Product Rules (PRD-001 to PRD-004) — 34 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| PRD-001 | Conflicting Selection Rules | Critical | Same order + type; Multiple conflicts | Different orders/types; Inactive; Empty |
| PRD-002 | Duplicate Eval Order | Warning | 2 same order; Multi-group duplicates | Unique; Null orders; Inactive |
| PRD-003 | No Conditions or Actions | Warning | Empty conditions/actions; Both missing | Has both; Inactive skipped |
| PRD-004 | Missing Condition Logic | Warning | Null ConditionsMet; Empty string | = All; = Any; Inactive skipped |

### Approval Rules (AR-001 to AR-004) — 27 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| AR-001 | Rules Without Approver | Critical | No Approver AND no ApproverField; Multiple; Empty string | Approver set; ApproverField set; Both; Inactive; Empty |
| AR-002 | Rules Without Conditions | Warning | Empty conditions; Null conditions; Mixed set | Has conditions; Inactive; Multiple conditions |
| AR-003 | Duplicate Eval Order | Warning | 2 same order; 3 same; 2 groups | Unique; Null; Inactive; Single |
| AR-004 | Missing Condition Logic | Warning | Null ConditionsMet; Empty string | = All; = Any; No conditions; Inactive |

### Summary Variables (SV-001 to SV-005) — 31 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| SV-001 | Orphaned Variables | Warning | Single orphan; 5 orphans; Only orphans in records | Referenced by PR; By PRD; Both; Inactive; Empty |
| SV-002 | Incomplete Configuration | Critical | Missing Function/Field/Object; ALL three; Multiple | Fully configured; Inactive |
| SV-003 | Duplicate Variables | Warning | 2 identical; 3 identical | Unique; Same field diff function; Same function diff scope |
| SV-004 | Filter Misconfiguration | Warning | FilterField only; Field+Value no Op; Value only | No filter; Fully configured |
| SV-005 | Composite Missing Operand | Critical | CombineWith without Op; Op without CombineWith | Not composite; Both set; Inactive |

### Guided Selling (GS-001 to GS-003) — 18 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| GS-001 | Without Inputs | Critical | 0 inputs; Multiple broken; 0 inputs AND 0 outputs | Has inputs; 1 input; Inactive; Empty |
| GS-002 | Without Outputs | Critical | 0 outputs; Mixed set | Has outputs; 1 output; Inactive |
| GS-003 | Inactive Processes | Info | Single inactive; 3 inactive grouped | All active; Empty; 3 active |

### Quote Templates (QT-001 to QT-004) — 23 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| QT-001 | No Default Template | Warning | Single non-default; Multiple non-defaults | Default exists; No templates; One default among many |
| QT-002 | Non-Active Templates | Info | Draft; Inactive; Multiple non-active | All Active; Empty; Null status |
| QT-003 | Empty Templates | Warning | Empty sections; Null sections; Multiple empty | Has sections; Multiple sections; Empty |
| QT-004 | Multiple Defaults | Warning | 2 defaults; 3 defaults | Single default; No defaults; 1 among many |

### Custom Scripts / QCP (QCP-001 to QCP-004) — 28 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| QCP-001 | Empty QCP Script | Critical | Null code; Empty; Whitespace; Multiple empty | Has code; Empty array; Minimal |
| QCP-002 | Missing Transpiled | Warning | Null transpiled; Empty; Whitespace | Code + transpiled; Empty code skipped |
| QCP-003 | Performance Concerns | Warning | 3 loops; 500+ lines; >5 console.log; while loops | Simple; 2 loops; 5 logs; Short; Empty |
| QCP-004 | Multiple QCPs | Info | 2 QCPs; 3 QCPs | Single; No scripts; 1 QCP + non-QCP |

### CPQ Settings (SET-001 to SET-004) — 24 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| SET-001 | Triggers Disabled | Critical | TriggerDisabled = true; Null settings | = false; undefined; null |
| SET-002 | QCP Detected | Info | Has scripts; Multiple | No scripts; Empty |
| SET-003 | Renewal Model Not Set | Warning | Null; Empty string; Undefined | 'Same Products'; 'Assets' |
| SET-004 | Subscription Term Unit Not Set | Warning | Null; Empty string | 'Month'; 'Year' |

### Configuration Attributes (CA-001 to CA-004) — 27 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| CA-001 | Hidden + Required | Critical | Both flags; Multiple; Product name | Required only; Hidden only; Neither; Empty |
| CA-002 | Missing Target Field | Warning | Null target; Empty string; Grouped by product | All have targets; Empty |
| CA-003 | Duplicate Attribute Names | Warning | Duplicate pair; Triple; Separate groups | Unique; Same name diff products; Single; Empty |
| CA-004 | Required Without Default | Info | Required + visible + no default; Grouped | Has default; Not required; Hidden excluded; Empty |

### Subscriptions (SR-001 to SR-002) — 18 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| SR-001 | Zero-Value Subscriptions | Warning | Zero price; Null price; Multiple; revenue_impact | Positive price; Empty; Negative/credit; Small |
| SR-002 | Missing Prorate Multiplier | Warning | Null multiplier; Zero; Multiple | Positive; Fractional; Empty |

### Quote Lines (QL-001 to QL-003) — 25 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| QL-001 | Zero NetPrice | Critical | Zero; Null; Grouped by quote; Product names | Positive NetPrice; Zero Qty; Zero ListPrice; Empty |
| QL-002 | NetTotal Mismatch | Critical | Significant mismatch; Multiple; Product name | Exact match; Small rounding; Null fields; Empty |
| QL-003 | Negative Totals | Warning | Single negative; Multiple grouped; Dollar amounts | Positive; Null; Zero; Empty |

### Twin Fields (TF-001) — 20 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| TF-001 | Conflicting Twin Values | Warning | Both Discount fields; Both Uplift fields; Combined; revenue_impact | Only one field set; Both null/zero; Empty |

### Contracted Prices (CP-001) — 17 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| CP-001 | Expired/Inactive/Zero Prices | Warning | Expired; Inactive product refs; Zero-price; Combined; revenue_impact | Valid non-expired; Active product; Empty |

### Advanced Pricing (AP-001 to AP-004) — 32 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| AP-001 | MDQ Missing Subscription | Critical | All fields missing; Each individually; Multiple | All set; Non-Block; Inactive; Empty |
| AP-002 | % of Total Not In Bundle | Warning | Standalone PoT; Multiple; Mixed | Is bundle option; Non-PoT; Inactive |
| AP-003 | Cost Without Price Book | Warning | No PBE for Cost product; Multiple | Has entry; Non-Cost; Inactive |
| AP-004 | Recurring No Billing Freq | Warning | No frequency; Multiple; Empty string | Has frequency; One-Time; Inactive |

### Performance (PERF-001 to PERF-005) — 32 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| PERF-001 | High Price Rule Count | Warning/Critical | 50 rules = warning; 100+ = critical | 2 rules; 49 (under threshold) |
| PERF-002 | High Product Rule Count | Warning/Critical | 30 rules = warning; 60+ = critical | 1 rule; 29 (under threshold) |
| PERF-003 | Quote Line Volume | Warning/Critical | max > 100; avg > 50; max > 200 | Low counts; No quotes |
| PERF-004 | Summary Variable Overhead | Info/Warning | 20+ = info; 40+ = warning | 1 variable; 19 (under threshold) |
| PERF-005 | CPQ Complexity Score | Info/Warning/Critical | >= 50/100/200 thresholds | Low complexity (< 50) |

### Impact Analysis (IA-001 to IA-004) — 25 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| IA-001 | Dependency Chains | Warning/Critical | Rule writes field, another reads it; 5+ = critical | Independent rules; No conditions |
| IA-002 | Overlapping Scope | Warning/Critical | 4+ rules same field; 6+ = critical | Different fields; Under threshold |
| IA-003 | Discount + PR Overlap | Warning | Schedules + rules target same fields | No schedules; Non-discount fields |
| IA-004 | Orphaned References | Warning | Contracted prices to inactive products | All active; Empty |

### Usage Analytics (UA-001 to UA-003) — 23 tests

| Check ID | Check Name | Severity | Positive Tests | Negative Tests |
|---|---|---|---|---|
| UA-001 | Dead-Weight Products | Info | 5+ unquoted AND >= 20% dead weight | All quoted; Under threshold |
| UA-002 | Untriggered Schedules | Info | 3+ schedules but < 5% utilized | No schedules; High utilization |
| UA-003 | Stale Inactive Rules | Info | 5+ inactive; 3+ at 30%+ ratio | No inactive; Under threshold |

---

## 3. Integration Test Scenarios — 42 tests

### Scenario 1: Healthy CPQ Org (Negative Testing)
| Test | What It Verifies |
|---|---|
| Approval Rules score = 100 | No false positives on clean approval config |
| Summary Variables score = 100 | No false positives on referenced variables |
| Guided Selling score = 100 | No false positives on valid process |
| Quote Templates score = 100 | No false positives on default active template |
| QCP score = 100 | No false positives on proper script |
| Overall score >= 80 | Healthy org gets good grade |
| Zero critical issues | No phantom criticals |
| Complexity = Low | Minimal org not flagged as complex |

### Scenario 2: Problematic CPQ Org (Positive Testing)
| Test | Check ID | Expected Severity |
|---|---|---|
| DETECT: Approval rule without approver | AR-001 | Critical |
| DETECT: Approval rule without conditions | AR-002 | Warning |
| DETECT: Duplicate evaluation order | AR-003 | Warning |
| DETECT: Missing condition logic | AR-004 | Warning |
| DETECT: Orphaned summary variables | SV-001 | Warning |
| DETECT: Incomplete variable config | SV-002 | Critical |
| DETECT: Duplicate summary variables | SV-003 | Warning |
| DETECT: Filter misconfiguration | SV-004 | Warning |
| DETECT: Composite missing operand | SV-005 | Critical |
| DETECT: Guided selling without inputs | GS-001 | Critical |
| DETECT: Guided selling without outputs | GS-002 | Critical |
| DETECT: Inactive guided selling | GS-003 | Info |
| DETECT: No default template | QT-001 | Warning |
| DETECT: Non-active template | QT-002 | Info |
| DETECT: Empty template | QT-003 | Warning |
| DETECT: Empty QCP script | QCP-001 | Critical |
| DETECT: Missing transpiled code | QCP-002 | Warning |
| DETECT: QCP performance concerns | QCP-003 | Warning |
| DETECT: Multiple QCP scripts | QCP-004 | Info |

### Scenario 3: Score Impact Validation
| Test | What It Verifies |
|---|---|
| AR score drops below 100 | Severity deductions work |
| SV score < 70 | Multiple criticals heavily impact score |
| GS score <= 70 | Critical issues -15 each |
| QT score < 100 | Warnings reduce score |
| QCP score <= 80 | Mixed severity impacts |
| Problematic score < Healthy score (by 10+) | Overall weighted scoring works |

### Scenario 4: Mixed Org (Isolation Testing)
| Test | What It Verifies |
|---|---|
| Only AR broken — SV, GS, QT, QCP = 100 | Issues don't bleed across categories |
| Only QCP broken — AR, SV = 100 | Category isolation works |
| Only GS broken — QT, QCP = 100 | Independent scoring per category |

### Scenario 5: Edge Cases & Boundaries
| Test | What It Verifies |
|---|---|
| Empty org (no data) = all 100 | No crashes on empty input |
| 20 critical issues = score clamped to 0 | Score floor at 0 |
| Clean org = all scores <= 100 | Score ceiling at 100 |
| All issues have check_id, category, severity, title | Data integrity |
| All affected records have id, name, type | Record integrity |
| Duration > 0 | Timing works |

---

## 4. Test Execution Summary

```
 Test Files  29 passed (29)
      Tests  603 passed (603)
   Duration  ~2.2s
```

### Test Files Breakdown

| File | Tests | Category |
|---|---|---|
| `product-rules-comprehensive.test.ts` | 34 | Unit: Product Rules |
| `performance-comprehensive.test.ts` | 32 | Unit: Performance |
| `advanced-pricing-comprehensive.test.ts` | 23 | Unit: Advanced Pricing |
| `summary-variables-comprehensive.test.ts` | 31 | Unit: Summary Variables |
| `price-rules-comprehensive.test.ts` | 31 | Unit: Price Rules |
| `products-comprehensive.test.ts` | 28 | Unit: Products |
| `custom-scripts-comprehensive.test.ts` | 28 | Unit: QCP / Custom Scripts |
| `configuration-attributes-comprehensive.test.ts` | 27 | Unit: Configuration Attributes |
| `approval-rules-comprehensive.test.ts` | 27 | Unit: Approval Rules |
| `discount-schedules-comprehensive.test.ts` | 26 | Unit: Discount Schedules |
| `quote-lines-comprehensive.test.ts` | 25 | Unit: Quote Lines |
| `impact-analysis-comprehensive.test.ts` | 25 | Unit: Impact Analysis |
| `cpq-settings-comprehensive.test.ts` | 24 | Unit: CPQ Settings |
| `usage-analytics-comprehensive.test.ts` | 19 | Unit: Usage Analytics |
| `quote-templates-comprehensive.test.ts` | 23 | Unit: Quote Templates |
| `twin-fields-comprehensive.test.ts` | 20 | Unit: Twin Fields |
| `subscriptions-comprehensive.test.ts` | 18 | Unit: Subscriptions |
| `guided-selling-comprehensive.test.ts` | 18 | Unit: Guided Selling |
| `contracted-prices-comprehensive.test.ts` | 17 | Unit: Contracted Prices |
| `integration-scan-scenarios.test.ts` | 42 | Integration: Full Engine |
| `engine.test.ts` | 10 | Integration: Engine (basic) |
| `other-checks.test.ts` | 18 | Unit: Mixed (basic) |
| `summary-variables.test.ts` | 10 | Unit: Summary Variables (basic) |
| `approval-rules.test.ts` | 8 | Unit: Approval Rules (basic) |
| `custom-scripts.test.ts` | 8 | Unit: QCP (basic) |
| `performance.test.ts` | 8 | Unit: Performance (basic) |
| `advanced-pricing.test.ts` | 8 | Unit: Advanced Pricing (basic) |
| `impact-analysis.test.ts` | 8 | Unit: Impact Analysis (basic) |
| `usage-analytics.test.ts` | 7 | Unit: Usage Analytics (basic) |

---

## 5. What's NOT Covered (Future Scope)

| Area | Reason |
|---|---|
| API Route Testing | Requires Supabase/auth mocking — Phase 2 |
| UI Component Testing | React Testing Library setup needed — Phase 2 |
| Salesforce Connection Testing | Requires live SF org or mock — Phase 2 |
| AI/Gemini Response Testing | Non-deterministic API output — Phase 2 |
| End-to-End Browser Testing | Playwright/Cypress setup needed — Phase 2 |
| Load/Stress Testing | Large dataset benchmarking — Phase 2 |

---

## 6. How to Run Tests

```bash
# Run all 603 tests
npx vitest run

# Run with verbose output (see every test name)
npx vitest run --reporter=verbose

# Run specific category
npx vitest run src/__tests__/price-rules-comprehensive.test.ts

# Run only integration tests
npx vitest run src/__tests__/integration-scan-scenarios.test.ts

# Run all comprehensive tests
npx vitest run src/__tests__/*-comprehensive.test.ts

# Watch mode (re-runs on file change)
npx vitest
```
