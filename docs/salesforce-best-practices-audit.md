# Salesforce Best Practices Audit

> Mapping of ConfigCheck's existing checks against three Salesforce reference documents:
> - Salesforce CPQ (Spring '26) — 466 pages
> - Salesforce Billing (Spring '26) — 376 pages
> - Revenue Cloud Developer Guide (Spring '26) — RLM/ARM, 1100+ pages

Last updated: 2026-04-30

## Executive Summary

| Product Area | Existing Checks | Coverage Estimate | Notable Remaining Gaps |
|---|---|---|---|
| **Salesforce CPQ (SBQQ)** | 95 | ~78% of documented best practices | Large Quote Threshold, Apply Immediately Context, Bundle pricing scheme consistency |
| **Salesforce Billing (blng)** | 30+ | ~70% of documented best practices | Cancel-and-rebill workflow, Billing day-of-month consistency, Consumption schedule + amendment rules |
| **Revenue Cloud / ARM (RLM)** | **51** ✨ | **~60% of documented best practices** | Asset attributes, Constraint Modeling Language (CML), Sharing & search index, Decision-table conditions |

ARM coverage went from **0 → 51 checks across 16 categories** (delivered 2026-04-30). ConfigCheck now covers all three Salesforce revenue product lines: CPQ, Billing, and Revenue Cloud (ARM/RLM).

**ARM check inventory (51 checks across 16 categories):**

| Category | Count | Check IDs |
|---|---|---|
| Product Catalog | 3 | ARM-001, ARM-010, ARM-018 |
| Selling Models | 4 | ARM-002, ARM-011, ARM-012, ARM-019 |
| Bundles | 4 | ARM-005, ARM-013, ARM-014, ARM-015 |
| Price Adjustments | 3 | ARM-003, ARM-016, ARM-017 |
| Attribute Pricing | 2 | ARM-004, ARM-020 |
| Pricing Procedures | 2 | ARM-006, ARM-027 |
| Price Books | 2 | ARM-007, ARM-028 |
| Decision Tables | 2 | ARM-008, ARM-029 |
| Context Service | 2 | ARM-009, ARM-030 |
| Rate Cards | 3 | ARM-021, ARM-022, ARM-023 |
| Attributes | 3 | ARM-024, ARM-025, ARM-026 |
| Assets | 5 | ARM-031, ARM-032, ARM-033, ARM-034, ARM-035 |
| Contracts | 4 | ARM-036, ARM-037, ARM-038, ARM-039 |
| Usage Management | 5 | ARM-040, ARM-041, ARM-042, ARM-043, ARM-044 |
| Orchestration (DRO) | 4 | ARM-045, ARM-046, ARM-047, ARM-048 |
| Cost Books | 3 | ARM-049, ARM-050, ARM-051 |

**Recently shipped CPQ gap closures** (from this audit):
- ✅ **BN-006** Bundle Mixes Evergreen and Renewable Subscriptions (was CPQ-NEW-3)

**Total checks across the platform: 176** (95 CPQ + 30 Billing + 51 ARM).

---

## Part 1 — Salesforce CPQ Gaps & Proposed New Checks

### High value (recommend adding next)

#### CPQ-NEW-1 — Large Quote Threshold not configured

**Source:** CPQ doc lines 3084-3138.
> "When a quote contains the threshold's defined number of records, Salesforce CPQ ignores the rule. We recommend defining a threshold to improve quote line editor performance and avoid governor limits."

**Proposed check:** `SET-005 Large Quote Threshold Not Configured`
- Severity: **warning**
- Trigger: `SBQQ__LargeQuoteThreshold__c` is NULL or 0 on `SBQQ__Quote__c` settings
- Impact: Performance degradation when quotes grow large, governor limit risk
- Recommendation: Set threshold based on typical quote size in the org (start at 200-300 lines)

#### CPQ-NEW-2 — Apply Immediately Context too aggressive

**Source:** CPQ doc line 3936.
> "We recommend enabling this field sparingly to avoid a slow user experience."

**Proposed check:** `SET-006 Apply Immediately Context Misuse`
- Severity: **info**
- Trigger: Bundles with `SBQQ__ApplyImmediatelyContext__c` set to `Always`
- Impact: Configurator slowdown with every option click
- Recommendation: Use `Configurator Page` or empty unless required

#### CPQ-NEW-3 — Mixed Evergreen + Regular Subscriptions in Bundle

**Source:** CPQ doc line 3753.
> "Bundles can't contain both products with a subscription type of Evergreen and products with a subscription type of [renewable]."

**Proposed check:** `BN-006 Bundle Mixes Evergreen and Renewable Subscriptions`
- Severity: **critical**
- Trigger: Any bundle whose options contain both `SBQQ__SubscriptionType__c = 'Evergreen'` and `SBQQ__SubscriptionType__c = 'Renewable'`
- Impact: CPQ runtime error, broken renewals
- Recommendation: Move evergreen products to a separate bundle

#### CPQ-NEW-4 — Bundle Pricing Scheme Inconsistency

**Source:** CPQ doc — bundle nesting / option pricing best practices.

**Proposed check:** `BN-007 Inconsistent Pricing Schemes in Nested Bundle`
- Severity: **warning**
- Trigger: Parent bundle and child bundle option have different `SBQQ__OptionsPricingScheme__c` (e.g. parent uses Per Bundle, child uses Per Item)
- Impact: Sales reps see unpredictable totals
- Recommendation: Align pricing scheme across nested levels

#### CPQ-NEW-5 — Quote Calculator Plugin without Required Async Methods

**Source:** CPQ doc on QCP best practices.

**Proposed check:** `QCP-005 QCP Missing Required Async Hooks`
- Severity: **warning**
- Trigger: QCP code present but missing `onInit`, `onBeforeCalculate`, or `onAfterCalculate` (string scan)
- Impact: Calculator may behave unpredictably; some events skipped
- Recommendation: Implement at least the standard async lifecycle hooks

### Medium value

#### CPQ-NEW-6 — Pricing Guidance Configured But No Targets

**Source:** CPQ doc lines 11293-12028 — pricing guidance.

**Proposed check:** `AP-006 Pricing Guidance Without Targets`
- Severity: **info**
- Trigger: Pricing guidance records exist but have no `Target Discount` or `Target Price` set
- Impact: Sales reps see no recommendations even though guidance is enabled

#### CPQ-NEW-7 — Distributor Discount Field Not Exposed in Editor

**Source:** CPQ doc line 12618.
> "If you want to allow sales reps to edit distributor discounts in the quote line editor, add Distributor Discount to the quote line field set."

**Proposed check:** Detect that `Line Editor` field set on `SBQQ__QuoteLine__c` is missing `SBQQ__DistributorDiscount__c` while distributor discounts are in use anywhere.
- Severity: **info**

#### CPQ-NEW-8 — Quote Template With No Sections

**Source:** CPQ doc line 16010.
> "Salesforce CPQ doesn't support quote templates without template sections."

**Proposed check:** `QT-006 Quote Template Without Sections`
- Severity: **critical**
- Trigger: Active `SBQQ__QuoteTemplate__c` with zero related `SBQQ__TemplateSection__c`
- Impact: Document generation will fail

#### CPQ-NEW-9 — Validation Rules Outside Same Option Level

**Source:** CPQ doc line 10934.
> "Validation rules run immediately only for options on the same level as the option or attribute that prompted an Apply Immediately."

**Proposed check:** Detect product rules of type Validation that target options at a different bundle nesting level than the trigger source.
- Severity: **warning**

#### CPQ-NEW-10 — Selection Rule Trying to Add Inactive Product

**Source:** Already partially covered by `LQ-002` and `LQ-005`. Verify edge case where rule action references a now-inactive product.

### Low value (defer)

- Bundle code patterns (line 4552) — niche
- Pricing guidance "Don't use 0%" (line 11915) — data entry hygiene, hard to detect
- Headers/footers as 1 entity (line 16964) — quote template layout, low ROI

---

## Part 2 — Salesforce Billing Gaps & Proposed New Checks

### High value

#### BL-NEW-1 — Misaligned CPQ vs Billing Proration Periods

**Source:** Billing doc line 4364.
> "If you want to avoid pending balances when you cancel an order product, align CPQ and Billing to use the same proration periods."

**Proposed check:** `BR-005 CPQ/Billing Proration Period Mismatch`
- Severity: **warning**
- Trigger: `SBQQ__SubscriptionProrateMode__c` (CPQ) and `blng__ProrationMode__c` on billing rules don't match
- Impact: Pending balances on cancellations

#### BL-NEW-2 — Manual Bill Now Detected (Recommend Scheduler)

**Source:** Billing doc line 1160.
> "We recommend automating invoice generation with an invoice scheduler. Creating invoices manually using Bill Now is recommended only for testing or one-off use cases."

**Proposed check:** `INV-006 No Active Invoice Scheduler But Recent Manual Invoices`
- Severity: **info**
- Trigger: Recent invoices exist with no associated invoice scheduler run
- Recommendation: Set up an invoice scheduler

#### BL-NEW-3 — Inconsistent Billing Day of Month

**Source:** Billing doc lines 4521, 4571.
> "To avoid partial period usage summaries, set your billing day of month to the same day value..."

**Proposed check:** `PBC-005 Inconsistent Billing Day of Month Across Products`
- Severity: **warning**
- Trigger: Products under same legal entity have different `blng__BillingDayOfMonth__c` values
- Impact: Partial billing periods, prorated complexity

#### BL-NEW-4 — Multiple Tax Treatments Per Legal Entity

**Source:** Billing doc line 2939.
> "You're limited to one tax treatment per legal entity."

**Proposed check:** `LE-005 Multiple Tax Treatments on Same Legal Entity`
- Severity: **critical**
- Trigger: Legal entity has more than one active tax treatment
- Impact: Hard error from Salesforce Billing

### Medium value

#### BL-NEW-5 — CPQ Field Modified On Activated Order

**Source:** Billing doc line 5453.
> "Don't change CPQ fields and standard fields on an activated standalone order or order product."

**Proposed check:** Detect order products where CPQ-managed fields have a `LastModifiedDate` after `ActivatedDate`. Hard to do statically; might need feature flag.
- Severity: **warning**

#### BL-NEW-6 — Billing Frequency Outside Supported Set

**Source:** Billing doc line 8605.
> "Four recurring billing frequencies (monthly, quarterly, annual, and semiannual) are supported."

**Proposed check:** `PBC-006 Unsupported Billing Frequency`
- Severity: **critical**
- Trigger: Product or order product has `blng__BillingFrequency__c` set to a value outside the supported four
- Impact: Billing engine errors

#### BL-NEW-7 — Unit of Measure Not in Global Picklist

**Source:** Billing doc line 8890.
> "Values added to the consumption schedule field Unit of Measure must also be added to the Unit of Measure Global Picklist."

**Proposed check:** Compare unique UoM values on consumption schedules to the global picklist values. Requires Tooling API or metadata fetch.

---

## Part 3 — ARM (Revenue Cloud / RLM) — Net New Coverage

ConfigCheck currently has **zero** ARM checks. The Revenue Cloud Developer Guide (1,100+ pages) covers entirely different objects than Salesforce CPQ:

| ARM Concept | RLM Object | Equivalent CPQ Object |
|---|---|---|
| Product Catalog | `ProductCatalog`, `ProductCategory` | `Product2` + `SBQQ__ProductFeature__c` |
| Selling Models | `ProductSellingModel`, `ProductSellingModelOption` | (no equivalent) |
| Pricing | `PriceAdjustmentSchedule`, `PriceAdjustmentTier`, `AttributeBasedAdjRule` | `SBQQ__DiscountSchedule__c`, `SBQQ__PriceRule__c` |
| Configurator | `ProductRelatedComponent`, `BundleBasedAdjustment` | `SBQQ__ProductOption__c`, `SBQQ__ConfigurationAttribute__c` |
| Transaction | `Quote`, `Order` (standard objects in RLM) | `SBQQ__Quote__c` |
| Contracts | `Contract` (standard) with revenue extensions | `Contract` + CPQ amendments |

### Proposed first wave of ARM checks (10 checks to ship "ARM v1")

| ID | Name | Severity | Source |
|---|---|---|---|
| `ARM-001` | Active product without ProductSellingModelOption | critical | RLM dev guide ProductSellingModelOption section |
| `ARM-002` | Selling model with no associated billing frequency | critical | ProductSellingModel.SellingFrequencyId |
| `ARM-003` | Price adjustment schedules with overlapping tiers | warning | PriceAdjustmentTier patterns |
| `ARM-004` | AttributeBasedAdjRule without effective dates | warning | RLM pricing section |
| `ARM-005` | Bundle without ProductRelatedComponent (empty bundle, ARM equivalent of BN-001) | critical | ProductRelatedComponent |
| `ARM-006` | Pricing procedure with no resolution policy | warning | PricingProcedureResolution |
| `ARM-007` | Multiple active price books for same currency without segmentation | info | PriceBook2 best practices |
| `ARM-008` | Decision tables with no rows / empty expression sets | critical | Business Rules Engine section |
| `ARM-009` | Context Definitions referenced but inactive | warning | Context Service section |
| `ARM-010` | Inactive ProductCategory still referenced by active products | info | ProductCategory hierarchy |

### Recommended approach for ARM

1. Add `arm` queries module (`src/lib/salesforce/queries-arm.ts`) — mirrors `queries.ts` but for ARM objects
2. Add `armChecks: HealthCheck[]` analogous to existing `quoteLineChecks` etc.
3. Wire into scan engine when `productType === 'arm'`
4. Categories likely needed: `product_catalog`, `selling_models`, `price_adjustments`, `attribute_pricing`, `bundles_arm`, `pricing_procedures`, `decision_tables`, `context_service`

---

## Part 4 — Priority Recommendation

If we ship in order:

1. **Week 1:** CPQ-NEW-3 (Evergreen+Renewable bundle), BN-006, CPQ-NEW-1 (Large Quote Threshold), CPQ-NEW-8 (Quote Template without sections) — 4 high-value CPQ gaps, all easy to detect
2. **Week 2:** BL-NEW-4 (Tax treatments per LE), BL-NEW-6 (Unsupported billing frequency), BL-NEW-1 (proration mismatch) — billing high-value gaps
3. **Week 3-4:** ARM v1 (10 checks above) — enables the third product type

Total proposed additions: ~9 CPQ + 7 Billing + 10 ARM = **26 new checks** raising the total from 124 to 150.
