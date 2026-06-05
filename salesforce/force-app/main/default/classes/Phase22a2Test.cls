/**
 * Phase 22a-2 — Tests for the 3 bundles (17 checks total).
 *
 * Uses testStubRows on each bundle to bypass SOQL; verifies the
 * per-check evaluator methods produce the right results given
 * canonical fake row shapes.
 */
@IsTest
private class Phase22a2Test {

    // ── helpers ────────────────────────────────────────────────────

    private static Integer idCounter = 0;

    /** Each call returns a distinct fake Id so dedup logic in checks can
     *  distinguish "two records" from "the same record twice". */
    private static Id mkId(String prefix3) {
        idCounter++;
        String suffix = String.valueOf(idCounter);
        // Pad to 12 chars to make a 15-char Id (Apex accepts 15 or 18).
        while (suffix.length() < 12) suffix = '0' + suffix;
        return (Id) (prefix3 + suffix);
    }
    private static Id fakeRuleId() { return mkId('0kv'); }
    private static Id fakeSvId()   { return mkId('0kw'); }
    private static Id fakeProdId() { return mkId('01t'); }

    private static Map<String, Object> subselect(List<Map<String, Object>> records) {
        return new Map<String, Object>{ 'records' => records };
    }

    private static Map<String, Object> priceRule(String name, Boolean active, Integer order,
            String lookupObj, List<Map<String, Object>> actions, Integer condCount) {
        List<Map<String, Object>> conds = new List<Map<String, Object>>();
        for (Integer i = 0; i < condCount; i++) conds.add(new Map<String, Object>{ 'Id' => fakeRuleId() });
        return new Map<String, Object>{
            'Id' => fakeRuleId(),
            'Name' => name,
            'SBQQ__Active__c' => active,
            'SBQQ__EvaluationOrder__c' => order,
            'SBQQ__LookupObject__c' => lookupObj,
            'SBQQ__PriceActions__r' => subselect(actions),
            'SBQQ__PriceConditions__r' => subselect(conds)
        };
    }

    private static Map<String, Object> priceAction(String field, String sourceLookupField) {
        return new Map<String, Object>{
            'Id' => fakeRuleId(),
            'SBQQ__Field__c' => field,
            'SBQQ__SourceLookupField__c' => sourceLookupField
        };
    }

    // ── PR-001 ────────────────────────────────────────────────────

    @IsTest
    static void pr001_flags_same_order_same_field_conflict() {
        Map<String, Object> r1 = priceRule('R1', true, 10, null,
            new List<Map<String, Object>>{ priceAction('NetPrice', null) }, 1);
        Map<String, Object> r2 = priceRule('R2', true, 10, null,
            new List<Map<String, Object>>{ priceAction('NetPrice', null) }, 1);
        List<DetectorResult> out = PriceRuleChecksBundle.evaluatePR001(
            new List<Map<String, Object>>{ r1, r2 });
        System.assertEquals(1, out.size(), 'Two rules conflicting → one finding');
        System.assertEquals('PR-001', out[0].detectorId);
        System.assertEquals('Critical', out[0].severity);
    }

    @IsTest
    static void pr001_does_not_flag_different_orders() {
        Map<String, Object> r1 = priceRule('R1', true, 10, null,
            new List<Map<String, Object>>{ priceAction('NetPrice', null) }, 1);
        Map<String, Object> r2 = priceRule('R2', true, 20, null,
            new List<Map<String, Object>>{ priceAction('NetPrice', null) }, 1);
        System.assertEquals(0, PriceRuleChecksBundle.evaluatePR001(
            new List<Map<String, Object>>{ r1, r2 }).size());
    }

    @IsTest
    static void pr001_dedups_same_rule_with_two_same_field_actions() {
        // Same rule with TWO actions on same field at same order — must
        // not double-count the rule into a "conflict" bucket of size 2.
        Map<String, Object> r1 = priceRule('R1', true, 10, null,
            new List<Map<String, Object>>{
                priceAction('NetPrice', null),
                priceAction('NetPrice', null)
            }, 1);
        System.assertEquals(0, PriceRuleChecksBundle.evaluatePR001(
            new List<Map<String, Object>>{ r1 }).size(), 'One rule cannot conflict with itself');
    }

    // ── PR-002 ────────────────────────────────────────────────────

    @IsTest
    static void pr002_flags_no_conditions() {
        Map<String, Object> r = priceRule('R1', true, 10, null,
            new List<Map<String, Object>>{ priceAction('NetPrice', null) }, 0);
        List<DetectorResult> out = PriceRuleChecksBundle.evaluatePR002(
            new List<Map<String, Object>>{ r });
        System.assertEquals(1, out.size());
        System.assert(out[0].title.contains('conditions'));
    }

    @IsTest
    static void pr002_flags_no_actions() {
        Map<String, Object> r = priceRule('R1', true, 10, null,
            new List<Map<String, Object>>(), 1);
        List<DetectorResult> out = PriceRuleChecksBundle.evaluatePR002(
            new List<Map<String, Object>>{ r });
        System.assertEquals(1, out.size());
        System.assert(out[0].title.contains('actions'));
    }

    @IsTest
    static void pr002_no_flag_when_both_present() {
        Map<String, Object> r = priceRule('R1', true, 10, null,
            new List<Map<String, Object>>{ priceAction('NetPrice', null) }, 1);
        System.assertEquals(0, PriceRuleChecksBundle.evaluatePR002(
            new List<Map<String, Object>>{ r }).size());
    }

    // ── PR-003 ────────────────────────────────────────────────────

    @IsTest
    static void pr003_flags_duplicate_eval_order() {
        Map<String, Object> r1 = priceRule('R1', true, 10, null, new List<Map<String, Object>>(), 1);
        Map<String, Object> r2 = priceRule('R2', true, 10, null, new List<Map<String, Object>>(), 1);
        List<DetectorResult> out = PriceRuleChecksBundle.evaluatePR003(
            new List<Map<String, Object>>{ r1, r2 });
        System.assertEquals(1, out.size());
        System.assertEquals('Info', out[0].severity);
    }

    // ── PR-004 ────────────────────────────────────────────────────

    @IsTest
    static void pr004_flags_three_or_more_rules_on_same_field() {
        List<Map<String, Object>> rules = new List<Map<String, Object>>();
        for (Integer i = 0; i < 3; i++) {
            rules.add(priceRule('R' + i, true, 10 + i, null,
                new List<Map<String, Object>>{ priceAction('NetPrice', null) }, 1));
        }
        List<DetectorResult> out = PriceRuleChecksBundle.evaluatePR004(rules);
        System.assertEquals(1, out.size());
    }

    @IsTest
    static void pr004_does_not_flag_below_threshold() {
        List<Map<String, Object>> rules = new List<Map<String, Object>>{
            priceRule('R1', true, 10, null, new List<Map<String, Object>>{ priceAction('NetPrice', null) }, 1),
            priceRule('R2', true, 20, null, new List<Map<String, Object>>{ priceAction('NetPrice', null) }, 1)
        };
        System.assertEquals(0, PriceRuleChecksBundle.evaluatePR004(rules).size());
    }

    // ── PR-005 ────────────────────────────────────────────────────

    @IsTest
    static void pr005_emits_one_aggregated_finding() {
        List<Map<String, Object>> rules = new List<Map<String, Object>>{
            priceRule('R1', true, null, null, new List<Map<String, Object>>(), 1),
            priceRule('R2', true, null, null, new List<Map<String, Object>>(), 1)
        };
        List<DetectorResult> out = PriceRuleChecksBundle.evaluatePR005(rules);
        System.assertEquals(1, out.size(), 'Aggregated — one finding regardless of count');
        System.assertEquals('Warning', out[0].severity);
        System.assertEquals(1, out[0].supportingRecords.size(), '2 rules → 1 primary + 1 supporting');
    }

    // ── LQ-001 / LQ-002 ───────────────────────────────────────────

    @IsTest
    static void lq001_flags_lookup_obj_without_source_field() {
        Map<String, Object> r = priceRule('R1', true, 10, 'Account',
            new List<Map<String, Object>>{ priceAction('NetPrice', null) }, 1);
        List<DetectorResult> out = PriceRuleChecksBundle.evaluateLQ001(
            new List<Map<String, Object>>{ r });
        System.assertEquals(1, out.size());
        System.assertEquals('LQ-001', out[0].detectorId);
    }

    @IsTest
    static void lq002_flags_source_field_without_lookup_obj() {
        Map<String, Object> r = priceRule('R1', true, 10, null,
            new List<Map<String, Object>>{ priceAction('NetPrice', 'AnnualRevenue') }, 1);
        List<DetectorResult> out = PriceRuleChecksBundle.evaluateLQ002(
            new List<Map<String, Object>>{ r });
        System.assertEquals(1, out.size());
        System.assertEquals('LQ-002', out[0].detectorId);
    }

    // ── UA-003 ────────────────────────────────────────────────────

    @IsTest
    static void ua003_fires_at_threshold() {
        List<Map<String, Object>> rules = new List<Map<String, Object>>();
        for (Integer i = 0; i < 5; i++) {
            rules.add(priceRule('R' + i, false, null, null, new List<Map<String, Object>>(), 0));
        }
        PriceRuleChecksBundle.testStubInactiveProductRuleCount = 0;
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        List<DetectorResult> out = PriceRuleChecksBundle.evaluateUA003(ctx, rules);
        System.assertEquals(1, out.size(), '5+ inactive should fire');
    }

    @IsTest
    static void ua003_no_fire_when_below_threshold() {
        List<Map<String, Object>> rules = new List<Map<String, Object>>{
            priceRule('R1', false, null, null, new List<Map<String, Object>>(), 0),
            priceRule('R2', true,  10,   null, new List<Map<String, Object>>(), 1),
            priceRule('R3', true,  20,   null, new List<Map<String, Object>>(), 1)
        };
        PriceRuleChecksBundle.testStubInactiveProductRuleCount = 0;
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        // 1 of 3 = 33% but only 1 total — fails both thresholds (need ≥5 or ≥3@30%)
        System.assertEquals(0, PriceRuleChecksBundle.evaluateUA003(ctx, rules).size());
    }

    // ── SV bundle ─────────────────────────────────────────────────

    @IsTest
    static void sv002_flags_missing_aggregate_function() {
        Map<String, Object> v = new Map<String, Object>{
            'Id' => fakeSvId(), 'Name' => 'V1', 'SBQQ__Active__c' => true,
            'SBQQ__AggregateFunction__c' => null, 'SBQQ__AggregateField__c' => 'Amount',
            'SBQQ__TargetObject__c' => 'Opportunity'
        };
        List<DetectorResult> out = SummaryVariableChecksBundle.evaluateSV002(
            new List<Map<String, Object>>{ v });
        System.assertEquals(1, out.size());
        System.assertEquals('Critical', out[0].severity);
    }

    @IsTest
    static void sv003_groups_duplicates() {
        Map<String, Object> v1 = new Map<String, Object>{
            'Id' => fakeSvId(), 'Name' => 'V1', 'SBQQ__Active__c' => true,
            'SBQQ__AggregateFunction__c' => 'Sum', 'SBQQ__AggregateField__c' => 'Amount',
            'SBQQ__TargetObject__c' => 'Opportunity', 'SBQQ__Scope__c' => 'Quote'
        };
        Map<String, Object> v2 = new Map<String, Object>{
            'Id' => fakeSvId(), 'Name' => 'V2', 'SBQQ__Active__c' => true,
            'SBQQ__AggregateFunction__c' => 'Sum', 'SBQQ__AggregateField__c' => 'Amount',
            'SBQQ__TargetObject__c' => 'Opportunity', 'SBQQ__Scope__c' => 'Quote'
        };
        List<DetectorResult> out = SummaryVariableChecksBundle.evaluateSV003(
            new List<Map<String, Object>>{ v1, v2 });
        System.assertEquals(1, out.size());
    }

    @IsTest
    static void sv004_flags_partial_filter() {
        Map<String, Object> v = new Map<String, Object>{
            'Id' => fakeSvId(), 'Name' => 'V1', 'SBQQ__Active__c' => true,
            'SBQQ__FilterField__c' => 'Stage', 'SBQQ__FilterValue__c' => 'Closed Won',
            'SBQQ__Operator__c' => null
        };
        List<DetectorResult> out = SummaryVariableChecksBundle.evaluateSV004(
            new List<Map<String, Object>>{ v });
        System.assertEquals(1, out.size());
    }

    @IsTest
    static void sv005_flags_composite_with_one_operand() {
        Map<String, Object> v = new Map<String, Object>{
            'Id' => fakeSvId(), 'Name' => 'V1', 'SBQQ__Active__c' => true,
            'SBQQ__CombineWith__c' => fakeSvId(), 'SBQQ__CompositeOperator__c' => null
        };
        List<DetectorResult> out = SummaryVariableChecksBundle.evaluateSV005(
            new List<Map<String, Object>>{ v });
        System.assertEquals(1, out.size());
        System.assertEquals('Critical', out[0].severity);
    }

    @IsTest
    static void sv006_aggregates_inactive_count() {
        List<Map<String, Object>> vars = new List<Map<String, Object>>();
        for (Integer i = 0; i < 7; i++) {
            vars.add(new Map<String, Object>{
                'Id' => fakeSvId(), 'Name' => 'V' + i, 'SBQQ__Active__c' => false
            });
        }
        List<DetectorResult> out = SummaryVariableChecksBundle.evaluateSV006(vars);
        System.assertEquals(1, out.size());
        System.assert(out[0].title.contains('7'));
    }

    @IsTest
    static void sv001_flags_orphaned_when_no_refs() {
        Map<String, Object> v = new Map<String, Object>{
            'Id' => fakeSvId(), 'Name' => 'V1', 'SBQQ__Active__c' => true
        };
        SummaryVariableChecksBundle.testStubReferenceCounts = new Map<Id, Integer>();
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        List<DetectorResult> out = SummaryVariableChecksBundle.evaluateSV001(
            ctx, new List<Map<String, Object>>{ v });
        System.assertEquals(1, out.size());
    }

    // ── ProductRule bundle ────────────────────────────────────────

    private static Map<String, Object> productRule(String name, Boolean active, String type,
            Integer order, String lookupObj, List<Map<String, Object>> actions) {
        return new Map<String, Object>{
            'Id' => fakeRuleId(), 'Name' => name,
            'SBQQ__Active__c' => active, 'SBQQ__Type__c' => type,
            'SBQQ__EvaluationOrder__c' => order,
            'SBQQ__LookupObject__c' => lookupObj,
            'SBQQ__Actions__r' => subselect(actions)
        };
    }

    private static Map<String, Object> productAction(String type, Id productId,
            String productName, Boolean productActive) {
        Map<String, Object> act = new Map<String, Object>{
            'Id' => fakeRuleId(), 'SBQQ__Type__c' => type,
            'SBQQ__Product__c' => productId
        };
        if (productId != null) {
            act.put('SBQQ__Product__r', new Map<String, Object>{
                'Name' => productName, 'IsActive' => productActive
            });
        }
        return act;
    }

    @IsTest
    static void lq003_flags_selection_action_without_product() {
        Map<String, Object> rule = productRule('PR1', true, 'Selection', 10, null,
            new List<Map<String, Object>>{ productAction('Add', null, null, false) });
        List<DetectorResult> out = ProductRuleChecksBundle.evaluateLQ003(
            new List<Map<String, Object>>{ rule });
        System.assertEquals(1, out.size());
    }

    @IsTest
    static void lq004_flags_action_to_inactive_product() {
        Map<String, Object> rule = productRule('PR1', true, 'Selection', 10, null,
            new List<Map<String, Object>>{ productAction('Add', fakeProdId(), 'Stale', false) });
        List<DetectorResult> out = ProductRuleChecksBundle.evaluateLQ004(
            new List<Map<String, Object>>{ rule });
        System.assertEquals(1, out.size());
        System.assert(out[0].title.contains('Stale'));
    }

    @IsTest
    static void lq005_requires_two_or_more_selection_rules() {
        Map<String, Object> single = productRule('PR1', true, 'Selection', null, null,
            new List<Map<String, Object>>());
        System.assertEquals(0, ProductRuleChecksBundle.evaluateLQ005(
            new List<Map<String, Object>>{ single }).size(), 'Lonely selection rule — no LQ-005');

        Map<String, Object> r2 = productRule('PR2', true, 'Selection', 10, null,
            new List<Map<String, Object>>());
        List<DetectorResult> out = ProductRuleChecksBundle.evaluateLQ005(
            new List<Map<String, Object>>{ single, r2 });
        System.assertEquals(1, out.size(), 'PR1 has null order, PR2 has 10 → PR1 flagged');
    }

    // ── bundle metadata + happy-path orchestration ────────────────

    @IsTest
    static void bundles_report_correct_ids() {
        System.assertEquals('PR-BUNDLE', new PriceRuleChecksBundle().getDetectorId());
        System.assertEquals('SV-BUNDLE', new SummaryVariableChecksBundle().getDetectorId());
        System.assertEquals('PRD-BUNDLE', new ProductRuleChecksBundle().getDetectorId());
    }

    @IsTest
    static void bundles_return_empty_on_empty_input() {
        PriceRuleChecksBundle.testStubRows = new List<Map<String, Object>>();
        PriceRuleChecksBundle.testStubInactiveProductRuleCount = 0;
        SummaryVariableChecksBundle.testStubRows = new List<Map<String, Object>>();
        SummaryVariableChecksBundle.testStubReferenceCounts = new Map<Id, Integer>();
        ProductRuleChecksBundle.testStubRows = new List<Map<String, Object>>();
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');

        System.assertEquals(0, new PriceRuleChecksBundle().run(ctx).size());
        System.assertEquals(0, new SummaryVariableChecksBundle().run(ctx).size());
        System.assertEquals(0, new ProductRuleChecksBundle().run(ctx).size());
    }

    @IsTest
    static void bundle_run_dispatches_all_checks_on_real_stub_data() {
        // One rule that trips PR-002 (no actions, no conditions).
        Map<String, Object> rule = priceRule('Lonely', true, 10, null,
            new List<Map<String, Object>>(), 0);
        PriceRuleChecksBundle.testStubRows = new List<Map<String, Object>>{ rule };
        PriceRuleChecksBundle.testStubInactiveProductRuleCount = 0;
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');

        List<DetectorResult> out = new PriceRuleChecksBundle().run(ctx);
        // At least PR-002 fires; other checks may or may not depending
        // on data — assert PR-002 is in there.
        Boolean pr002Fired = false;
        for (DetectorResult r : out) if (r.detectorId == 'PR-002') pr002Fired = true;
        System.assert(pr002Fired, 'PR-002 should fire for a rule with no conditions or actions');
    }
}
