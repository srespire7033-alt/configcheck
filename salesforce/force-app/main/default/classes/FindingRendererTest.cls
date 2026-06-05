/**
 * Phase 12 — tests for FindingRenderer + AttributionRenderer.
 *
 * The renderers are pure functions on (detector|reason, metadata), so
 * we exercise them directly with synthetic inputs rather than running
 * scans + tracers end-to-end.
 */
@IsTest
private class FindingRendererTest {

    private static ForensicFinding__c makeFinding(String detectorId, Decimal gap) {
        ForensicFinding__c f = new ForensicFinding__c(
            DetectorId__c = detectorId,
            Severity__c = 'Warning',
            Title__c = detectorId + ' draft',
            Description__c = 'engineer draft',
            GapUsd__c = gap,
            Status__c = 'Open',
            DetectedAt__c = System.now()
        );
        return f;
    }

    // ── FindingRenderer ────────────────────────────────────────────────

    @IsTest
    static void money_formats_with_commas_and_drops_round_cents() {
        System.assertEquals('$0', FindingRenderer.money(null));
        System.assertEquals('$0', FindingRenderer.money(0));
        System.assertEquals('$1,000', FindingRenderer.money(1000));
        System.assertEquals('$12,500', FindingRenderer.money(12500));
        System.assertEquals('$1,234,567', FindingRenderer.money(1234567));
        System.assertEquals('$12,500.50', FindingRenderer.money(12500.5));
        System.assertEquals('-$500', FindingRenderer.money(-500));
    }

    @IsTest
    static void pct_handles_fraction_and_whole_forms() {
        // Apex detectors emit pct as 25 (= 25%), not 0.25 — handle both.
        System.assertEquals('25.0%', FindingRenderer.pct(25));
        System.assertEquals('25.0%', FindingRenderer.pct(0.25));
        System.assertEquals('100.0%', FindingRenderer.pct(1));
        System.assertEquals('', FindingRenderer.pct(null));
    }

    @IsTest
    static void toDec_accepts_int_double_string_decimal() {
        System.assertEquals(null, FindingRenderer.toDec(null));
        System.assertEquals(5, FindingRenderer.toDec(5));
        System.assertEquals(5, FindingRenderer.toDec(5L));
        System.assertEquals(5, FindingRenderer.toDec(5.0));
        System.assertEquals(5.5, FindingRenderer.toDec('5.5'));
        System.assertEquals(null, FindingRenderer.toDec('not a number'));
        System.assertEquals(99.99, FindingRenderer.toDec((Decimal) 99.99));
    }

    @IsTest
    static void polish_skips_when_finding_null() {
        FindingRenderer.polish(null, null); // must not throw
    }

    @IsTest
    static void polish_skips_when_detector_unknown() {
        ForensicFinding__c f = makeFinding('NEVER-SEEN', 100);
        FindingRenderer.polish(f, new Map<String, Object>());
        System.assertEquals('engineer draft', f.Description__c,
            'Unknown detector should leave description alone');
    }

    @IsTest
    static void polish_QL_FOR_001_writes_polished_description() {
        ForensicFinding__c f = makeFinding('QL-FOR-001', 1500);
        FindingRenderer.polish(f, new Map<String, Object>());
        System.assert(f.Description__c.contains('$1,500'),
            'Should embed the formatted money: ' + f.Description__c);
        System.assert(f.Description__c.contains('Required bundle option'),
            'Should describe the bundle pattern');
    }

    @IsTest
    static void polish_DSC_FOR_001_includes_schedule_name_and_end_date() {
        ForensicFinding__c f = makeFinding('DSC-FOR-001', 250);
        FindingRenderer.polish(f, new Map<String, Object>{
            'scheduleName' => 'Q4 Promo',
            'scheduleEndDate' => '2024-12-31'
        });
        System.assert(f.Description__c.contains('Q4 Promo'));
        System.assert(f.Description__c.contains('2024-12-31'));
        System.assert(f.Description__c.contains('$250'));
    }

    @IsTest
    static void polish_REN_001_uses_uplift_pct_and_prices() {
        ForensicFinding__c f = makeFinding('REN-001', 1200);
        FindingRenderer.polish(f, new Map<String, Object>{
            'upliftPct' => 5,
            'originalPrice' => 10000,
            'entitledPrice' => 11200
        });
        System.assert(f.Description__c.contains('5.0%'));
        System.assert(f.Description__c.contains('$10,000'));
        System.assert(f.Description__c.contains('$11,200'));
        System.assert(f.Description__c.contains('$1,200'));
    }

    @IsTest
    static void polish_REN_002_describes_below_list_pricing() {
        ForensicFinding__c f = makeFinding('REN-002', 500);
        FindingRenderer.polish(f, new Map<String, Object>{
            'renewalNetPrice' => 800,
            'currentListPrice' => 1000,
            'percentBelowList' => 20
        });
        System.assert(f.Description__c.contains('$800'));
        System.assert(f.Description__c.contains('$1,000'));
        System.assert(f.Description__c.contains('20.0%'));
    }

    @IsTest
    static void polish_ORD_FOR_001_includes_days_and_item_count() {
        ForensicFinding__c f = makeFinding('ORD-FOR-001', 5000);
        FindingRenderer.polish(f, new Map<String, Object>{
            'daysSinceActivation' => 45,
            'itemCount' => 3
        });
        System.assert(f.Description__c.contains('45 days ago'));
        System.assert(f.Description__c.contains('3 OrderItem'));
        System.assert(f.Description__c.contains('$5,000'));
    }

    @IsTest
    static void polish_ORD_FOR_002_labels_direction() {
        ForensicFinding__c f = makeFinding('ORD-FOR-002', 1500);
        FindingRenderer.polish(f, new Map<String, Object>{
            'quoteNetAmount' => 50000,
            'orderTotal' => 48500,
            'delta' => 1500,
            'direction' => 'under_billed'
        });
        System.assert(f.Description__c.contains('under-billed'));
        System.assert(f.Description__c.contains('$50,000'));
        System.assert(f.Description__c.contains('$48,500'));
    }

    @IsTest
    static void polish_ORD_FOR_003_labels_over_billed() {
        ForensicFinding__c f = makeFinding('ORD-FOR-003', 2000);
        FindingRenderer.polish(f, new Map<String, Object>{
            'quoteNetAmount' => 10000,
            'orderTotal' => 12000,
            'delta' => 2000,
            'direction' => 'over_billed'
        });
        System.assert(f.Description__c.contains('over-billed'));
    }

    @IsTest
    static void parseMeta_handles_empty_invalid_and_valid_json() {
        System.assertEquals(0, FindingRenderer.parseMeta(null).size());
        System.assertEquals(0, FindingRenderer.parseMeta('').size());
        System.assertEquals(0, FindingRenderer.parseMeta('not json').size());
        Map<String, Object> ok = FindingRenderer.parseMeta('{"a":1}');
        System.assertEquals(1, ok.get('a'));
    }

    // ── AttributionRenderer ────────────────────────────────────────────

    @IsTest
    static void attributionRenderer_handles_all_class_A_codes() {
        System.assert(AttributionRenderer.render('ACTIVATION_WORKFLOW_NOT_TRIGGERING',
            new Map<String, Object>()).contains('billing schedule'));
        System.assert(AttributionRenderer.render('BILLING_RULE_MISSING_ON_ORDERITEM',
            new Map<String, Object>()).contains('BillingRule'));
        System.assert(AttributionRenderer.render('QUOTE_ORDER_TOTAL_VARIANCE',
            new Map<String, Object>()).contains('Q→O'));
        System.assert(AttributionRenderer.render('AMENDMENT_DELTA_MISMATCH',
            new Map<String, Object>()).contains('Amendment'));
    }

    @IsTest
    static void attributionRenderer_handles_class_B_codes() {
        System.assert(AttributionRenderer.render('MANUAL_OVERRIDE_BELOW_LIST',
            new Map<String, Object>()).contains('PricingMethod__c'));
        System.assert(AttributionRenderer.render('IMPLIED_OVERRIDE_BELOW_LIST',
            new Map<String, Object>()).contains('manual edit'));
        System.assert(AttributionRenderer.render('ORDER_EDITED_POST_ACTIVATION',
            new Map<String, Object>()).contains('manual price adjustment'));
        System.assert(AttributionRenderer.render('AMENDMENT_ORDER_EDITED_POST_ACTIVATION',
            new Map<String, Object>()).contains('manual price adjustment'));
    }

    @IsTest
    static void attributionRenderer_handles_class_C_codes() {
        System.assert(AttributionRenderer.render('RULE_OVERRIDES_NETPRICE_ON_RENEWAL',
            new Map<String, Object>()).contains('Renewal'));
        System.assert(AttributionRenderer.render('RULE_OVERRIDES_NETPRICE_BROADLY',
            new Map<String, Object>()).contains('no Renewal gate'));
        System.assert(AttributionRenderer.render('RULE_OVERRIDES_RELATED_PRICING_FIELD',
            new Map<String, Object>()).contains('related pricing field'));
        System.assert(AttributionRenderer.render('FLOW_MUTATES_RENEWAL_PRICING_FIELD',
            new Map<String, Object>()).contains('Flow'));
    }

    @IsTest
    static void attributionRenderer_handles_class_D_codes() {
        String d1 = AttributionRenderer.render('DISCOUNT_SCHEDULE_PAST_END_DATE',
            new Map<String, Object>{
                'schedule_name' => 'Q4', 'schedule_end_date' => '2024-12-31'
            });
        System.assert(d1.contains('Q4'));
        System.assert(d1.contains('2024-12-31'));
        System.assert(AttributionRenderer.render('AMENDMENT_NO_EFFECTIVE_DATE',
            new Map<String, Object>()).contains('StartDate'));
        System.assert(AttributionRenderer.render('OPPORTUNITY_NO_QUOTE_GOVERNANCE',
            new Map<String, Object>()).contains('Closed-Won'));
        System.assert(AttributionRenderer.render('CONTRACT_RENEWAL_GOVERNANCE_GAP',
            new Map<String, Object>()).contains('renewal'));
        String d5 = AttributionRenderer.render('APPROVAL_PROCESS_NOT_BLOCKING',
            new Map<String, Object>{ 'discount_pct' => 35, 'threshold_pct' => 20 });
        System.assert(d5.contains('35'));
        System.assert(d5.contains('20'));
    }

    @IsTest
    static void attributionRenderer_handles_class_E_codes() {
        System.assert(AttributionRenderer.render('OPTION_PRICE_UNRESOLVED',
            new Map<String, Object>()).contains('bundle option'));
        System.assert(AttributionRenderer.render('ASSET_RECORD_NOT_CREATED',
            new Map<String, Object>()).contains('Asset record'));
        System.assert(AttributionRenderer.render('TERMINATED_ASSET_NO_CREDIT_RECORD',
            new Map<String, Object>()).contains('credit memo'));
        System.assert(AttributionRenderer.render('CONTRACTED_PRICE_DATA_GAP',
            new Map<String, Object>()).contains('Expiration'));
        System.assert(AttributionRenderer.render('MDQ_SEGMENT_PRICING_DATA_GAP',
            new Map<String, Object>()).contains('MDQ'));
        System.assert(AttributionRenderer.render('SUBSCRIPTION_QUANTITY_DRIFT',
            new Map<String, Object>()).contains('quantity'));
        System.assert(AttributionRenderer.render('PROVISIONED_NOT_BILLED_DATA_GAP',
            new Map<String, Object>()).contains('Asset'));
    }

    @IsTest
    static void attributionRenderer_unknown_code_returns_fallback() {
        String prose = AttributionRenderer.render('CODE_FROM_THE_FUTURE',
            new Map<String, Object>());
        System.assert(prose.contains('CODE_FROM_THE_FUTURE'));
        System.assert(prose.contains('Evidence panel'));
    }

    @IsTest
    static void attributionRenderer_null_inputs_safe() {
        System.assertEquals(null, AttributionRenderer.render(null, null));
        System.assertEquals('template-v1', AttributionRenderer.MODEL_TAG);
    }
}
