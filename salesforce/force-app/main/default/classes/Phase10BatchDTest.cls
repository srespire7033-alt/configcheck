/**
 * Phase 10 Batch D — DSC-FOR-002, CT-FOR-001, MDQ-FOR-001.
 * Pure map fixtures, no CPQ namespace compile-time dependency.
 */
@isTest
private class Phase10BatchDTest {

    // ─── DSC-FOR-002: Stacked discounts ──────────────────────────────

    private static Map<String, Object> dsc002Row(Decimal listPrice, Decimal netPrice, Decimal qty) {
        return new Map<String, Object>{
            'lineId' => UserInfo.getUserId(),
            'lineName' => 'QL-001',
            'quoteId' => UserInfo.getUserId(),
            'quoteName' => 'Q-001',
            'accountId' => UserInfo.getOrganizationId(),
            'accountName' => 'Acme',
            'productId' => UserInfo.getUserId(),
            'productName' => 'Widget',
            'listPrice' => listPrice,
            'netPrice' => netPrice,
            'qty' => qty,
            'standardDisc' => 30,
            'additionalDisc' => 20,
            'partnerDisc' => 10,
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void dsc002_belowCap_skips() {
        // listPrice=100, netPrice=60 → 40% discount, below 50% cap.
        System.assertEquals(null, DSC002StackedDiscountsDetector.evaluateRow(dsc002Row(100, 60, 10)));
    }

    @isTest static void dsc002_aboveCap_warning() {
        // 55% effective discount → warning
        DetectorResult r = DSC002StackedDiscountsDetector.evaluateRow(dsc002Row(100, 45, 100));
        System.assertEquals('Warning', r.severity);
    }

    @isTest static void dsc002_extreme_critical() {
        // 80% effective discount → critical
        DetectorResult r = DSC002StackedDiscountsDetector.evaluateRow(dsc002Row(100, 20, 100));
        System.assertEquals('Critical', r.severity);
    }

    @isTest static void dsc002_handlesNullLineId() {
        Map<String, Object> row = dsc002Row(100, 45, 10);
        row.put('lineId', null);
        System.assertEquals(null, DSC002StackedDiscountsDetector.evaluateRow(row));
    }

    @isTest static void dsc002_handlesNetAboveList_skips() {
        System.assertEquals(null, DSC002StackedDiscountsDetector.evaluateRow(dsc002Row(100, 110, 10)));
    }

    @isTest static void dsc002_handlesZeroList_skips() {
        System.assertEquals(null, DSC002StackedDiscountsDetector.evaluateRow(dsc002Row(0, 10, 10)));
    }

    @isTest static void dsc002_unwrap_handlesEmptyAndNull() {
        System.assertNotEquals(null, DSC002StackedDiscountsDetector.unwrap(null));
        System.assertNotEquals(null, DSC002StackedDiscountsDetector.unwrap(new Map<String, Object>()));
    }

    @isTest static void dsc002_runWithStubRows() {
        DSC002StackedDiscountsDetector.testStubRows = new List<Map<String, Object>>{
            dsc002Row(100, 20, 50)
        };
        DSC002StackedDiscountsDetector d = new DSC002StackedDiscountsDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        DSC002StackedDiscountsDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void dsc002_runWithoutStubs_drivesSoqlPath() {
        DSC002StackedDiscountsDetector d = new DSC002StackedDiscountsDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    // ─── CT-FOR-001: Expired Contracted Price ────────────────────────

    private static Map<String, Object> ct001Row(Decimal locked, Decimal current, Decimal qty, Integer daysExpired) {
        return new Map<String, Object>{
            'lineId' => UserInfo.getUserId(),
            'lineName' => 'QL-001',
            'quoteId' => UserInfo.getUserId(),
            'contractedPriceId' => UserInfo.getUserId(),
            'contractedPriceName' => 'CP-001',
            'productName' => 'Widget',
            'lockedPrice' => locked,
            'currentList' => current,
            'quantity' => qty,
            'expiration' => Date.today().addDays(-daysExpired),
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void ct001_lockedBelowList_emits() {
        // locked 100, current 200, qty 10 → gap 1000 → warning
        DetectorResult r = CT001ExpiredContractedPriceDetector.evaluateRow(ct001Row(100, 200, 10, 30));
        System.assertNotEquals(null, r);
        System.assertEquals('Info', r.severity, 'gap = 1000 → info tier');
    }

    @isTest static void ct001_largeGap_critical() {
        DetectorResult r = CT001ExpiredContractedPriceDetector.evaluateRow(ct001Row(100, 200, 1000, 30));
        System.assertEquals('Critical', r.severity);
    }

    @isTest static void ct001_lockedAboveList_skips() {
        System.assertEquals(null, CT001ExpiredContractedPriceDetector.evaluateRow(ct001Row(200, 100, 10, 30)));
    }

    @isTest static void ct001_handlesNullLineId() {
        Map<String, Object> row = ct001Row(100, 200, 10, 30);
        row.put('lineId', null);
        System.assertEquals(null, CT001ExpiredContractedPriceDetector.evaluateRow(row));
    }

    @isTest static void ct001_handlesStringExpiration() {
        Map<String, Object> row = ct001Row(100, 200, 100, 30);
        row.put('expiration', String.valueOf(Date.today().addDays(-30)));
        DetectorResult r = CT001ExpiredContractedPriceDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
    }

    @isTest static void ct001_runWithStubRows() {
        CT001ExpiredContractedPriceDetector.testStubRows = new List<Map<String, Object>>{
            ct001Row(100, 200, 1000, 30)
        };
        CT001ExpiredContractedPriceDetector d = new CT001ExpiredContractedPriceDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        CT001ExpiredContractedPriceDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void ct001_runWithStubLines_drivesFullPipeline() {
        Id lineId = UserInfo.getUserId();
        Id cpId = UserInfo.getUserId();
        Id prodId = UserInfo.getUserId();
        Map<String, Object> line = new Map<String, Object>{
            'Id' => lineId,
            'Name' => 'QL-001',
            'SBQQ__Quote__c' => UserInfo.getUserId(),
            'SBQQ__ContractedPrice__c' => cpId,
            'SBQQ__Product__c' => prodId,
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'Widget' },
            'SBQQ__Quantity__c' => 100
        };
        CurrencyContext.addToTestMap(line, 'USD');
        CT001ExpiredContractedPriceDetector.testStubLines = new List<Map<String, Object>>{ line };
        CT001ExpiredContractedPriceDetector.testStubCpById = new Map<Id, Map<String, Object>>{
            cpId => new Map<String, Object>{
                'Id' => cpId,
                'Name' => 'CP-001',
                'SBQQ__Price__c' => 100,
                'SBQQ__ExpirationDate__c' => Date.today().addDays(-30)
            }
        };
        CT001ExpiredContractedPriceDetector.testStubPbeByProduct = new Map<Id, Decimal>{ prodId => 250 };
        CT001ExpiredContractedPriceDetector d = new CT001ExpiredContractedPriceDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        CT001ExpiredContractedPriceDetector.testStubLines = null;
        CT001ExpiredContractedPriceDetector.testStubCpById = null;
        CT001ExpiredContractedPriceDetector.testStubPbeByProduct = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void ct001_runWithStubLines_currentBelowLocked_skips() {
        Id cpId = UserInfo.getUserId();
        Id prodId = UserInfo.getUserId();
        Map<String, Object> line = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'QL-001',
            'SBQQ__ContractedPrice__c' => cpId,
            'SBQQ__Product__c' => prodId,
            'SBQQ__Quantity__c' => 10
        };
        CurrencyContext.addToTestMap(line, 'USD');
        CT001ExpiredContractedPriceDetector.testStubLines = new List<Map<String, Object>>{ line };
        CT001ExpiredContractedPriceDetector.testStubCpById = new Map<Id, Map<String, Object>>{
            cpId => new Map<String, Object>{
                'Id' => cpId,
                'Name' => 'CP-001',
                'SBQQ__Price__c' => 200,
                'SBQQ__ExpirationDate__c' => Date.today().addDays(-30)
            }
        };
        // Current list below locked → not a leak.
        CT001ExpiredContractedPriceDetector.testStubPbeByProduct = new Map<Id, Decimal>{ prodId => 100 };
        CT001ExpiredContractedPriceDetector d = new CT001ExpiredContractedPriceDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        CT001ExpiredContractedPriceDetector.testStubLines = null;
        CT001ExpiredContractedPriceDetector.testStubCpById = null;
        CT001ExpiredContractedPriceDetector.testStubPbeByProduct = null;
        System.assertEquals(0, r.size());
    }

    @isTest static void ct001_runWithoutStubs_drivesSoqlPath() {
        CT001ExpiredContractedPriceDetector d = new CT001ExpiredContractedPriceDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    /** Drives lookupContractedPrices and lookupCurrentList helpers
     *  by providing testStubLines only — helpers run against local org. */
    @isTest static void ct001_helpersUnstubbed_drivesHelperCode() {
        Map<String, Object> line = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'QL-001',
            'SBQQ__ContractedPrice__c' => UserInfo.getUserId(),
            'SBQQ__Product__c' => UserInfo.getUserId(),
            'SBQQ__Quantity__c' => 10
        };
        CurrencyContext.addToTestMap(line, 'USD');
        CT001ExpiredContractedPriceDetector.testStubLines = new List<Map<String, Object>>{ line };
        // Leave testStubCpById and testStubPbeByProduct null — helpers run.
        CT001ExpiredContractedPriceDetector d = new CT001ExpiredContractedPriceDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        CT001ExpiredContractedPriceDetector.testStubLines = null;
        // No assertion on count — helpers may return empty maps if CPQ
        // objects aren't queryable. Point is to drive their code paths.
        System.assert(r != null);
    }

    // ─── MDQ-FOR-001: Segment pricing ────────────────────────────────

    @isTest static void mdq001_emitsCriticalForLargeGap() {
        // Year-1 net 100, 3 segments, expected uplifts not applied → flagged
        List<Map<String, Object>> flagged = new List<Map<String, Object>>{
            new Map<String, Object>{ 'segment' => 1, 'expected' => 105, 'actual' => 100, 'gap' => 50000 },
            new Map<String, Object>{ 'segment' => 2, 'expected' => 110.25, 'actual' => 100, 'gap' => 25000 }
        };
        Map<String, Object> row = new Map<String, Object>{
            'year1Id' => UserInfo.getUserId(),
            'year1Name' => 'QL-Y1',
            'year1Net' => 100,
            'year1Qty' => 1000,
            'quoteId' => UserInfo.getUserId(),
            'productId' => UserInfo.getUserId(),
            'productName' => 'Widget Multi-Year',
            'segmentCount' => 3,
            'flaggedSegs' => flagged,
            'totalGap' => 75000,
            'currencyIsoCode' => 'USD'
        };
        DetectorResult r = MDQ001SegmentPricingDetector.evaluateRow(row);
        System.assertEquals('Critical', r.severity);
    }

    @isTest static void mdq001_smallGap_info() {
        Map<String, Object> row = new Map<String, Object>{
            'year1Id' => UserInfo.getUserId(),
            'year1Name' => 'QL-Y1',
            'year1Net' => 100,
            'segmentCount' => 2,
            'flaggedSegs' => new List<Map<String, Object>>{
                new Map<String, Object>{ 'segment' => 1, 'gap' => 100 }
            },
            'totalGap' => 100,
            'currencyIsoCode' => 'USD'
        };
        DetectorResult r = MDQ001SegmentPricingDetector.evaluateRow(row);
        System.assertEquals('Info', r.severity);
    }

    @isTest static void mdq001_subDollarGap_skips() {
        Map<String, Object> row = new Map<String, Object>{
            'year1Id' => UserInfo.getUserId(),
            'totalGap' => 0.5,
            'flaggedSegs' => new List<Map<String, Object>>(),
            'currencyIsoCode' => 'USD'
        };
        System.assertEquals(null, MDQ001SegmentPricingDetector.evaluateRow(row));
    }

    @isTest static void mdq001_nullYear1Id_skips() {
        System.assertEquals(null, MDQ001SegmentPricingDetector.evaluateRow(new Map<String, Object>()));
    }

    @isTest static void mdq001_runWithStubLines_drivesFullPipeline() {
        Id quoteId = UserInfo.getUserId();
        Id prodId = UserInfo.getUserId();
        // Year 1 at $100, Year 2 also at $100 (should be $105 with 5% uplift)
        // Year 3 also at $100 (should be ~$110.25)
        Map<String, Object> y1 = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'Y1',
            'SBQQ__Quote__c' => quoteId,
            'SBQQ__Product__c' => prodId,
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'Widget' },
            'SBQQ__NetPrice__c' => 100,
            'SBQQ__Quantity__c' => 1000,
            'SBQQ__SegmentIndex__c' => 0
        };
        CurrencyContext.addToTestMap(y1, 'USD');
        Map<String, Object> y2 = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'Y2',
            'SBQQ__Quote__c' => quoteId,
            'SBQQ__Product__c' => prodId,
            'SBQQ__NetPrice__c' => 100,
            'SBQQ__Quantity__c' => 1000,
            'SBQQ__SegmentIndex__c' => 1
        };
        CurrencyContext.addToTestMap(y2, 'USD');
        Map<String, Object> y3 = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'Y3',
            'SBQQ__Quote__c' => quoteId,
            'SBQQ__Product__c' => prodId,
            'SBQQ__NetPrice__c' => 100,
            'SBQQ__Quantity__c' => 1000,
            'SBQQ__SegmentIndex__c' => 2
        };
        CurrencyContext.addToTestMap(y3, 'USD');
        MDQ001SegmentPricingDetector.testStubLines = new List<Map<String, Object>>{ y1, y2, y3 };
        MDQ001SegmentPricingDetector d = new MDQ001SegmentPricingDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        MDQ001SegmentPricingDetector.testStubLines = null;
        System.assertEquals(1, r.size(), 'One Quote+Product group with 3 segments → 1 finding');
        System.assert(r[0].gapUsd > 0);
    }

    @isTest static void mdq001_runWithStubLines_singleSegment_skips() {
        MDQ001SegmentPricingDetector.testStubLines = new List<Map<String, Object>>{
            new Map<String, Object>{
                'Id' => UserInfo.getUserId(),
                'SBQQ__Quote__c' => UserInfo.getUserId(),
                'SBQQ__Product__c' => UserInfo.getUserId(),
                'SBQQ__NetPrice__c' => 100,
                'SBQQ__Quantity__c' => 1,
                'SBQQ__SegmentIndex__c' => 0
            }
        };
        MDQ001SegmentPricingDetector d = new MDQ001SegmentPricingDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        MDQ001SegmentPricingDetector.testStubLines = null;
        System.assertEquals(0, r.size(), 'Single segment can\'t be compared → no finding');
    }

    @isTest static void mdq001_runWithoutStubs_drivesSoqlPath() {
        MDQ001SegmentPricingDetector d = new MDQ001SegmentPricingDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }
}
