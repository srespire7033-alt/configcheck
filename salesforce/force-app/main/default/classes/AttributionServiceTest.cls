/**
 * Coverage for Phase 11 attribution tracers + AttributionService.
 *
 * Strategy: seed a ForensicScan__c + one ForensicFinding__c per
 * detector that any tracer routes, then call
 * AttributionService.traceScan and assert the expected reasonCodes
 * appear. We construct the findings directly rather than running the
 * detectors so the tests are fast and don't depend on having CPQ
 * data in the scratch org.
 *
 * ClassCTracer's SOQL against SBQQ__PriceRule__c will throw in a
 * non-CPQ scratch org — we cover it via primeCacheForTest() instead.
 */
@IsTest
private class AttributionServiceTest {

    private static ForensicScan__c newScan() {
        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Running',
            ProductType__c = 'CPQ',
            StartedAt__c = System.now()
        );
        insert s;
        return s;
    }

    private static ForensicFinding__c newFinding(
        Id scanId, String detectorId, Map<String, Object> meta
    ) {
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c = scanId,
            DetectorId__c = detectorId,
            Severity__c = 'Critical',
            Title__c = detectorId + ' test finding',
            Status__c = 'Open',
            DetectedAt__c = System.now(),
            // Use the scan Id as a placeholder PrimaryRecordId — the
            // tracers never dereference it, only echo it into evidence.
            PrimaryRecordId__c = scanId,
            PrimaryRecordType__c = 'SBQQ__QuoteLine__c',
            Metadata__c = meta == null ? '{}' : JSON.serialize(meta)
        );
        insert f;
        return f;
    }

    private static Map<String, AttributionTrace__c> tracesByDetector(Id scanId) {
        Map<String, AttributionTrace__c> out = new Map<String, AttributionTrace__c>();
        for (AttributionTrace__c t : [
            SELECT Id, RootCauseClass__c, ReasonCode__c, Confidence__c,
                   RootConfigType__c, RootConfigId__c, RootConfigName__c,
                   Evidence__c, ForensicFinding__r.DetectorId__c
            FROM AttributionTrace__c
            WHERE ForensicFinding__r.ForensicScan__c = :scanId
        ]) {
            out.put(t.ForensicFinding__r.DetectorId__c + '|' + t.ReasonCode__c, t);
        }
        return out;
    }

    @IsTest
    static void classA_routes_three_detectors() {
        ForensicScan__c scan = newScan();
        newFinding(scan.Id, 'ORD-FOR-001', new Map<String, Object>{
            'orderNumber' => '00012345', 'daysSinceActivation' => 30, 'itemCount' => 2
        });
        newFinding(scan.Id, 'ORD-FOR-002', new Map<String, Object>{
            'quoteNetAmount' => 50000, 'orderTotal' => 45000, 'delta' => 5000,
            'direction' => 'under_billed', 'orderIds' => new List<String>{'O1'}
        });
        newFinding(scan.Id, 'ORD-FOR-003', new Map<String, Object>{
            'quoteNetAmount' => 10000, 'orderTotal' => 8500, 'delta' => 1500,
            'direction' => 'under_billed', 'orderIds' => new List<String>{'O2'}
        });

        DetectorContext ctx = new DetectorContext(scan.Id, 'USD', 'CPQ');
        Test.startTest();
        Integer n = AttributionService.traceScan(scan.Id, ctx);
        Test.stopTest();

        System.assert(n >= 3, 'Expected at least 3 class A traces, got ' + n);
        Map<String, AttributionTrace__c> byKey = tracesByDetector(scan.Id);
        System.assert(byKey.containsKey('ORD-FOR-001|ACTIVATION_WORKFLOW_NOT_TRIGGERING'));
        System.assert(byKey.containsKey('ORD-FOR-002|QUOTE_ORDER_TOTAL_VARIANCE'));
        System.assert(byKey.containsKey('ORD-FOR-003|AMENDMENT_DELTA_MISMATCH'));
        System.assertEquals('A',
            byKey.get('ORD-FOR-001|ACTIVATION_WORKFLOW_NOT_TRIGGERING').RootCauseClass__c);
    }

    @IsTest
    static void classB_routes_REN002_with_and_without_manual_signal() {
        ForensicScan__c scan = newScan();
        // No pricingMethod → IMPLIED with conf 0.6
        newFinding(scan.Id, 'REN-002', new Map<String, Object>{
            'currentListPrice' => 100, 'renewalNetPrice' => 80, 'percentBelowList' => 20
        });

        DetectorContext ctx = new DetectorContext(scan.Id, 'USD', 'CPQ');
        Test.startTest();
        AttributionService.traceScan(scan.Id, ctx);
        Test.stopTest();

        Map<String, AttributionTrace__c> byKey = tracesByDetector(scan.Id);
        AttributionTrace__c t = byKey.get('REN-002|IMPLIED_OVERRIDE_BELOW_LIST');
        System.assertNotEquals(null, t, 'Class B should emit implied-override');
        System.assertEquals(0.6, t.Confidence__c);
    }

    @IsTest
    static void classB_explicit_manual_escalates_to_full_confidence() {
        ForensicScan__c scan = newScan();
        newFinding(scan.Id, 'REN-002', new Map<String, Object>{
            'pricingMethod' => 'Manual',
            'currentListPrice' => 100, 'renewalNetPrice' => 70
        });
        AttributionService.traceScan(scan.Id, new DetectorContext(scan.Id, 'USD', 'CPQ'));
        AttributionTrace__c t = tracesByDetector(scan.Id)
            .get('REN-002|MANUAL_OVERRIDE_BELOW_LIST');
        System.assertNotEquals(null, t);
        System.assertEquals(1.0, t.Confidence__c);
    }

    @IsTest
    static void classC_uses_primed_rules_cache() {
        ForensicScan__c scan = newScan();
        newFinding(scan.Id, 'REN-001', new Map<String, Object>{ 'upliftPct' => 5 });

        // Hand-build the rules cache shape OrgQueryService would
        // return — so we don't need real CPQ data in the org.
        Map<String, Object> action = new Map<String, Object>{
            'Id' => 'a01000000000001',
            'SBQQ__TargetField__c' => 'SBQQ__NetPrice__c',
            'SBQQ__Value__c' => '100'
        };
        Map<String, Object> condition = new Map<String, Object>{
            'Id' => 'a02000000000001',
            'SBQQ__Field__c' => 'SBQQ__Type__c',
            'SBQQ__Operator__c' => 'equals',
            'SBQQ__Value__c' => 'Renewal'
        };
        Map<String, Object> actionsRel = new Map<String, Object>{
            'records' => new List<Object>{ action }
        };
        Map<String, Object> conditionsRel = new Map<String, Object>{
            'records' => new List<Object>{ condition }
        };
        Map<String, Object> rule = new Map<String, Object>{
            'Id' => 'a00000000000001',
            'Name' => 'Renewal NetPrice Override',
            'SBQQ__Active__c' => true,
            'SBQQ__EvaluationEvent__c' => 'On Calculate',
            'SBQQ__PriceActions__r' => actionsRel,
            'SBQQ__PriceConditions__r' => conditionsRel
        };
        ClassCTracer.primeCacheForTest(scan.Id,
            new List<Map<String, Object>>{ rule });

        Test.startTest();
        AttributionService.traceScan(scan.Id, new DetectorContext(scan.Id, 'USD', 'CPQ'));
        Test.stopTest();

        Map<String, AttributionTrace__c> byKey = tracesByDetector(scan.Id);
        AttributionTrace__c t = byKey.get('REN-001|RULE_OVERRIDES_NETPRICE_ON_RENEWAL');
        System.assertNotEquals(null, t, 'Class C should find the renewal-targeting rule');
        System.assertEquals(1.0, t.Confidence__c);
        System.assertEquals('SBQQ__PriceRule__c', t.RootConfigType__c);
        System.assertEquals('Renewal NetPrice Override', t.RootConfigName__c);
    }

    @IsTest
    static void classC_broad_rule_no_renewal_condition_gets_07() {
        ForensicScan__c scan = newScan();
        newFinding(scan.Id, 'REN-001', new Map<String, Object>{ 'upliftPct' => 5 });

        Map<String, Object> action = new Map<String, Object>{
            'SBQQ__TargetField__c' => 'SBQQ__NetPrice__c',
            'SBQQ__Value__c' => '100'
        };
        Map<String, Object> rule = new Map<String, Object>{
            'Id' => 'a00000000000002',
            'Name' => 'Broad Override',
            'SBQQ__PriceActions__r' => new Map<String, Object>{
                'records' => new List<Object>{ action }
            },
            'SBQQ__PriceConditions__r' => new Map<String, Object>{
                'records' => new List<Object>()
            }
        };
        ClassCTracer.primeCacheForTest(scan.Id,
            new List<Map<String, Object>>{ rule });

        AttributionService.traceScan(scan.Id, new DetectorContext(scan.Id, 'USD', 'CPQ'));
        Map<String, AttributionTrace__c> byKey = tracesByDetector(scan.Id);
        AttributionTrace__c t = byKey.get('REN-001|RULE_OVERRIDES_NETPRICE_BROADLY');
        System.assertNotEquals(null, t);
        System.assertEquals(0.7, t.Confidence__c);
    }

    @IsTest
    static void classC_related_field_only_gets_04() {
        ForensicScan__c scan = newScan();
        newFinding(scan.Id, 'REN-001', new Map<String, Object>());

        Map<String, Object> action = new Map<String, Object>{
            'SBQQ__TargetField__c' => 'SBQQ__Discount__c'
        };
        Map<String, Object> rule = new Map<String, Object>{
            'Id' => 'a00000000000003',
            'Name' => 'Discount Override',
            'SBQQ__PriceActions__r' => new Map<String, Object>{
                'records' => new List<Object>{ action }
            },
            'SBQQ__PriceConditions__r' => new Map<String, Object>{
                'records' => new List<Object>()
            }
        };
        ClassCTracer.primeCacheForTest(scan.Id,
            new List<Map<String, Object>>{ rule });

        AttributionService.traceScan(scan.Id, new DetectorContext(scan.Id, 'USD', 'CPQ'));
        AttributionTrace__c t = tracesByDetector(scan.Id)
            .get('REN-001|RULE_OVERRIDES_RELATED_PRICING_FIELD');
        System.assertNotEquals(null, t);
        System.assertEquals(0.4, t.Confidence__c);
    }

    @IsTest
    static void classC_ineligible_detector_emits_nothing() {
        ForensicScan__c scan = newScan();
        newFinding(scan.Id, 'OPP-FOR-001', new Map<String, Object>());
        ClassCTracer.primeCacheForTest(scan.Id, new List<Map<String, Object>>());
        AttributionService.traceScan(scan.Id, new DetectorContext(scan.Id, 'USD', 'CPQ'));
        // Class D will still emit, but no Class C trace.
        for (AttributionTrace__c t : [SELECT RootCauseClass__c FROM AttributionTrace__c
                                       WHERE ForensicFinding__r.ForensicScan__c = :scan.Id]) {
            System.assertNotEquals('C', t.RootCauseClass__c);
        }
    }

    @IsTest
    static void classD_routes_five_detectors() {
        ForensicScan__c scan = newScan();
        newFinding(scan.Id, 'DSC-FOR-001', new Map<String, Object>{
            'scheduleName' => 'Q4 Promo', 'scheduleEndDate' => '2024-12-31'
        });
        newFinding(scan.Id, 'AMD-FOR-001', new Map<String, Object>{
            'status' => 'Activated', 'endDate' => '2025-12-31'
        });
        newFinding(scan.Id, 'OPP-FOR-001', new Map<String, Object>{
            'closeDate' => '2025-01-01', 'daysSinceClose' => 90
        });
        newFinding(scan.Id, 'CON-FOR-001', new Map<String, Object>{
            'flagReason' => 'all_expired', 'subscriptionCount' => 3,
            'latestSubscriptionEnd' => '2024-10-01'
        });
        newFinding(scan.Id, 'QL-FOR-002', new Map<String, Object>{
            'discountPct' => 35, 'thresholdPct' => 20
        });

        AttributionService.traceScan(scan.Id, new DetectorContext(scan.Id, 'USD', 'CPQ'));

        Map<String, AttributionTrace__c> byKey = tracesByDetector(scan.Id);
        System.assert(byKey.containsKey('DSC-FOR-001|DISCOUNT_SCHEDULE_PAST_END_DATE'));
        System.assert(byKey.containsKey('AMD-FOR-001|AMENDMENT_NO_EFFECTIVE_DATE'));
        System.assert(byKey.containsKey('OPP-FOR-001|OPPORTUNITY_NO_QUOTE_GOVERNANCE'));
        System.assert(byKey.containsKey('CON-FOR-001|CONTRACT_RENEWAL_GOVERNANCE_GAP'));
        System.assert(byKey.containsKey('QL-FOR-002|APPROVAL_PROCESS_NOT_BLOCKING'));
        System.assertEquals(1.0,
            byKey.get('AMD-FOR-001|AMENDMENT_NO_EFFECTIVE_DATE').Confidence__c);
    }

    @IsTest
    static void classE_routes_seven_detectors() {
        ForensicScan__c scan = newScan();
        newFinding(scan.Id, 'QL-FOR-001', new Map<String, Object>());
        newFinding(scan.Id, 'PROV-FOR-002', new Map<String, Object>{
            'productName' => 'Widget', 'accountId' => '001000000000001',
            'quantity' => 5, 'unitPrice' => 100
        });
        newFinding(scan.Id, 'AST-FOR-001', new Map<String, Object>{
            'productName' => 'Widget', 'assetStatus' => 'Terminated',
            'terminatedDate' => '2025-03-01', 'annualExposure' => 12000
        });
        newFinding(scan.Id, 'CT-FOR-001', new Map<String, Object>{
            'contractedPriceId' => 'a09000000000001',
            'expiration' => '2024-06-01', 'lockedPrice' => 80,
            'currentList' => 100, 'daysExpired' => 200
        });
        newFinding(scan.Id, 'MDQ-FOR-001', new Map<String, Object>{
            'quoteId' => 'a04000000000001', 'productName' => 'Widget',
            'segmentCount' => 3, 'flaggedSegs' => 2
        });
        newFinding(scan.Id, 'SUB-FOR-001', new Map<String, Object>());
        newFinding(scan.Id, 'PROV-FOR-001', new Map<String, Object>{
            'productName' => 'Widget', 'quantity' => 5, 'unitPrice' => 100,
            'installDate' => '2024-12-01', 'daysInstalled' => 90,
            'priceSource' => 'asset'
        });

        AttributionService.traceScan(scan.Id, new DetectorContext(scan.Id, 'USD', 'CPQ'));

        Map<String, AttributionTrace__c> byKey = tracesByDetector(scan.Id);
        System.assert(byKey.containsKey('QL-FOR-001|OPTION_PRICE_UNRESOLVED'));
        System.assert(byKey.containsKey('PROV-FOR-002|ASSET_RECORD_NOT_CREATED'));
        System.assert(byKey.containsKey('AST-FOR-001|TERMINATED_ASSET_NO_CREDIT_RECORD'));
        System.assert(byKey.containsKey('CT-FOR-001|CONTRACTED_PRICE_DATA_GAP'));
        System.assert(byKey.containsKey('MDQ-FOR-001|MDQ_SEGMENT_PRICING_DATA_GAP'));
        System.assert(byKey.containsKey('SUB-FOR-001|SUBSCRIPTION_QUANTITY_DRIFT'));
        System.assert(byKey.containsKey('PROV-FOR-001|PROVISIONED_NOT_BILLED_DATA_GAP'));
    }

    @IsTest
    static void emptyScan_returns_zero() {
        ForensicScan__c scan = newScan();
        Integer n = AttributionService.traceScan(scan.Id,
            new DetectorContext(scan.Id, 'USD', 'CPQ'));
        System.assertEquals(0, n);
    }

    @IsTest
    static void null_scanId_returns_zero() {
        System.assertEquals(0, AttributionService.traceScan(null,
            new DetectorContext(null, 'USD', 'CPQ')));
    }

    @IsTest
    static void garbled_metadata_does_not_crash_tracers() {
        ForensicScan__c scan = newScan();
        ForensicFinding__c f = newFinding(scan.Id, 'REN-002', new Map<String, Object>());
        f.Metadata__c = '{not valid json';
        update f;

        Test.startTest();
        Integer n = AttributionService.traceScan(scan.Id,
            new DetectorContext(scan.Id, 'USD', 'CPQ'));
        Test.stopTest();
        // Tracer still ran (with empty metadata); produced one Class B candidate
        System.assert(n >= 1);
    }

    @IsTest
    static void unknown_detector_emits_no_trace() {
        ForensicScan__c scan = newScan();
        newFinding(scan.Id, 'XYZ-NEVER-SEEN', new Map<String, Object>());
        Integer n = AttributionService.traceScan(scan.Id,
            new DetectorContext(scan.Id, 'USD', 'CPQ'));
        System.assertEquals(0, n);
    }

    @IsTest
    static void tracer_interfaces_return_class_letter() {
        System.assertEquals('A', new ClassATracer().getRootCauseClass());
        System.assertEquals('B', new ClassBTracer().getRootCauseClass());
        System.assertEquals('C', new ClassCTracer().getRootCauseClass());
        System.assertEquals('D', new ClassDTracer().getRootCauseClass());
        System.assertEquals('E', new ClassETracer().getRootCauseClass());
    }

    @IsTest
    static void candidate_default_evidence_is_empty_map() {
        AttributionCandidate c = new AttributionCandidate();
        System.assertNotEquals(null, c.evidence);
        System.assertEquals(0, c.evidence.size());
    }
}
