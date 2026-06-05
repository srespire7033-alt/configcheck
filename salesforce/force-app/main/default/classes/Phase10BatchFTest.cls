/**
 * Phase 10 Batch F — ORD-FOR-002, ORD-FOR-003 (Quote↔Order variance).
 * Pure map fixtures, no CPQ namespace compile-time dependency.
 */
@isTest
private class Phase10BatchFTest {

    // ─── ORD-FOR-002: new-business Q↔O variance ──────────────────────

    private static Map<String, Object> ord002Row(Decimal quoteNet, Decimal orderTotal) {
        return new Map<String, Object>{
            'quoteId' => UserInfo.getUserId(),
            'quoteName' => 'Q-001',
            'quoteNetAmount' => quoteNet,
            'orderTotal' => orderTotal,
            'orderIds' => new List<Id>{ UserInfo.getUserId() },
            'orderNumbers' => new List<String>{ 'O-001' },
            'accountId' => UserInfo.getOrganizationId(),
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void ord002_largeOverbill_critical() {
        // Quote 100k, Order 200k → delta 100k over-billed
        DetectorResult r = ORD002QuoteOrderVarianceDetector.evaluateRow(ord002Row(100000, 200000));
        System.assertEquals('Critical', r.severity);
        System.assert(r.title.contains('over-billed'));
    }

    @isTest static void ord002_largeUnderbill_critical() {
        DetectorResult r = ORD002QuoteOrderVarianceDetector.evaluateRow(ord002Row(200000, 100000));
        System.assertEquals('Critical', r.severity);
        System.assert(r.title.contains('under-billed'));
    }

    @isTest static void ord002_mediumDelta_warning() {
        DetectorResult r = ORD002QuoteOrderVarianceDetector.evaluateRow(ord002Row(100000, 110000));
        System.assertEquals('Warning', r.severity);
    }

    @isTest static void ord002_smallDelta_info() {
        DetectorResult r = ORD002QuoteOrderVarianceDetector.evaluateRow(ord002Row(100, 200));
        System.assertEquals('Info', r.severity);
    }

    @isTest static void ord002_withinTolerance_skips() {
        // delta of $0.005 → below $0.01 tolerance
        System.assertEquals(null, ORD002QuoteOrderVarianceDetector.evaluateRow(ord002Row(100, 100.005)));
    }

    @isTest static void ord002_handlesNullQuoteId() {
        Map<String, Object> row = ord002Row(100, 200);
        row.put('quoteId', null);
        System.assertEquals(null, ORD002QuoteOrderVarianceDetector.evaluateRow(row));
    }

    @isTest static void ord002_runWithStubRows() {
        ORD002QuoteOrderVarianceDetector.testStubRows = new List<Map<String, Object>>{
            ord002Row(100000, 200000)
        };
        ORD002QuoteOrderVarianceDetector d = new ORD002QuoteOrderVarianceDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        ORD002QuoteOrderVarianceDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void ord002_runWithStubOrders_drivesFullPipeline() {
        Id quoteId = UserInfo.getUserId();
        Id orderId = UserInfo.getUserId();
        Map<String, Object> ord = new Map<String, Object>{
            'Id' => orderId,
            'OrderNumber' => 'O-001',
            'TotalAmount' => 110000,
            'AccountId' => UserInfo.getOrganizationId(),
            'EffectiveDate' => Date.today().addDays(-30),
            'Status' => 'Activated',
            'SBQQ__Quote__c' => quoteId,
            'SBQQ__Quote__r' => new Map<String, Object>{
                'Id' => quoteId,
                'Name' => 'Q-001',
                'SBQQ__NetAmount__c' => 100000,
                'SBQQ__Type__c' => 'Quote',
                'SBQQ__Account__c' => UserInfo.getOrganizationId()
            }
        };
        CurrencyContext.addToTestMap(ord, 'USD');
        ORD002QuoteOrderVarianceDetector.testStubOrders = new List<Map<String, Object>>{ ord };
        ORD002QuoteOrderVarianceDetector d = new ORD002QuoteOrderVarianceDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        ORD002QuoteOrderVarianceDetector.testStubOrders = null;
        System.assertEquals(1, r.size(), 'Quote vs Order delta should flag');
    }

    @isTest static void ord002_amendmentType_skipsInNewBizDetector() {
        Id quoteId = UserInfo.getUserId();
        Map<String, Object> ord = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'OrderNumber' => 'O-001',
            'TotalAmount' => 110000,
            'SBQQ__Quote__c' => quoteId,
            'SBQQ__Quote__r' => new Map<String, Object>{
                'Id' => quoteId,
                'Name' => 'Q-001',
                'SBQQ__NetAmount__c' => 100000,
                'SBQQ__Type__c' => 'Amendment',  // belongs to ORD-003
                'SBQQ__Account__c' => UserInfo.getOrganizationId()
            }
        };
        CurrencyContext.addToTestMap(ord, 'USD');
        ORD002QuoteOrderVarianceDetector.testStubOrders = new List<Map<String, Object>>{ ord };
        ORD002QuoteOrderVarianceDetector d = new ORD002QuoteOrderVarianceDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        ORD002QuoteOrderVarianceDetector.testStubOrders = null;
        System.assertEquals(0, r.size(), 'Amendment quotes skipped here');
    }

    @isTest static void ord002_runWithoutStubs_drivesSoqlPath() {
        ORD002QuoteOrderVarianceDetector d = new ORD002QuoteOrderVarianceDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    // ─── ORD-FOR-003: amendment Q↔O variance ─────────────────────────

    private static Map<String, Object> ord003Row(Decimal quoteNet, Decimal orderTotal) {
        return new Map<String, Object>{
            'quoteId' => UserInfo.getUserId(),
            'quoteName' => 'AQ-001',
            'quoteNetAmount' => quoteNet,
            'orderTotal' => orderTotal,
            'orderIds' => new List<Id>{ UserInfo.getUserId() },
            'orderNumbers' => new List<String>{ 'O-001' },
            'accountId' => UserInfo.getOrganizationId(),
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void ord003_largeDelta_critical() {
        DetectorResult r = ORD003AmendmentVarianceDetector.evaluateRow(ord003Row(100000, 200000));
        System.assertEquals('Critical', r.severity);
        System.assert(r.title.contains('Amendment'));
    }

    @isTest static void ord003_mediumDelta_warning() {
        DetectorResult r = ORD003AmendmentVarianceDetector.evaluateRow(ord003Row(100000, 110000));
        System.assertEquals('Warning', r.severity);
    }

    @isTest static void ord003_smallDelta_info() {
        DetectorResult r = ORD003AmendmentVarianceDetector.evaluateRow(ord003Row(100, 200));
        System.assertEquals('Info', r.severity);
    }

    @isTest static void ord003_withinTolerance_skips() {
        System.assertEquals(null, ORD003AmendmentVarianceDetector.evaluateRow(ord003Row(100, 100.005)));
    }

    @isTest static void ord003_handlesNullQuoteId() {
        Map<String, Object> row = ord003Row(100, 200);
        row.put('quoteId', null);
        System.assertEquals(null, ORD003AmendmentVarianceDetector.evaluateRow(row));
    }

    @isTest static void ord003_runWithStubRows() {
        ORD003AmendmentVarianceDetector.testStubRows = new List<Map<String, Object>>{
            ord003Row(100000, 200000)
        };
        ORD003AmendmentVarianceDetector d = new ORD003AmendmentVarianceDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        ORD003AmendmentVarianceDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void ord003_runWithStubOrders_drivesFullPipeline() {
        Id quoteId = UserInfo.getUserId();
        Map<String, Object> ord = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'OrderNumber' => 'O-001',
            'TotalAmount' => 110000,
            'SBQQ__Quote__c' => quoteId,
            'SBQQ__Quote__r' => new Map<String, Object>{
                'Id' => quoteId,
                'Name' => 'AQ-001',
                'SBQQ__NetAmount__c' => 100000,
                'SBQQ__Type__c' => 'Amendment',
                'SBQQ__Account__c' => UserInfo.getOrganizationId()
            }
        };
        CurrencyContext.addToTestMap(ord, 'USD');
        ORD003AmendmentVarianceDetector.testStubOrders = new List<Map<String, Object>>{ ord };
        ORD003AmendmentVarianceDetector d = new ORD003AmendmentVarianceDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        ORD003AmendmentVarianceDetector.testStubOrders = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void ord003_newBusinessType_skips() {
        Id quoteId = UserInfo.getUserId();
        Map<String, Object> ord = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'OrderNumber' => 'O-001',
            'TotalAmount' => 110000,
            'SBQQ__Quote__c' => quoteId,
            'SBQQ__Quote__r' => new Map<String, Object>{
                'Id' => quoteId,
                'Name' => 'Q-001',
                'SBQQ__NetAmount__c' => 100000,
                'SBQQ__Type__c' => 'Quote'  // new biz — skipped by amendment detector
            }
        };
        CurrencyContext.addToTestMap(ord, 'USD');
        ORD003AmendmentVarianceDetector.testStubOrders = new List<Map<String, Object>>{ ord };
        ORD003AmendmentVarianceDetector d = new ORD003AmendmentVarianceDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        ORD003AmendmentVarianceDetector.testStubOrders = null;
        System.assertEquals(0, r.size());
    }

    @isTest static void ord003_runWithoutStubs_drivesSoqlPath() {
        ORD003AmendmentVarianceDetector d = new ORD003AmendmentVarianceDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }
}
