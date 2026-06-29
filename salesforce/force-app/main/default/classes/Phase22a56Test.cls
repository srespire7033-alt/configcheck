/**
 * Phase 22a-5 + 22a-6 — Combined test class. Covers happy paths for
 * the 43 checks across 9 bundles via testStub data; verifies bundle
 * ids and empty-state handling.
 */
@IsTest
private class Phase22a56Test {

    private static Integer idCounter = 0;
    private static Id mkId(String prefix3) {
        idCounter++;
        String suffix = String.valueOf(idCounter);
        while (suffix.length() < 12) suffix = '0' + suffix;
        return (Id) (prefix3 + suffix);
    }
    private static Id arId() { return mkId('a0a'); }
    private static Id sId() { return mkId('a0s'); }
    private static Id qtId() { return mkId('a0q'); }
    private static Id gsId() { return mkId('a0g'); }
    private static Id qlId() { return mkId('a0l'); }
    private static Id subId() { return mkId('a0u'); }
    private static Id rId() { return mkId('a0p'); }
    private static Id pid() { return mkId('01t'); }
    private static Id cpId() { return mkId('a0c'); }

    private static Map<String, Object> sub(List<Map<String, Object>> recs) {
        return new Map<String, Object>{ 'records' => recs };
    }

    // ── AR ────────────────────────────────────────────────────────

    @IsTest static void ar001_no_approver() {
        Map<String, Object> r = new Map<String, Object>{ 'Id' => arId(), 'Name' => 'R1',
            'SBQQ__Active__c' => true, 'SBQQ__Approver__c' => null, 'SBQQ__ApproverField__c' => null };
        System.assertEquals(1, ApprovalRuleChecksBundle.evaluateAR001(new List<Map<String, Object>>{ r }).size());
    }
    @IsTest static void ar002_no_conditions() {
        Map<String, Object> r = new Map<String, Object>{ 'Id' => arId(), 'Name' => 'R1',
            'SBQQ__Active__c' => true,
            'SBQQ__ApprovalConditions__r' => sub(new List<Map<String, Object>>()) };
        System.assertEquals(1, ApprovalRuleChecksBundle.evaluateAR002(new List<Map<String, Object>>{ r }).size());
    }
    @IsTest static void ar003_dup_order() {
        Map<String, Object> r1 = new Map<String, Object>{ 'Id' => arId(), 'Name' => 'A',
            'SBQQ__Active__c' => true, 'SBQQ__EvaluationOrder__c' => 10 };
        Map<String, Object> r2 = new Map<String, Object>{ 'Id' => arId(), 'Name' => 'B',
            'SBQQ__Active__c' => true, 'SBQQ__EvaluationOrder__c' => 10 };
        System.assertEquals(1, ApprovalRuleChecksBundle.evaluateAR003(
            new List<Map<String, Object>>{ r1, r2 }).size());
    }
    @IsTest static void ar004_missing_conditions_met() {
        Map<String, Object> r = new Map<String, Object>{ 'Id' => arId(), 'Name' => 'R',
            'SBQQ__Active__c' => true, 'SBQQ__ConditionsMet__c' => null,
            'SBQQ__ApprovalConditions__r' => sub(new List<Map<String, Object>>{
                new Map<String, Object>{ 'Id' => arId() } }) };
        System.assertEquals(1, ApprovalRuleChecksBundle.evaluateAR004(
            new List<Map<String, Object>>{ r }).size());
    }
    @IsTest static void ar005_inactive_cleanup() {
        Map<String, Object> r = new Map<String, Object>{ 'Id' => arId(), 'Name' => 'R',
            'SBQQ__Active__c' => false };
        System.assertEquals(1, ApprovalRuleChecksBundle.evaluateAR005(
            new List<Map<String, Object>>{ r }).size());
    }
    @IsTest static void ar006_old_active_zero_approvals_flags() {
        Id rid = arId();
        Map<String, Object> r = new Map<String, Object>{ 'Id' => rid, 'Name' => 'DeadGate',
            'SBQQ__Active__c' => true,
            'CreatedDate' => Datetime.now().addDays(-180) };
        List<DetectorResult> out = ApprovalRuleChecksBundle.evaluateAR006(
            new List<Map<String, Object>>{ r }, new Map<Id, Integer>());
        System.assertEquals(1, out.size());
        System.assertEquals('AR-006', out[0].detectorId);
    }
    @IsTest static void ar006_new_rule_skipped() {
        Id rid = arId();
        Map<String, Object> r = new Map<String, Object>{ 'Id' => rid, 'Name' => 'New',
            'SBQQ__Active__c' => true,
            'CreatedDate' => Datetime.now().addDays(-10) };
        System.assertEquals(0, ApprovalRuleChecksBundle.evaluateAR006(
            new List<Map<String, Object>>{ r }, new Map<Id, Integer>()).size(),
            'Rule <90d old should be skipped');
    }
    @IsTest static void ar006_has_recent_approvals_skipped() {
        Id rid = arId();
        Map<String, Object> r = new Map<String, Object>{ 'Id' => rid, 'Name' => 'Live',
            'SBQQ__Active__c' => true,
            'CreatedDate' => Datetime.now().addDays(-180) };
        Map<Id, Integer> counts = new Map<Id, Integer>{ rid => 5 };
        System.assertEquals(0, ApprovalRuleChecksBundle.evaluateAR006(
            new List<Map<String, Object>>{ r }, counts).size(),
            'Rule with recent approvals should be skipped');
    }
    @IsTest static void ar006_inactive_skipped() {
        Map<String, Object> r = new Map<String, Object>{ 'Id' => arId(), 'Name' => 'Dead',
            'SBQQ__Active__c' => false,
            'CreatedDate' => Datetime.now().addDays(-180) };
        System.assertEquals(0, ApprovalRuleChecksBundle.evaluateAR006(
            new List<Map<String, Object>>{ r }, new Map<Id, Integer>()).size(),
            'Inactive rules covered by AR-005, not AR-006');
    }
    @IsTest static void ar006_handles_string_createddate() {
        Id rid = arId();
        Map<String, Object> r = new Map<String, Object>{ 'Id' => rid, 'Name' => 'StrDate',
            'SBQQ__Active__c' => true,
            'CreatedDate' => '2020-01-01T00:00:00.000Z' };
        System.assertEquals(1, ApprovalRuleChecksBundle.evaluateAR006(
            new List<Map<String, Object>>{ r }, new Map<Id, Integer>()).size(),
            'String CreatedDate should parse');
    }
    @IsTest static void ar006_via_bundle_with_stub_counts() {
        Id rid = arId();
        ApprovalRuleChecksBundle.testStubRows = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => rid, 'Name' => 'StubGate',
                'SBQQ__Active__c' => true,
                'CreatedDate' => Datetime.now().addDays(-180) }
        };
        ApprovalRuleChecksBundle.testStubApprovalCounts = new Map<Id, Integer>();
        ApprovalRuleChecksBundle.testStubPackage = 'sbaa';  // AR-006 gates on sbaa pkg
        ApprovalRuleChecksBundle b = new ApprovalRuleChecksBundle();
        List<DetectorResult> r = b.run(new DetectorContext(null, 'USD', 'CPQ'));
        ApprovalRuleChecksBundle.testStubRows = null;
        ApprovalRuleChecksBundle.testStubApprovalCounts = null;
        ApprovalRuleChecksBundle.testStubPackage = null;
        Boolean found = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'AR-006') { found = true; break; }
        System.assert(found, 'AR-006 should fire via bundle path with empty stub counts');
    }

    // ── QCP ───────────────────────────────────────────────────────

    @IsTest static void qcp001_empty_code() {
        Map<String, Object> s = new Map<String, Object>{ 'Id' => sId(), 'Name' => 'S',
            'SBQQ__Code__c' => null, 'SBQQ__Type__c' => 'Quote Calculator Plugin' };
        System.assertEquals(1, CustomScriptChecksBundle.evaluateQCP001(new List<Map<String, Object>>{ s }).size());
    }
    @IsTest static void qcp002_missing_transpiled() {
        Map<String, Object> s = new Map<String, Object>{ 'Id' => sId(), 'Name' => 'S',
            'SBQQ__Code__c' => 'function quoteCalculatorPlugin(){}', 'SBQQ__TranspiledCode__c' => null };
        System.assertEquals(1, CustomScriptChecksBundle.evaluateQCP002(new List<Map<String, Object>>{ s }).size());
    }
    @IsTest static void qcp003_perf_concerns() {
        String code = '';
        for (Integer i = 0; i < 4; i++) code += 'for (var j = 0; j < 10; j++) {} ';
        Map<String, Object> s = new Map<String, Object>{ 'Id' => sId(), 'Name' => 'S',
            'SBQQ__Code__c' => code };
        System.assertEquals(1, CustomScriptChecksBundle.evaluateQCP003(new List<Map<String, Object>>{ s }).size());
    }
    @IsTest static void qcp004_multiple_qcps() {
        List<Map<String, Object>> scripts = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => sId(), 'Name' => 'A',
                'SBQQ__Type__c' => 'Quote Calculator Plugin' },
            new Map<String, Object>{ 'Id' => sId(), 'Name' => 'B',
                'SBQQ__Type__c' => 'Quote Calculator Plugin' }
        };
        System.assertEquals(1, CustomScriptChecksBundle.evaluateQCP004(scripts).size());
    }

    // ── SET ───────────────────────────────────────────────────────

    @IsTest static void set001_triggers_disabled() {
        Map<String, Object> s = new Map<String, Object>{ 'SBQQ__TriggerDisabled__c' => true };
        System.assertEquals(1, CpqSettingsChecksBundle.evaluateSET001(s).size());
    }
    @IsTest static void set002_qcp_active() {
        System.assertEquals(1, CpqSettingsChecksBundle.evaluateSET002().size());
    }
    @IsTest static void set003_renewal_unset() {
        Map<String, Object> s = new Map<String, Object>{ 'SBQQ__RenewalModel__c' => null };
        System.assertEquals(1, CpqSettingsChecksBundle.evaluateSET003(s).size());
    }
    @IsTest static void set004_term_unit_unset() {
        Map<String, Object> s = new Map<String, Object>{ 'SBQQ__SubscriptionTermUnit__c' => null };
        System.assertEquals(1, CpqSettingsChecksBundle.evaluateSET004(s).size());
    }

    // ── QT ────────────────────────────────────────────────────────

    @IsTest static void qt001_no_default() {
        Map<String, Object> t = new Map<String, Object>{ 'Id' => qtId(), 'Name' => 'T',
            'SBQQ__Default__c' => false };
        System.assertEquals(1, QuoteTemplateChecksBundle.evaluateQT001(new List<Map<String, Object>>{ t }).size());
    }
    @IsTest static void qt002_non_deployed() {
        Map<String, Object> t = new Map<String, Object>{ 'Id' => qtId(), 'Name' => 'T',
            'SBQQ__DeploymentStatus__c' => 'In Development' };
        System.assertEquals(1, QuoteTemplateChecksBundle.evaluateQT002(new List<Map<String, Object>>{ t }).size());
    }
    @IsTest static void qt003_no_sections() {
        Map<String, Object> t = new Map<String, Object>{ 'Id' => qtId(), 'Name' => 'T',
            'SBQQ__TemplateSections__r' => sub(new List<Map<String, Object>>()) };
        System.assertEquals(1, QuoteTemplateChecksBundle.evaluateQT003(new List<Map<String, Object>>{ t }).size());
    }
    @IsTest static void qt004_multiple_defaults() {
        Map<String, Object> t1 = new Map<String, Object>{ 'Id' => qtId(), 'Name' => 'A', 'SBQQ__Default__c' => true };
        Map<String, Object> t2 = new Map<String, Object>{ 'Id' => qtId(), 'Name' => 'B', 'SBQQ__Default__c' => true };
        System.assertEquals(1, QuoteTemplateChecksBundle.evaluateQT004(
            new List<Map<String, Object>>{ t1, t2 }).size());
    }
    @IsTest static void qt005_default_not_deployed() {
        Map<String, Object> t = new Map<String, Object>{ 'Id' => qtId(), 'Name' => 'T',
            'SBQQ__Default__c' => true, 'SBQQ__DeploymentStatus__c' => 'In Development' };
        System.assertEquals(1, QuoteTemplateChecksBundle.evaluateQT005(new List<Map<String, Object>>{ t }).size());
    }

    // ── GS ────────────────────────────────────────────────────────

    @IsTest static void gs001_no_inputs() {
        Id procId = gsId();
        Map<String, Object> p = new Map<String, Object>{ 'Id' => procId, 'Name' => 'P',
            'SBQQ__Active__c' => true };
        System.assertEquals(1, GuidedSellingChecksBundle.evaluateGS001(
            new List<Map<String, Object>>{ p }, new Map<Id, Integer>()).size());
    }
    @IsTest static void gs002_no_outputs() {
        Id procId = gsId();
        Map<String, Object> p = new Map<String, Object>{ 'Id' => procId, 'Name' => 'P',
            'SBQQ__Active__c' => true };
        System.assertEquals(1, GuidedSellingChecksBundle.evaluateGS002(
            new List<Map<String, Object>>{ p }, new Map<Id, Integer>()).size());
    }
    @IsTest static void gs003_inactive_cleanup() {
        Map<String, Object> p = new Map<String, Object>{ 'Id' => gsId(), 'Name' => 'P',
            'SBQQ__Active__c' => false };
        System.assertEquals(1, GuidedSellingChecksBundle.evaluateGS003(
            new List<Map<String, Object>>{ p }).size());
    }
    @IsTest static void gs004_low_output_ratio() {
        Id procId = gsId();
        Map<String, Object> p = new Map<String, Object>{ 'Id' => procId, 'Name' => 'P',
            'SBQQ__Active__c' => true };
        Map<Id, Integer> ins = new Map<Id, Integer>{ procId => 5 };
        Map<Id, Integer> outs = new Map<Id, Integer>{ procId => 1 };
        System.assertEquals(1, GuidedSellingChecksBundle.evaluateGS004(
            new List<Map<String, Object>>{ p }, ins, outs).size());
    }

    // ── QL / TF ───────────────────────────────────────────────────

    @IsTest static void ql001_zero_netprice() {
        Map<String, Object> q = new Map<String, Object>{ 'Id' => qlId(), 'Name' => 'L',
            'SBQQ__Quantity__c' => 5, 'SBQQ__ListPrice__c' => 100, 'SBQQ__NetPrice__c' => 0,
            'SBQQ__Quote__c' => mkId('a0q') };
        System.assertEquals(1, QuoteLineChecksBundle.evaluateQL001(new List<Map<String, Object>>{ q }).size());
    }
    @IsTest static void ql002_calc_mismatch() {
        Map<String, Object> q = new Map<String, Object>{ 'Id' => qlId(), 'Name' => 'L',
            'SBQQ__NetPrice__c' => 100, 'SBQQ__Quantity__c' => 5, 'SBQQ__NetTotal__c' => 999,
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'Widget' } };
        System.assertEquals(1, QuoteLineChecksBundle.evaluateQL002(new List<Map<String, Object>>{ q }).size());
    }
    @IsTest static void ql003_negative_total() {
        Map<String, Object> q = new Map<String, Object>{ 'Id' => qlId(), 'Name' => 'L',
            'SBQQ__NetTotal__c' => -50 };
        System.assertEquals(1, QuoteLineChecksBundle.evaluateQL003(new List<Map<String, Object>>{ q }).size());
    }
    @IsTest static void ql004_over_50pct_discount() {
        Map<String, Object> q = new Map<String, Object>{ 'Id' => qlId(), 'Name' => 'L',
            'SBQQ__ListPrice__c' => 100, 'SBQQ__NetPrice__c' => 30 };
        System.assertEquals(1, QuoteLineChecksBundle.evaluateQL004(new List<Map<String, Object>>{ q }).size());
    }
    @IsTest static void ql005_subcent_precision_flagged() {
        Map<String, Object> q = new Map<String, Object>{ 'Id' => qlId(), 'Name' => 'L',
            'SBQQ__NetPrice__c' => 100.123456 };
        List<DetectorResult> out = QuoteLineChecksBundle.evaluateQL005(new List<Map<String, Object>>{ q });
        System.assertEquals(1, out.size());
        System.assertEquals('QL-005', out[0].detectorId);
    }
    @IsTest static void ql005_two_decimals_ok() {
        Map<String, Object> q = new Map<String, Object>{ 'Id' => qlId(), 'Name' => 'L',
            'SBQQ__NetPrice__c' => 100.12 };
        System.assertEquals(0, QuoteLineChecksBundle.evaluateQL005(new List<Map<String, Object>>{ q }).size());
    }
    @IsTest static void ql005_whole_dollar_ok() {
        Map<String, Object> q = new Map<String, Object>{ 'Id' => qlId(), 'Name' => 'L',
            'SBQQ__NetPrice__c' => 100 };
        System.assertEquals(0, QuoteLineChecksBundle.evaluateQL005(new List<Map<String, Object>>{ q }).size());
    }
    @IsTest static void ql005_null_netprice_skipped() {
        Map<String, Object> q = new Map<String, Object>{ 'Id' => qlId(), 'Name' => 'L',
            'SBQQ__NetPrice__c' => null };
        System.assertEquals(0, QuoteLineChecksBundle.evaluateQL005(new List<Map<String, Object>>{ q }).size());
    }
    @IsTest static void ql006_large_drift_flagged() {
        Id origId = qlId();
        Map<String, Object> q = new Map<String, Object>{
            'Id' => qlId(), 'Name' => 'L', 'SBQQ__NetPrice__c' => 150,
            'SBQQ__Source__c' => origId,
            'SBQQ__Source__r' => new Map<String, Object>{
                'Id' => origId, 'Name' => 'ORIG', 'SBQQ__NetPrice__c' => 100
            }
        };
        List<DetectorResult> out = QuoteLineChecksBundle.evaluateQL006(new List<Map<String, Object>>{ q });
        System.assertEquals(1, out.size());
        System.assertEquals('QL-006', out[0].detectorId);
    }
    @IsTest static void ql006_small_drift_ok() {
        Id origId = qlId();
        Map<String, Object> q = new Map<String, Object>{
            'Id' => qlId(), 'Name' => 'L', 'SBQQ__NetPrice__c' => 103,
            'SBQQ__Source__c' => origId,
            'SBQQ__Source__r' => new Map<String, Object>{
                'Id' => origId, 'SBQQ__NetPrice__c' => 100
            }
        };
        System.assertEquals(0, QuoteLineChecksBundle.evaluateQL006(new List<Map<String, Object>>{ q }).size(),
            '3% uplift should not flag');
    }
    @IsTest static void ql006_no_original_skipped() {
        Map<String, Object> q = new Map<String, Object>{ 'Id' => qlId(), 'Name' => 'L',
            'SBQQ__NetPrice__c' => 999, 'SBQQ__Source__c' => null };
        System.assertEquals(0, QuoteLineChecksBundle.evaluateQL006(new List<Map<String, Object>>{ q }).size(),
            'New-business quote lines (no original) should not flag');
    }
    @IsTest static void ql006_zero_original_skipped() {
        Id origId = qlId();
        Map<String, Object> q = new Map<String, Object>{
            'Id' => qlId(), 'Name' => 'L', 'SBQQ__NetPrice__c' => 100,
            'SBQQ__Source__c' => origId,
            'SBQQ__Source__r' => new Map<String, Object>{
                'Id' => origId, 'SBQQ__NetPrice__c' => 0
            }
        };
        System.assertEquals(0, QuoteLineChecksBundle.evaluateQL006(new List<Map<String, Object>>{ q }).size(),
            'Zero original price guards against div-by-zero, not flagged');
    }
    @IsTest static void ql006_negative_drift_also_flagged() {
        Id origId = qlId();
        Map<String, Object> q = new Map<String, Object>{
            'Id' => qlId(), 'Name' => 'L', 'SBQQ__NetPrice__c' => 50,
            'SBQQ__Source__c' => origId,
            'SBQQ__Source__r' => new Map<String, Object>{
                'Id' => origId, 'Name' => 'ORIG', 'SBQQ__NetPrice__c' => 100
            }
        };
        System.assertEquals(1, QuoteLineChecksBundle.evaluateQL006(new List<Map<String, Object>>{ q }).size(),
            '-50% drift (price replaced lower) should also flag');
    }
    @IsTest static void tf001_dual_discount() {
        Map<String, Object> q = new Map<String, Object>{ 'Id' => qlId(), 'Name' => 'L',
            'SBQQ__Discount__c' => 10, 'SBQQ__AdditionalDiscount__c' => 5 };
        System.assertEquals(1, QuoteLineChecksBundle.evaluateTF001(new List<Map<String, Object>>{ q }).size());
    }

    // ── SR ────────────────────────────────────────────────────────

    @IsTest static void sr001_zero_netprice() {
        Map<String, Object> s = new Map<String, Object>{ 'Id' => subId(), 'Name' => 'S',
            'SBQQ__NetPrice__c' => 0 };
        System.assertEquals(1, SubscriptionChecksBundle.evaluateSR001(new List<Map<String, Object>>{ s }).size());
    }
    @IsTest static void sr002_no_prorate() {
        Map<String, Object> s = new Map<String, Object>{ 'Id' => subId(), 'Name' => 'S',
            'SBQQ__ProrateMultiplier__c' => 0 };
        System.assertEquals(1, SubscriptionChecksBundle.evaluateSR002(new List<Map<String, Object>>{ s }).size());
    }
    @IsTest static void sr003_no_contract() {
        Map<String, Object> s = new Map<String, Object>{ 'Id' => subId(), 'Name' => 'S',
            'SBQQ__Contract__c' => null };
        System.assertEquals(1, SubscriptionChecksBundle.evaluateSR003(new List<Map<String, Object>>{ s }).size());
    }
    @IsTest static void sr004_high_quantity() {
        Map<String, Object> s = new Map<String, Object>{ 'Id' => subId(), 'Name' => 'S',
            'SBQQ__Quantity__c' => 1500 };
        System.assertEquals(1, SubscriptionChecksBundle.evaluateSR004(new List<Map<String, Object>>{ s }).size());
    }

    // ── PERF ──────────────────────────────────────────────────────

    @IsTest static void perf001_high_rules() {
        System.assertEquals(1, PerformanceChecksBundle.evaluatePERF001(75).size());
    }
    @IsTest static void perf002_high_product_rules() {
        System.assertEquals(1, PerformanceChecksBundle.evaluatePERF002(45).size());
    }
    @IsTest static void perf004_high_summary_vars() {
        System.assertEquals(1, PerformanceChecksBundle.evaluatePERF004(25).size());
    }
    @IsTest static void perf005_complexity() {
        System.assertEquals(1, PerformanceChecksBundle.evaluatePERF005(50, 10, 10, 5, 100, 20, true).size());
    }
    @IsTest static void perf003_runs_with_stub_stats() {
        PerformanceChecksBundle.testStubQuoteLineStats = new Map<String, Integer>{
            'avg' => 60, 'max' => 150, 'heavyCount' => 2, 'quoteCount' => 10
        };
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        System.assertEquals(1, PerformanceChecksBundle.evaluatePERF003(ctx, 50).size());
    }
    @IsTest static void perf006_three_plus_flows_flagged() {
        Map<String, Integer> m = new Map<String, Integer>{
            'Opportunity' => 4, 'Account' => 2, 'Order' => 7
        };
        List<DetectorResult> out = PerformanceChecksBundle.evaluatePERF006(m);
        // Opportunity (4) Warning + Order (7) Critical = 2 findings; Account (2) ignored
        System.assertEquals(2, out.size());
        Map<String, String> severityByTitle = new Map<String, String>();
        for (DetectorResult r : out) severityByTitle.put(r.title, r.severity);
        Boolean foundCritical = false;
        for (String t : severityByTitle.keySet()) if (severityByTitle.get(t) == 'Critical') foundCritical = true;
        System.assert(foundCritical, '7 flows should be Critical');
    }
    @IsTest static void perf006_under_threshold_no_finding() {
        Map<String, Integer> m = new Map<String, Integer>{ 'Account' => 2 };
        System.assertEquals(0, PerformanceChecksBundle.evaluatePERF006(m).size());
    }
    @IsTest static void perf006_null_safe() {
        System.assertEquals(0, PerformanceChecksBundle.evaluatePERF006(null).size());
    }
    @IsTest static void perf007_queue_backlog_warns() {
        Map<String, Integer> s = new Map<String, Integer>{ 'queuedNow' => 400, 'failed24h' => 5 };
        List<DetectorResult> out = PerformanceChecksBundle.evaluatePERF007(s);
        System.assertEquals(1, out.size());
        System.assertEquals('Warning', out[0].severity);
    }
    @IsTest static void perf007_high_failures_critical() {
        Map<String, Integer> s = new Map<String, Integer>{ 'queuedNow' => 10, 'failed24h' => 600 };
        List<DetectorResult> out = PerformanceChecksBundle.evaluatePERF007(s);
        System.assertEquals(1, out.size());
        System.assertEquals('Critical', out[0].severity);
    }
    @IsTest static void perf007_healthy_no_finding() {
        Map<String, Integer> s = new Map<String, Integer>{ 'queuedNow' => 30, 'failed24h' => 2 };
        System.assertEquals(0, PerformanceChecksBundle.evaluatePERF007(s).size());
    }
    @IsTest static void perf007_null_safe() {
        System.assertEquals(0, PerformanceChecksBundle.evaluatePERF007(null).size());
    }
    @IsTest static void perf_via_bundle_with_stubs_runs_67() {
        PerformanceChecksBundle.testStubActivePR = 5;
        PerformanceChecksBundle.testStubActivePRD = 5;
        PerformanceChecksBundle.testStubActiveSV = 5;
        PerformanceChecksBundle.testStubFlowCountsByObject = new Map<String, Integer>{ 'Opportunity' => 6 };
        PerformanceChecksBundle.testStubAsyncApexStats = new Map<String, Integer>{ 'queuedNow' => 500, 'failed24h' => 1 };
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        List<DetectorResult> rs = new PerformanceChecksBundle().run(ctx);
        Set<String> ids = new Set<String>();
        for (DetectorResult r : rs) ids.add(r.detectorId);
        System.assert(ids.contains('PERF-006'), 'PERF-006 should fire via bundle');
        System.assert(ids.contains('PERF-007'), 'PERF-007 should fire via bundle');
        PerformanceChecksBundle.testStubFlowCountsByObject = null;
        PerformanceChecksBundle.testStubAsyncApexStats = null;
    }

    // ── IA ────────────────────────────────────────────────────────

    @IsTest static void ia002_overlap_field() {
        List<Map<String, Object>> rules = new List<Map<String, Object>>();
        for (Integer i = 0; i < 4; i++) {
            rules.add(new Map<String, Object>{
                'Id' => rId(), 'Name' => 'R' + i, 'SBQQ__Active__c' => true,
                'SBQQ__PriceActions__r' => sub(new List<Map<String, Object>>{
                    new Map<String, Object>{ 'SBQQ__Field__c' => 'SBQQ__Discount__c' } }),
                'SBQQ__PriceConditions__r' => sub(new List<Map<String, Object>>())
            });
        }
        System.assertEquals(1, ImpactAnalysisChecksBundle.evaluateIA002(rules).size());
    }
    @IsTest static void ia003_ds_plus_pricerule_overlap() {
        List<Map<String, Object>> rules = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => rId(), 'Name' => 'R', 'SBQQ__Active__c' => true,
                'SBQQ__PriceActions__r' => sub(new List<Map<String, Object>>{
                    new Map<String, Object>{ 'SBQQ__Field__c' => 'SBQQ__Discount__c' } }),
                'SBQQ__PriceConditions__r' => sub(new List<Map<String, Object>>()) }
        };
        System.assertEquals(1, ImpactAnalysisChecksBundle.evaluateIA003(rules, 3).size());
    }
    @IsTest static void ia004_cp_inactive_product() {
        Map<String, Object> cp = new Map<String, Object>{ 'Id' => cpId(),
            'SBQQ__Product__c' => pid(),
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'X', 'IsActive' => false } };
        System.assertEquals(1, ImpactAnalysisChecksBundle.evaluateIA004(
            new List<Map<String, Object>>{ cp }).size());
    }
    @IsTest static void ia006_high_complexity() {
        List<Map<String, Object>> rules = new List<Map<String, Object>>();
        for (Integer i = 0; i < 10; i++) {
            rules.add(new Map<String, Object>{ 'Id' => rId(), 'SBQQ__Active__c' => true,
                'SBQQ__PriceActions__r' => sub(new List<Map<String, Object>>()),
                'SBQQ__PriceConditions__r' => sub(new List<Map<String, Object>>()) });
        }
        System.assertEquals(1, ImpactAnalysisChecksBundle.evaluateIA006(rules, 5, 8).size());
    }

    // ── Direct helper coverage (boost PERF / Settings coverage) ────

    @IsTest static void perf_helpers_run_on_techtorch_no_sbqq() {
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        // No SBQQ on Techtorch → all helpers return 0/false harmlessly,
        // but they execute their try/catch and exit paths.
        System.assertEquals(0, PerformanceChecksBundle.countActive(ctx, 'SBQQ__PriceRule__c'));
        System.assertEquals(0, PerformanceChecksBundle.countAll(ctx, 'SBQQ__DiscountSchedule__c'));
        System.assertEquals(0, PerformanceChecksBundle.countWhere(ctx, 'Product2', 'IsActive = true'));
        System.assertEquals(false, PerformanceChecksBundle.checkQcpExists(ctx));
        Map<String, Integer> stats = PerformanceChecksBundle.computeQLStats(ctx);
        System.assertEquals(0, stats.get('quoteCount'));
    }

    @IsTest static void perf_run_without_stubs_exits_at_gate() {
        // Clear all stubs so run() hits the live-data path → surface
        // gate fires on Techtorch → returns empty. Exercises gate code.
        PerformanceChecksBundle.testStubActivePR = null;
        PerformanceChecksBundle.testStubActivePRD = null;
        PerformanceChecksBundle.testStubActiveSV = null;
        PerformanceChecksBundle.testStubQuoteLineStats = null;
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        System.assertEquals(0, new PerformanceChecksBundle().run(ctx).size());
    }

    @IsTest static void settings_query_helpers_techtorch() {
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        System.assertEquals(null, CpqSettingsChecksBundle.querySettings(ctx));
        System.assertEquals(false, CpqSettingsChecksBundle.queryHasQcp(ctx));
    }

    @IsTest static void settings_run_without_stubs_exits_at_gate() {
        CpqSettingsChecksBundle.testStubSettings = null;
        CpqSettingsChecksBundle.testStubHasQcp = null;
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        // Techtorch has no SBQQ__GeneralSettings__c → gate fires → empty.
        System.assertEquals(0, new CpqSettingsChecksBundle().run(ctx).size());
    }

    @IsTest static void ia_run_without_stubs_exits_at_gate() {
        ImpactAnalysisChecksBundle.testStubRules = null;
        ImpactAnalysisChecksBundle.testStubDsCount = null;
        ImpactAnalysisChecksBundle.testStubContractedPrices = null;
        ImpactAnalysisChecksBundle.testStubActivePRD = null;
        ImpactAnalysisChecksBundle.testStubActiveSV = null;
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        System.assertEquals(0, new ImpactAnalysisChecksBundle().run(ctx).size());
    }

    // ── Bundle ids + empty stubs ──────────────────────────────────

    @IsTest static void bundle_ids_correct() {
        System.assertEquals('AR-BUNDLE', new ApprovalRuleChecksBundle().getDetectorId());
        System.assertEquals('QCP-BUNDLE', new CustomScriptChecksBundle().getDetectorId());
        System.assertEquals('SET-BUNDLE', new CpqSettingsChecksBundle().getDetectorId());
        System.assertEquals('QT-BUNDLE', new QuoteTemplateChecksBundle().getDetectorId());
        System.assertEquals('GS-BUNDLE', new GuidedSellingChecksBundle().getDetectorId());
        System.assertEquals('QL-BUNDLE', new QuoteLineChecksBundle().getDetectorId());
        System.assertEquals('SR-BUNDLE', new SubscriptionChecksBundle().getDetectorId());
        System.assertEquals('PERF-BUNDLE', new PerformanceChecksBundle().getDetectorId());
        System.assertEquals('IA-BUNDLE', new ImpactAnalysisChecksBundle().getDetectorId());
    }

    // ── Run-method dispatch coverage (3 low-coverage bundles) ─────

    @IsTest static void cpq_settings_run_with_data() {
        CpqSettingsChecksBundle.testStubSettings = new Map<String, Object>{
            'Id' => sId(),
            'SBQQ__TriggerDisabled__c' => true,
            'SBQQ__RenewalModel__c' => null,
            'SBQQ__SubscriptionTermUnit__c' => null
        };
        CpqSettingsChecksBundle.testStubHasQcp = true;
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        List<DetectorResult> out = new CpqSettingsChecksBundle().run(ctx);
        // Phase 24g — SET-001/003/004 migrated to CustomDetector__mdt.
        // Only SET-002 (QCP active) still fires from the bundle path.
        System.assertEquals(1, out.size(), 'Only SET-002 fires from bundle; others migrated');
        System.assertEquals('SET-002', out[0].detectorId);
    }

    @IsTest static void performance_run_with_data() {
        PerformanceChecksBundle.testStubActivePR = 75;
        PerformanceChecksBundle.testStubActivePRD = 45;
        PerformanceChecksBundle.testStubActiveSV = 25;
        PerformanceChecksBundle.testStubActiveDS = 5;
        PerformanceChecksBundle.testStubProducts = 100;
        PerformanceChecksBundle.testStubProductOptions = 20;
        PerformanceChecksBundle.testStubHasQcp = true;
        PerformanceChecksBundle.testStubQuoteLineStats = new Map<String, Integer>{
            'avg' => 60, 'max' => 150, 'heavyCount' => 3, 'quoteCount' => 10
        };
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        List<DetectorResult> out = new PerformanceChecksBundle().run(ctx);
        // PERF-001..005 all should fire
        System.assert(out.size() >= 5, 'All 5 PERF checks should fire on these counts');
    }

    @IsTest static void impact_analysis_run_with_data() {
        // 4 active rules all writing to SBQQ__Discount__c → IA-002 fires
        // Plus 2 circular rules → IA-005 fires
        List<Map<String, Object>> rules = new List<Map<String, Object>>();
        for (Integer i = 0; i < 4; i++) {
            rules.add(new Map<String, Object>{
                'Id' => rId(), 'Name' => 'IA-R' + i, 'SBQQ__Active__c' => true,
                'SBQQ__PriceActions__r' => sub(new List<Map<String, Object>>{
                    new Map<String, Object>{ 'SBQQ__Field__c' => 'SBQQ__Discount__c' } }),
                'SBQQ__PriceConditions__r' => sub(new List<Map<String, Object>>())
            });
        }
        // Circular pair: A reads X writes Y; B reads Y writes X.
        rules.add(new Map<String, Object>{
            'Id' => rId(), 'Name' => 'IA-Circ-A', 'SBQQ__Active__c' => true,
            'SBQQ__PriceActions__r' => sub(new List<Map<String, Object>>{
                new Map<String, Object>{ 'SBQQ__Field__c' => 'FieldY' } }),
            'SBQQ__PriceConditions__r' => sub(new List<Map<String, Object>>{
                new Map<String, Object>{ 'SBQQ__Field__c' => 'FieldX' } })
        });
        rules.add(new Map<String, Object>{
            'Id' => rId(), 'Name' => 'IA-Circ-B', 'SBQQ__Active__c' => true,
            'SBQQ__PriceActions__r' => sub(new List<Map<String, Object>>{
                new Map<String, Object>{ 'SBQQ__Field__c' => 'FieldX' } }),
            'SBQQ__PriceConditions__r' => sub(new List<Map<String, Object>>{
                new Map<String, Object>{ 'SBQQ__Field__c' => 'FieldY' } })
        });
        ImpactAnalysisChecksBundle.testStubRules = rules;
        ImpactAnalysisChecksBundle.testStubDsCount = 3;
        ImpactAnalysisChecksBundle.testStubContractedPrices = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => cpId(), 'SBQQ__Product__c' => pid(),
                'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'P', 'IsActive' => false } }
        };
        ImpactAnalysisChecksBundle.testStubActivePRD = 8;
        ImpactAnalysisChecksBundle.testStubActiveSV = 10;
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        List<DetectorResult> out = new ImpactAnalysisChecksBundle().run(ctx);
        // IA-001 + IA-002 + IA-003 + IA-004 + IA-005 + IA-006 all should fire
        System.assert(out.size() >= 5, 'Multiple IA checks should fire; got ' + out.size());
    }

    @IsTest static void ia001_fires_on_dependency_chain() {
        // Rule A writes SBQQ__Discount__c; Rule B reads it → chain
        List<Map<String, Object>> rules = new List<Map<String, Object>>{
            new Map<String, Object>{
                'Id' => rId(), 'Name' => 'Writer', 'SBQQ__Active__c' => true,
                'SBQQ__PriceActions__r' => sub(new List<Map<String, Object>>{
                    new Map<String, Object>{ 'SBQQ__Field__c' => 'SBQQ__Discount__c' } }),
                'SBQQ__PriceConditions__r' => sub(new List<Map<String, Object>>())
            },
            new Map<String, Object>{
                'Id' => rId(), 'Name' => 'Reader', 'SBQQ__Active__c' => true,
                'SBQQ__PriceActions__r' => sub(new List<Map<String, Object>>()),
                'SBQQ__PriceConditions__r' => sub(new List<Map<String, Object>>{
                    new Map<String, Object>{ 'SBQQ__Field__c' => 'SBQQ__Discount__c' } })
            }
        };
        System.assertEquals(1, ImpactAnalysisChecksBundle.evaluateIA001(rules).size());
    }

    @IsTest static void ia005_fires_on_circular_pair() {
        List<Map<String, Object>> rules = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => rId(), 'Name' => 'A', 'SBQQ__Active__c' => true,
                'SBQQ__PriceActions__r' => sub(new List<Map<String, Object>>{
                    new Map<String, Object>{ 'SBQQ__Field__c' => 'Y' } }),
                'SBQQ__PriceConditions__r' => sub(new List<Map<String, Object>>{
                    new Map<String, Object>{ 'SBQQ__Field__c' => 'X' } }) },
            new Map<String, Object>{ 'Id' => rId(), 'Name' => 'B', 'SBQQ__Active__c' => true,
                'SBQQ__PriceActions__r' => sub(new List<Map<String, Object>>{
                    new Map<String, Object>{ 'SBQQ__Field__c' => 'X' } }),
                'SBQQ__PriceConditions__r' => sub(new List<Map<String, Object>>{
                    new Map<String, Object>{ 'SBQQ__Field__c' => 'Y' } }) }
        };
        System.assertEquals(1, ImpactAnalysisChecksBundle.evaluateIA005(rules).size());
    }

    @IsTest static void all_bundles_empty_on_empty_stubs() {
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        ApprovalRuleChecksBundle.testStubRows = new List<Map<String, Object>>();
        CustomScriptChecksBundle.testStubRows = new List<Map<String, Object>>();
        CpqSettingsChecksBundle.testStubSettings = null;
        CpqSettingsChecksBundle.testStubHasQcp = false;
        QuoteTemplateChecksBundle.testStubRows = new List<Map<String, Object>>();
        GuidedSellingChecksBundle.testStubProcesses = new List<Map<String, Object>>();
        GuidedSellingChecksBundle.testStubInputCounts = new Map<Id, Integer>();
        GuidedSellingChecksBundle.testStubOutputCounts = new Map<Id, Integer>();
        QuoteLineChecksBundle.testStubRows = new List<Map<String, Object>>();
        SubscriptionChecksBundle.testStubRows = new List<Map<String, Object>>();
        ImpactAnalysisChecksBundle.testStubRules = new List<Map<String, Object>>();
        ImpactAnalysisChecksBundle.testStubDsCount = 0;
        ImpactAnalysisChecksBundle.testStubContractedPrices = new List<Map<String, Object>>();
        ImpactAnalysisChecksBundle.testStubActivePRD = 0;
        ImpactAnalysisChecksBundle.testStubActiveSV = 0;
        PerformanceChecksBundle.testStubActivePR = 0;
        PerformanceChecksBundle.testStubActivePRD = 0;
        PerformanceChecksBundle.testStubActiveSV = 0;
        PerformanceChecksBundle.testStubActiveDS = 0;
        PerformanceChecksBundle.testStubProducts = 0;
        PerformanceChecksBundle.testStubProductOptions = 0;
        PerformanceChecksBundle.testStubHasQcp = false;
        PerformanceChecksBundle.testStubQuoteLineStats = new Map<String, Integer>{
            'avg' => 0, 'max' => 0, 'heavyCount' => 0, 'quoteCount' => 0 };

        System.assertEquals(0, new ApprovalRuleChecksBundle().run(ctx).size());
        System.assertEquals(0, new CustomScriptChecksBundle().run(ctx).size());
        // SET-BUNDLE with null settings → empty
        System.assertEquals(0, new CpqSettingsChecksBundle().run(ctx).size());
        System.assertEquals(0, new QuoteTemplateChecksBundle().run(ctx).size());
        System.assertEquals(0, new GuidedSellingChecksBundle().run(ctx).size());
        System.assertEquals(0, new QuoteLineChecksBundle().run(ctx).size());
        System.assertEquals(0, new SubscriptionChecksBundle().run(ctx).size());
        // PERF/IA do live SOQL when stubs absent; here stubs ARE set so they run on stubs.
        System.assertEquals(0, new PerformanceChecksBundle().run(ctx).size());
        System.assertEquals(0, new ImpactAnalysisChecksBundle().run(ctx).size());
    }
}
