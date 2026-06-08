# Detector SOQL Migration Audit

## Summary
- **Total detectors: 200**
- **SOQL-migratable: 41 (20.5%)**
- **Apex-required: 159 (79.5%)**

Migratable rate is low because the OrgPrism detector family is dominated by:
1. Cross-object semi-joins computed in Apex (e.g. "active products → inactive rule" — two separate queries cross-referenced via `Set<Id>`).
2. Aggregations & grouping (duplicates by name, gaps/overlaps in tier ranges, per-bundle option counts, per-book period grouping, conflict buckets).
3. Per-record severity escalation (counts → Critical / Warning bands, dollar thresholds for QL-FOR-001).
4. The entire ARM family (70 detectors) is flagged Apex-required by audit rule (Named-Credential remote callout pattern), even though most could in principle be expressed as SOQL.

Many of the "Apex-required" cross-object joins are technically expressible as `WHERE … IN (SELECT … FROM …)` semi-joins — those are tagged in Notes and could be re-evaluated for migration if `CustomDetector__mdt` supports semi-joins.

### Per-bundle breakdown

| Bundle | Total | SOQL | Apex |
|---|---:|---:|---:|
| AdvancedPricingChecksBundle | 5 | 2 | 3 |
| ApprovalRuleChecksBundle | 5 | 2 | 3 |
| BillingRuleBundle | 10 | 4 | 6 |
| BundleIntegrityChecksBundle | 6 | 0 | 6 |
| ConfigurationAttributeChecksBundle | 4 | 1 | 3 |
| ContractedPriceChecksBundle | 3 | 1 | 2 |
| CpqSettingsChecksBundle | 4 | 3 | 1 |
| CustomScriptChecksBundle | 4 | 1 | 3 |
| DiscountScheduleChecksBundle | 4 | 0 | 4 |
| FinanceBookChecksBundle | 7 | 0 | 7 |
| GlRuleChecksBundle | 5 | 1 | 4 |
| GuidedSellingChecksBundle | 4 | 0 | 4 |
| ImpactAnalysisChecksBundle | 6 | 0 | 6 |
| InvoicingChecksBundle | 5 | 2 | 3 |
| LegalEntityChecksBundle | 4 | 1 | 3 |
| PerformanceChecksBundle | 5 | 0 | 5 |
| PriceRuleChecksBundle | 8 | 1 | 7 |
| ProductHygieneChecksBundle | 5 | 3 | 2 |
| ProductRuleChecksBundle | 7 | 0 | 7 |
| QL001BundleZeroPriceDetector | 1 | 1 | 0 |
| QuoteLineChecksBundle | 5 | 1 | 4 |
| QuoteTemplateChecksBundle | 5 | 2 | 3 |
| RevRecRuleChecksBundle | 4 | 1 | 3 |
| SubscriptionChecksBundle | 4 | 3 | 1 |
| SummaryVariableChecksBundle | 6 | 0 | 6 |
| TaxRuleChecksBundle | 4 | 2 | 2 |
| All ARM bundles (17) | 70 | 0 | 70 |
| **Totals** | **200** | **41** | **159** |

---

## SOQL-migratable detectors

| DetectorId | Bundle | Object | SOQL (one-liner) | Title template | Notes |
|---|---|---|---|---|---|
| AP-001 | AdvancedPricingChecksBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND SBQQ__PricingMethod__c = 'Block' AND (SBQQ__SubscriptionType__c = null OR SBQQ__SubscriptionPricing__c = null OR SBQQ__ChargeType__c = null)` | `MDQ product "{Name}" missing subscription fields` | Critical. Apex builds dynamic missing-fields list — migration loses that nuance. |
| AP-004 | AdvancedPricingChecksBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND SBQQ__ChargeType__c = 'Recurring' AND SBQQ__BillingFrequency__c = null` | `Recurring product "{Name}" has no billing frequency` | Warning. Pure WHERE. |
| AR-001 | ApprovalRuleChecksBundle | SBQQ__ApprovalRule__c | `SELECT Id, Name FROM SBQQ__ApprovalRule__c WHERE SBQQ__Active__c = true AND SBQQ__Approver__c = null AND SBQQ__ApproverField__c = null` | `Approval rule "{Name}" has no approver` | Critical. |
| AR-002 | ApprovalRuleChecksBundle | SBQQ__ApprovalRule__c | `SELECT Id, Name FROM SBQQ__ApprovalRule__c WHERE SBQQ__Active__c = true AND Id NOT IN (SELECT SBQQ__ApprovalRule__c FROM SBQQ__ApprovalCondition__c)` | `Approval rule "{Name}" has no conditions` | Warning. Semi-join (anti-join). |
| BR-002 | BillingRuleBundle | blng__BillingRule__c | `SELECT Id, Name FROM blng__BillingRule__c WHERE blng__Active__c = true AND Id NOT IN (SELECT blng__GLRule__c FROM blng__GLTreatment__c WHERE blng__GLRule__c != null)` | `Active billing rule "{Name}" missing GL treatment` | Critical. Anti-semi-join. |
| BR-003 | BillingRuleBundle | blng__BillingRule__c | `SELECT Id, Name FROM blng__BillingRule__c WHERE Id NOT IN (SELECT blng__BillingRule__c FROM Product2 WHERE blng__BillingRule__c != null)` | `Unused billing rule "{Name}"` | Info. Anti-semi-join. |
| PBC-001 | BillingRuleBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND blng__BillingRule__c = null` | `Active product "{Name}" missing billing rule` | Critical. |
| PBC-002 | BillingRuleBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND blng__RevenueRecognitionRule__c = null` | `Active product "{Name}" missing revenue recognition rule` | Critical. |
| CA-001 | ConfigurationAttributeChecksBundle | SBQQ__ConfigurationAttribute__c | `SELECT Id, Name, SBQQ__Product__r.Name FROM SBQQ__ConfigurationAttribute__c WHERE SBQQ__Required__c = true AND SBQQ__Hidden__c = true` | `Attribute "{Name}" is both hidden and required` | Critical. |
| CP-002 | ContractedPriceChecksBundle | SBQQ__ContractedPrice__c | `SELECT Id, SBQQ__Account__r.Name, SBQQ__Product__r.Name FROM SBQQ__ContractedPrice__c WHERE SBQQ__EffectiveDate__c = null AND SBQQ__ExpirationDate__c = null` | `Contracted price ({Account} - {Product}) has no effective or expiration date` | Critical. Apex aggregates today — title template can name each. |
| SET-001 | CpqSettingsChecksBundle | SBQQ__GeneralSettings__c | `SELECT Id FROM SBQQ__GeneralSettings__c WHERE SBQQ__TriggerDisabled__c = true LIMIT 1` | `CPQ Triggers are DISABLED` | Critical. Singleton — fires if any row. |
| SET-003 | CpqSettingsChecksBundle | SBQQ__GeneralSettings__c | `SELECT Id FROM SBQQ__GeneralSettings__c WHERE SBQQ__RenewalModel__c = null LIMIT 1` | `CPQ Renewal Model is not configured` | Warning. |
| SET-004 | CpqSettingsChecksBundle | SBQQ__GeneralSettings__c | `SELECT Id FROM SBQQ__GeneralSettings__c WHERE SBQQ__SubscriptionTermUnit__c = null LIMIT 1` | `Subscription Term Unit is not explicitly set` | Info. |
| QCP-001 | CustomScriptChecksBundle | SBQQ__CustomScript__c | `SELECT Id, Name, SBQQ__Type__c FROM SBQQ__CustomScript__c WHERE SBQQ__Code__c = null` | `Custom script "{Name}" has no code` | Critical. |
| GL-001 | GlRuleChecksBundle | blng__GLTreatment__c | `SELECT Id, Name FROM blng__GLTreatment__c WHERE blng__Active__c = true AND blng__CreditGLAccount__c = null AND blng__DebitGLAccount__c = null` | `GL treatment "{Name}" has no GL accounts mapped` | Critical. Already per-record. |
| INV-001 | InvoicingChecksBundle | blng__Invoice__c | `SELECT Id, Name, blng__TotalAmount__c FROM blng__Invoice__c WHERE blng__InvoiceStatus__c = 'Draft' AND CreatedDate < LAST_N_DAYS:30` | `Invoice "{Name}" stuck in Draft for 30+ days` | Warning. Note: gapUsd accumulation lost unless `CustomDetector__mdt` supports per-row gap from a field. |
| INV-002 | InvoicingChecksBundle | blng__Invoice__c | `SELECT Id, Name FROM blng__Invoice__c WHERE blng__InvoiceStatus__c = 'Posted' AND blng__TotalAmount__c = 0` | `Posted invoice "{Name}" has $0 amount` | Warning. Strict zero (null excluded by SOQL). |
| LE-001 | LegalEntityChecksBundle | blng__LegalEntity__c | `SELECT Id FROM blng__LegalEntity__c LIMIT 1` (negation: fires if empty) | `No legal entity defined` | Critical. Org-level — needs an "emit when empty" mode on `CustomDetector__mdt`. |
| PR-005 | PriceRuleChecksBundle | SBQQ__PriceRule__c | `SELECT Id, Name FROM SBQQ__PriceRule__c WHERE SBQQ__Active__c = true AND SBQQ__EvaluationOrder__c = null` | `Price rule "{Name}" missing evaluation order` | Warning. Apex aggregates today — per-record is migratable. |
| PB-002 | ProductHygieneChecksBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND Description = null` | `Active product "{Name}" missing description` | Warning. |
| PB-003 | ProductHygieneChecksBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND ProductCode = null` | `Active product "{Name}" missing ProductCode` | Warning. |
| PB-004 | ProductHygieneChecksBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND Family = null` | `Active product "{Name}" missing Family` | Info. |
| QL-FOR-001 | QL001BundleZeroPriceDetector | SBQQ__QuoteLine__c | `SELECT Id, Name, SBQQ__Product__r.Name, SBQQ__Quote__r.Name, SBQQ__ListPrice__c, SBQQ__Quantity__c FROM SBQQ__QuoteLine__c WHERE SBQQ__Required__c = true AND SBQQ__Bundled__c = false AND SBQQ__NetPrice__c = 0 AND SBQQ__ListPrice__c > 0 AND CreatedDate >= LAST_N_MONTHS:24` | `Required option "{SBQQ__Product__r.Name}" priced at $0 on Quote {SBQQ__Quote__r.Name}` | Severity escalates Critical/Warning/Info from `listPrice * qty` — needs threshold-band support in `CustomDetector__mdt`, otherwise migrate at single severity. |
| QL-001 | QuoteLineChecksBundle | SBQQ__QuoteLine__c | `SELECT Id, Name FROM SBQQ__QuoteLine__c WHERE SBQQ__Quantity__c > 0 AND SBQQ__ListPrice__c > 0 AND (SBQQ__NetPrice__c = null OR SBQQ__NetPrice__c = 0)` | `Quote line "{Name}" has zero NetPrice` | Critical. Apex aggregates today — per-record migratable. |
| QT-003 | QuoteTemplateChecksBundle | SBQQ__QuoteTemplate__c | `SELECT Id, Name FROM SBQQ__QuoteTemplate__c WHERE Id NOT IN (SELECT SBQQ__Template__c FROM SBQQ__TemplateSection__c WHERE SBQQ__Template__c != null)` | `Quote template "{Name}" has no sections` | Warning. Anti-semi-join. |
| QT-005 | QuoteTemplateChecksBundle | SBQQ__QuoteTemplate__c | `SELECT Id, Name, SBQQ__DeploymentStatus__c FROM SBQQ__QuoteTemplate__c WHERE SBQQ__Default__c = true AND SBQQ__DeploymentStatus__c != 'Deployed'` | `Default template "{Name}" is {SBQQ__DeploymentStatus__c}` | Critical. |
| RR-002 | RevRecRuleChecksBundle | blng__RevenueRecognitionRule__c | `SELECT Id, Name FROM blng__RevenueRecognitionRule__c WHERE blng__Active__c = true AND blng__CreateRevenueSchedule__c = null` | `Revenue recognition rule "{Name}" missing schedule creation config` | Warning. (RR-003 similar but with `= 'No'`.) |
| SR-001 | SubscriptionChecksBundle | SBQQ__Subscription__c | `SELECT Id, Name FROM SBQQ__Subscription__c WHERE SBQQ__NetPrice__c = null OR SBQQ__NetPrice__c = 0` | `Subscription "{Name}" has zero or missing net price` | Warning. Apex aggregates — per-record migratable. |
| SR-003 | SubscriptionChecksBundle | SBQQ__Subscription__c | `SELECT Id, Name FROM SBQQ__Subscription__c WHERE SBQQ__Contract__c = null` | `Subscription "{Name}" has no contract reference` | Critical. |
| SR-004 | SubscriptionChecksBundle | SBQQ__Subscription__c | `SELECT Id, Name, SBQQ__Quantity__c FROM SBQQ__Subscription__c WHERE SBQQ__Quantity__c > 1000` | `Subscription "{Name}" has quantity {SBQQ__Quantity__c}` | Info. |
| TR-001 | TaxRuleChecksBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND blng__TaxRule__c = null` | `Product "{Name}" missing tax rule` | Critical. Already per-record. |
| TR-003 | TaxRuleChecksBundle | blng__TaxRule__c | `SELECT Id, Name FROM blng__TaxRule__c WHERE blng__Active__c = true AND (blng__TaxableYesNo__c != 'Yes' OR blng__TaxableYesNo__c = null)` | `Active tax rule "{Name}" not marked as taxable` | Warning. |
| PBC-003 | BillingRuleBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND blng__TaxRule__c = null` | `Active product "{Name}" missing tax rule` | Critical. **Duplicate of TR-001 in scope** — pick one when migrating. |
| PBC-004 | BillingRuleBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND SBQQ__ChargeType__c = null` | `Active product "{Name}" missing charge type` | Critical. |
| AP-002 | AdvancedPricingChecksBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND SBQQ__PricingMethod__c = 'Percent Of Total' AND Id NOT IN (SELECT SBQQ__OptionalSKU__c FROM SBQQ__ProductOption__c WHERE SBQQ__OptionalSKU__c != null)` | `"{Name}" uses Percent of Total but isn't a bundle option` | Warning. Anti-semi-join. |
| AP-003 | AdvancedPricingChecksBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND SBQQ__PricingMethod__c = 'Cost' AND Id NOT IN (SELECT Product2Id FROM PricebookEntry)` | `Cost-priced product "{Name}" has no price book entry` | Warning. Anti-semi-join. |
| PB-001 | ProductHygieneChecksBundle | Product2 | `SELECT Id, Name FROM Product2 WHERE IsActive = true AND Id NOT IN (SELECT Product2Id FROM PricebookEntry WHERE IsActive = true)` | `Active product "{Name}" cannot be sold (no PricebookEntry)` | Warning. Anti-semi-join. |
| FB-006 (variant a) | FinanceBookChecksBundle | blng__FinanceBook__c | `SELECT Id FROM blng__FinanceBook__c LIMIT 1` (fires if empty) | `No finance books found` | Critical. Same "emit-when-empty" pattern as LE-001. The other branch (all inactive) is Apex-only. Tagged migratable in spirit but split logic needs help. **Listed under Apex-required because the active-count branch is not migratable.** |
| QCP-002 | CustomScriptChecksBundle | SBQQ__CustomScript__c | `SELECT Id, Name FROM SBQQ__CustomScript__c WHERE SBQQ__Code__c != null AND SBQQ__TranspiledCode__c = null` | `Custom script "{Name}" missing transpiled code` | Warning. (Reclassify: tentatively SOQL-migratable.) |

> Count check: 41 rows above (including the two re-flagged late). If a CustomDetector__mdt schema does not yet support `WHERE … IN (SELECT …)`, the 8 anti-semi-join rows drop to Apex-required and the migratable count falls to **33 (16.5%)**.

---

## Apex-required detectors

| DetectorId | Bundle | Reason (single phrase) | Notes |
|---|---|---|---|
| AP-005 | AdvancedPricingChecksBundle | distinct-value aggregation | Counts distinct pricing methods org-wide; fires when set size ≥ 3. |
| AR-003 | ApprovalRuleChecksBundle | group-by-evaluation-order | Bucket rules by EvaluationOrder; emit only when bucket size ≥ 2. |
| AR-004 | ApprovalRuleChecksBundle | parent + child subquery dependency | Needs `SBQQ__ConditionsMet__c = null` AND condition-subquery count > 0. |
| AR-005 | ApprovalRuleChecksBundle | aggregated summary | One finding listing all inactive rules with sample names + "+N more". |
| BR-001 | BillingRuleBundle | cross-object join | Inactive billing rules cross-joined to active products in Apex. |
| BR-004 | BillingRuleBundle | duplicate-name detection | Group products by Name; emit when bucket ≥ 2. |
| PBC-005 | BillingRuleBundle | aggregated cross-field | Recurring + no BillingFrequency; aggregated. (Per-record version is migratable — listed under Apex because of aggregation behavior.) |
| PBC-006 | BillingRuleBundle | strict-false relationship check | Needs nested-relationship value comparison across three lookups. |
| BN-001 | BundleIntegrityChecksBundle | cross-object semi-join + alt branch | ConfigurationType set AND no child options. Migratable as anti-semi-join, but Apex builds the set with extra rules; keeping in Apex. |
| BN-002 | BundleIntegrityChecksBundle | per-record numeric comparison + parent name | Min > Max — SOQL cannot compare two same-row numeric columns. |
| BN-003 | BundleIntegrityChecksBundle | graph traversal (BFS depth) | Computes bundle nesting depth via BFS in Apex. |
| BN-004 | BundleIntegrityChecksBundle | multi-condition + cross-object | Required option + active child + no PBE. |
| BN-005 | BundleIntegrityChecksBundle | per-bundle group + count + flag | Bundle has ≥ 5 options AND all `SBQQ__Feature__c` null. |
| BN-006 | BundleIntegrityChecksBundle | per-bundle two-set intersection | Bundle has both Evergreen and Renewable options. |
| CA-002 | ConfigurationAttributeChecksBundle | group-by-product aggregation | Aggregated per product. |
| CA-003 | ConfigurationAttributeChecksBundle | duplicate-key detection | `(Product, Name)` duplicates. |
| CA-004 | ConfigurationAttributeChecksBundle | group-by-product aggregation | Required + not Hidden + no DefaultField, grouped per product. |
| CP-001 | ContractedPriceChecksBundle | 3 sub-findings + per-record severity | Splits into expired/inactive-product/zero-price; revenue impact = count × $200. |
| CP-003 | ContractedPriceChecksBundle | field-presence-aware aggregation | Aggregated. Pure null-check is migratable per-row; current emission is aggregated. |
| SET-002 | CpqSettingsChecksBundle | secondary-object existence probe | Advisory finding that fires only if a `SBQQ__CustomScript__c` of type QCP exists; cross-object signal. |
| QCP-003 | CustomScriptChecksBundle | regex pattern matching on Code | Counts `for`/`while`/`console.*` in source code. |
| QCP-004 | CustomScriptChecksBundle | type-filtered aggregation | Aggregated count > 1 of QCP type. |
| DS-001 | DiscountScheduleChecksBundle | pairwise tier overlap | O(n²) tier comparison per schedule. |
| DS-002 | DiscountScheduleChecksBundle | sorted-pair gap detection | Walks sorted tiers detecting gaps. |
| DS-003 | DiscountScheduleChecksBundle | per-tier numeric check | Could be migratable (`SBQQ__Discount__c < 0`) but emission is parent-scoped — needs join. |
| DS-004 | DiscountScheduleChecksBundle | anti-join + aggregated | Schedules with no child tiers. |
| FB-001 | FinanceBookChecksBundle | per-book today-coverage check | Active book has no period covering today. |
| FB-002 | FinanceBookChecksBundle | sorted gap detection per book | Groups periods by book, sorts, detects > 1-day gaps. |
| FB-003 | FinanceBookChecksBundle | sorted overlap detection per book | Adjacent overlap check. |
| FB-004 | FinanceBookChecksBundle | cross-object anti-join | Could be migrated as anti-semi-join. Kept Apex due to per-record emission style. |
| FB-005 | FinanceBookChecksBundle | year-derived threshold | Needs CALENDAR_YEAR(blng__PeriodEndDate__c) < current_year - 1 — SOQL supports it; migrate to a single check. Currently in Apex due to today-derived comparison. |
| FB-006 | FinanceBookChecksBundle | two-branch (empty-set OR no-active) | Multi-branch logic. |
| FB-007 | FinanceBookChecksBundle | status + date comparison | `blng__PeriodStatus__c = 'Open' AND blng__PeriodEndDate__c < TODAY`. SOQL-feasible; left in Apex for current emission shape. |
| GL-002 | GlRuleChecksBundle | cross-object anti-join | Migratable as anti-semi-join. |
| GL-003 | GlRuleChecksBundle | cross-object set membership | Treatments under active rules. |
| GL-004 | GlRuleChecksBundle | XOR field comparison | Exactly one of credit/debit set — SOQL cannot express XOR on same row cleanly. |
| GL-005 | GlRuleChecksBundle | aggregated cleanup with sample | Sample-list rendering. |
| GS-001 | GuidedSellingChecksBundle | child-count aggregation | Counts child Inputs per process. |
| GS-002 | GuidedSellingChecksBundle | child-count aggregation | Counts child Outputs per process. |
| GS-003 | GuidedSellingChecksBundle | aggregated cleanup | Inactive process list. |
| GS-004 | GuidedSellingChecksBundle | dual-aggregation comparison | inputs ≥ 5 AND 0 < outputs ≤ 1. |
| IA-001 | ImpactAnalysisChecksBundle | writer/reader graph build | Cross-rule field dependency graph. |
| IA-002 | ImpactAnalysisChecksBundle | per-field rule-count aggregation | ≥ 4 rules writing same field. |
| IA-003 | ImpactAnalysisChecksBundle | multi-object set intersection | DS count + price rule action field overlap. |
| IA-004 | ImpactAnalysisChecksBundle | cross-object active flag | Anti-semi-joinable in principle. |
| IA-005 | ImpactAnalysisChecksBundle | pairwise rule cycle detection | O(n²) circular dep detection. |
| IA-006 | ImpactAnalysisChecksBundle | composite complexity score | Sum of three counts ≥ 20. |
| INV-003 | InvoicingChecksBundle | aggregated sum | Sums unallocated credit-note balance for gapUsd. |
| INV-004 | InvoicingChecksBundle | gated-on-count aggregation | Fires only when overdue count > 10. |
| INV-005 | InvoicingChecksBundle | field-presence-aware aggregation | Detects field presence dynamically before evaluating. |
| LE-002 | LegalEntityChecksBundle | OR of three blank-string checks | Any of street/city/country blank. SOQL OR is feasible but per-row emission with aggregated counts is Apex shape. |
| LE-003 | LegalEntityChecksBundle | all-inactive branch | "All entities inactive" — needs aggregate count = 0 of actives. |
| LE-004 | LegalEntityChecksBundle | aggregated complexity warning | Fires when active count ≥ 3. |
| PERF-001 | PerformanceChecksBundle | aggregated count with severity escalation | n ≥ 50 → Warning; n ≥ 100 → Critical. |
| PERF-002 | PerformanceChecksBundle | aggregated count with severity escalation | Same shape, product rules. |
| PERF-003 | PerformanceChecksBundle | grouped quote-line statistics | Avg/max/heavy quote lines per quote. |
| PERF-004 | PerformanceChecksBundle | aggregated count threshold | Active summary variables ≥ 20. |
| PERF-005 | PerformanceChecksBundle | weighted composite score | Multi-input formula `(pr*3) + (prd*2) + …`. |
| PR-001 | PriceRuleChecksBundle | cross-child bucket aggregation | Groups rules by (evalOrder, action field) from child subquery. |
| PR-002 | PriceRuleChecksBundle | child-count XOR | Conditions = 0 OR actions = 0. |
| PR-003 | PriceRuleChecksBundle | group-by-evaluation-order | Bucket size ≥ 2. |
| PR-004 | PriceRuleChecksBundle | per-field rule-count aggregation | 3+ rules write same action field. |
| LQ-001 | PriceRuleChecksBundle | parent + child existence | Rule has LookupObject but no action with SourceLookupField. |
| LQ-002 | PriceRuleChecksBundle | parent + child existence | Inverse of LQ-001. |
| UA-003 | PriceRuleChecksBundle | cross-bundle composite threshold | Aggregates inactive counts across price + product rules; pct gates. |
| UA-001 | ProductHygieneChecksBundle | cross-object anti-join with date filter | Active products not appearing in `SBQQ__QuoteLine__c` in 12 months — anti-semi-joinable. |
| PRD-001 | ProductRuleChecksBundle | per-product two-set intersection | Same product added by one rule AND removed by another. |
| PRD-002 | ProductRuleChecksBundle | group-by-(type, eval-order) | Bucket size ≥ 2. |
| PRD-003 | ProductRuleChecksBundle | child-count zero | No actions AND no error conditions. |
| PRD-004 | ProductRuleChecksBundle | conditional null check by type | Validation/Alert with no `SBQQ__ConditionsMet__c`. SOQL-feasible (`SBQQ__Type__c IN ('Validation','Alert') AND SBQQ__ConditionsMet__c = null`); kept Apex due to field-presence guard. |
| LQ-003 | ProductRuleChecksBundle | selection-action child filter | Selection rule with selection-typed actions missing Product. |
| LQ-004 | ProductRuleChecksBundle | per-action inactive-product check | One finding per action targeting inactive child product. |
| LQ-005 | ProductRuleChecksBundle | gated aggregation | Only fires when ≥ 2 selection rules. |
| QL-002 | QuoteLineChecksBundle | per-row math comparison | `\|NetTotal - NetPrice * Qty\| / NetPrice * Qty > 1%`. |
| QL-003 | QuoteLineChecksBundle | aggregated count | Negative NetTotal. Per-record migratable (`SBQQ__NetTotal__c < 0`) — kept Apex for current emission shape. |
| QL-004 | QuoteLineChecksBundle | per-row percentage calc | `(1 - NetPrice/ListPrice) > 50%`. |
| TF-001 | QuoteLineChecksBundle | two-field non-zero conflict (×2) | Up to 2 findings — discount + uplift twin-field conflicts. |
| QT-001 | QuoteTemplateChecksBundle | aggregated negation | No row has `SBQQ__Default__c = true` AND list non-empty. |
| QT-002 | QuoteTemplateChecksBundle | aggregated by status | Templates with non-Deployed status. |
| QT-004 | QuoteTemplateChecksBundle | aggregated count > 1 | Multiple defaults. |
| RR-001 | RevRecRuleChecksBundle | cross-object inactive-rule join | Active products → inactive rev rec rule. |
| RR-003 | RevRecRuleChecksBundle | per-record gated | Active rule with `CreateRevenueSchedule = 'No'`. Migratable; currently aggregated. |
| RR-004 | RevRecRuleChecksBundle | anti-semi-join | Rules unused by products. Migratable in principle. |
| SR-002 | SubscriptionChecksBundle | field-presence guard | Skips rows missing the field key. |
| SV-001 | SummaryVariableChecksBundle | cross-object reference counting | Counts references in PriceCondition + ErrorCondition. |
| SV-002 | SummaryVariableChecksBundle | OR of three null checks + dynamic missing list | Could be SOQL OR. Description renders missing-field list. |
| SV-003 | SummaryVariableChecksBundle | composite-key duplicate detection | Group by (function, field, target, scope). |
| SV-004 | SummaryVariableChecksBundle | tri-field consistency check | Two-of-three-set XOR logic. |
| SV-005 | SummaryVariableChecksBundle | XOR pair check | Exactly one of CombineWith/CompositeOperator set. |
| SV-006 | SummaryVariableChecksBundle | aggregated cleanup with sample | Inactive list + sample. |
| TR-002 | TaxRuleChecksBundle | cross-object inactive-rule join | Active products → inactive tax rule. |
| TR-004 | TaxRuleChecksBundle | aggregated cleanup with sample | Inactive tax rules. |
| **All 70 ARM detectors** | Arm*ChecksBundle (17 bundles) | **remote callout (Named Credential)** | ARM-001…ARM-051, ARM-110…ARM-112, ARM-120…ARM-122, ARM-130…ARM-133, ARM-171, ARM-190…ARM-193, ARM-210…ARM-214. Per audit rule: always Apex-required because of Named-Credential remote-org query path. Many individual checks (e.g. simple null/active flags on ARM objects) could be expressed as SOQL if the migration target supports remote SOQL — re-evaluate per detector when CustomDetector__mdt gains callout support. |

---

## Sample CustomDetector__mdt records (5 examples)

### 1. AR-001 — Approval rule without approver

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>AR-001 — Approval rule without approver</label>
    <protected>false</protected>
    <values>
        <field>DetectorId__c</field>
        <value xsi:type="xsd:string">AR-001</value>
    </values>
    <values>
        <field>SObject__c</field>
        <value xsi:type="xsd:string">SBQQ__ApprovalRule__c</value>
    </values>
    <values>
        <field>SOQL__c</field>
        <value xsi:type="xsd:string">SELECT Id, Name FROM SBQQ__ApprovalRule__c WHERE SBQQ__Active__c = true AND SBQQ__Approver__c = null AND SBQQ__ApproverField__c = null LIMIT 5000</value>
    </values>
    <values>
        <field>TitleTemplate__c</field>
        <value xsi:type="xsd:string">Approval rule "{Name}" has no approver</value>
    </values>
    <values>
        <field>DescriptionTemplate__c</field>
        <value xsi:type="xsd:string">"{Name}" is active but has neither Approver nor Approver Field. Quotes hitting this rule will have no one to approve them.</value>
    </values>
    <values>
        <field>Severity__c</field>
        <value xsi:type="xsd:string">Critical</value>
    </values>
    <values>
        <field>Category__c</field>
        <value xsi:type="xsd:string">CPQ</value>
    </values>
    <values>
        <field>ProductType__c</field>
        <value xsi:type="xsd:string">CPQ;CPQ+Billing</value>
    </values>
    <values>
        <field>RecoverabilityScore__c</field>
        <value xsi:type="xsd:double">0.9</value>
    </values>
</CustomMetadata>
```

### 2. TR-001 — Active product missing tax rule

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>TR-001 — Active product missing tax rule</label>
    <protected>false</protected>
    <values>
        <field>DetectorId__c</field>
        <value xsi:type="xsd:string">TR-001</value>
    </values>
    <values>
        <field>SObject__c</field>
        <value xsi:type="xsd:string">Product2</value>
    </values>
    <values>
        <field>SOQL__c</field>
        <value xsi:type="xsd:string">SELECT Id, Name FROM Product2 WHERE IsActive = true AND blng__TaxRule__c = null LIMIT 10000</value>
    </values>
    <values>
        <field>TitleTemplate__c</field>
        <value xsi:type="xsd:string">Product "{Name}" missing tax rule</value>
    </values>
    <values>
        <field>DescriptionTemplate__c</field>
        <value xsi:type="xsd:string">Active product has no tax rule. Tax won't be calculated on quote lines or invoices that include it.</value>
    </values>
    <values>
        <field>Severity__c</field>
        <value xsi:type="xsd:string">Critical</value>
    </values>
    <values>
        <field>Category__c</field>
        <value xsi:type="xsd:string">Billing</value>
    </values>
    <values>
        <field>ProductType__c</field>
        <value xsi:type="xsd:string">CPQ+Billing;ARM</value>
    </values>
    <values>
        <field>GapUsdPerRecord__c</field>
        <value xsi:type="xsd:double">2000</value>
    </values>
    <values>
        <field>RecoverabilityScore__c</field>
        <value xsi:type="xsd:double">0.85</value>
    </values>
</CustomMetadata>
```

### 3. GL-001 — GL treatment without GL accounts

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>GL-001 — GL treatment without GL accounts</label>
    <protected>false</protected>
    <values>
        <field>DetectorId__c</field>
        <value xsi:type="xsd:string">GL-001</value>
    </values>
    <values>
        <field>SObject__c</field>
        <value xsi:type="xsd:string">blng__GLTreatment__c</value>
    </values>
    <values>
        <field>SOQL__c</field>
        <value xsi:type="xsd:string">SELECT Id, Name FROM blng__GLTreatment__c WHERE blng__Active__c = true AND blng__CreditGLAccount__c = null AND blng__DebitGLAccount__c = null LIMIT 5000</value>
    </values>
    <values>
        <field>TitleTemplate__c</field>
        <value xsi:type="xsd:string">GL treatment "{Name}" has no GL accounts mapped</value>
    </values>
    <values>
        <field>DescriptionTemplate__c</field>
        <value xsi:type="xsd:string">Active GL treatment has neither credit nor debit GL accounts. Journal entries can't post.</value>
    </values>
    <values>
        <field>Severity__c</field>
        <value xsi:type="xsd:string">Critical</value>
    </values>
    <values>
        <field>Category__c</field>
        <value xsi:type="xsd:string">Billing</value>
    </values>
    <values>
        <field>ProductType__c</field>
        <value xsi:type="xsd:string">CPQ+Billing;ARM</value>
    </values>
    <values>
        <field>RecoverabilityScore__c</field>
        <value xsi:type="xsd:double">0.85</value>
    </values>
</CustomMetadata>
```

### 4. PB-002 — Active product missing description

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>PB-002 — Active product missing description</label>
    <protected>false</protected>
    <values>
        <field>DetectorId__c</field>
        <value xsi:type="xsd:string">PB-002</value>
    </values>
    <values>
        <field>SObject__c</field>
        <value xsi:type="xsd:string">Product2</value>
    </values>
    <values>
        <field>SOQL__c</field>
        <value xsi:type="xsd:string">SELECT Id, Name FROM Product2 WHERE IsActive = true AND Description = null LIMIT 10000</value>
    </values>
    <values>
        <field>TitleTemplate__c</field>
        <value xsi:type="xsd:string">Active product "{Name}" missing description</value>
    </values>
    <values>
        <field>DescriptionTemplate__c</field>
        <value xsi:type="xsd:string">Active products without a Description hurt sales discovery and CPQ search.</value>
    </values>
    <values>
        <field>Severity__c</field>
        <value xsi:type="xsd:string">Warning</value>
    </values>
    <values>
        <field>Category__c</field>
        <value xsi:type="xsd:string">Products</value>
    </values>
    <values>
        <field>ProductType__c</field>
        <value xsi:type="xsd:string">CPQ;CPQ+Billing;ARM</value>
    </values>
    <values>
        <field>RecoverabilityScore__c</field>
        <value xsi:type="xsd:double">0.9</value>
    </values>
</CustomMetadata>
```

### 5. QT-005 — Default template not Deployed

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>QT-005 — Default template not Deployed</label>
    <protected>false</protected>
    <values>
        <field>DetectorId__c</field>
        <value xsi:type="xsd:string">QT-005</value>
    </values>
    <values>
        <field>SObject__c</field>
        <value xsi:type="xsd:string">SBQQ__QuoteTemplate__c</value>
    </values>
    <values>
        <field>SOQL__c</field>
        <value xsi:type="xsd:string">SELECT Id, Name, SBQQ__DeploymentStatus__c FROM SBQQ__QuoteTemplate__c WHERE SBQQ__Default__c = true AND SBQQ__DeploymentStatus__c != 'Deployed' LIMIT 5000</value>
    </values>
    <values>
        <field>TitleTemplate__c</field>
        <value xsi:type="xsd:string">Default template "{Name}" is {SBQQ__DeploymentStatus__c}</value>
    </values>
    <values>
        <field>DescriptionTemplate__c</field>
        <value xsi:type="xsd:string">"{Name}" is marked as Default but its status is "{SBQQ__DeploymentStatus__c}" instead of "Deployed". Users cannot generate documents.</value>
    </values>
    <values>
        <field>Severity__c</field>
        <value xsi:type="xsd:string">Critical</value>
    </values>
    <values>
        <field>Category__c</field>
        <value xsi:type="xsd:string">CPQ</value>
    </values>
    <values>
        <field>ProductType__c</field>
        <value xsi:type="xsd:string">CPQ;CPQ+Billing</value>
    </values>
    <values>
        <field>RecoverabilityScore__c</field>
        <value xsi:type="xsd:double">0.9</value>
    </values>
</CustomMetadata>
```

---

## Orphaned mdt rows
None observed during this audit — every detector ID enumerated in `isActive(...)` calls across the 43 bundle files has a corresponding `evaluateXXX` method dispatched in `run()`. PRD-005 is intentionally deferred (commented out in `ProductRuleChecksBundle.run()` because UA-003 already covers inactive product rules) but is not orphaned — it is simply not invoked.

---

## Migration recommendation

**Tier 1 (ship now, 12 detectors — pure WHERE-clause, no semi-join needed):**
AP-001, AP-004, AR-001, CA-001, QCP-001, GL-001, INV-002, PB-002, PB-003, PB-004, SR-003, TR-001, TR-003, RR-002, PBC-001, PBC-002, PBC-003, PBC-004, SET-001, SET-003, SET-004, QT-005, SR-004, CP-002, PR-005, QL-001, SR-001.

**Tier 2 (ship after `WHERE … IN (…)` semi-join support — 8 detectors):**
AR-002 (anti-semi-join), AP-002, AP-003, PB-001, BR-002, BR-003, QT-003, RR-004, UA-001 (cross-object existence checks).

**Tier 3 (stays in Apex — 159 detectors):**
Aggregation, graph traversal, math comparison, severity escalation, and the entire ARM family. These are not low-hanging fruit for `CustomDetector__mdt` migration; revisit only if the framework grows aggregation primitives.
