/**
 * Phase 10 Batch E — AST-FOR-001, QL-FOR-002.
 * Pure map fixtures, no CPQ namespace compile-time dependency.
 */
@isTest
private class Phase10BatchETest {

    // ─── AST-FOR-001: Terminated asset, no credit memo ───────────────

    private static Map<String, Object> ast001Row(Decimal netPrice, Decimal qty) {
        return new Map<String, Object>{
            'assetId' => UserInfo.getUserId(),
            'assetName' => 'A-001',
            'accountId' => UserInfo.getOrganizationId(),
            'productId' => UserInfo.getUserId(),
            'productName' => 'Widget',
            'assetStatus' => 'Terminated',
            'terminatedDate' => Date.today().addDays(-60),
            'subscriptionId' => UserInfo.getUserId(),
            'subNetPrice' => netPrice,
            'subQuantity' => qty,
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void ast001_largeExposure_critical() {
        DetectorResult r = AST001TerminatedNoCreditDetector.evaluateRow(ast001Row(60000, 1));
        System.assertEquals('Critical', r.severity);
    }

    @isTest static void ast001_medium_warning() {
        DetectorResult r = AST001TerminatedNoCreditDetector.evaluateRow(ast001Row(6000, 1));
        System.assertEquals('Warning', r.severity);
    }

    @isTest static void ast001_small_info() {
        DetectorResult r = AST001TerminatedNoCreditDetector.evaluateRow(ast001Row(500, 1));
        System.assertEquals('Info', r.severity);
    }

    @isTest static void ast001_zero_skips() {
        System.assertEquals(null, AST001TerminatedNoCreditDetector.evaluateRow(ast001Row(0, 0)));
    }

    @isTest static void ast001_nullAssetId_skips() {
        Map<String, Object> row = ast001Row(60000, 1);
        row.put('assetId', null);
        System.assertEquals(null, AST001TerminatedNoCreditDetector.evaluateRow(row));
    }

    @isTest static void ast001_handlesNullTerminatedDate() {
        Map<String, Object> row = ast001Row(60000, 1);
        row.put('terminatedDate', null);
        DetectorResult r = AST001TerminatedNoCreditDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
    }

    @isTest static void ast001_runWithStubRows() {
        AST001TerminatedNoCreditDetector.testStubRows = new List<Map<String, Object>>{
            ast001Row(60000, 1)
        };
        AST001TerminatedNoCreditDetector d = new AST001TerminatedNoCreditDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        AST001TerminatedNoCreditDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void ast001_runWithStubAssets_drivesFullPipeline() {
        Id acctId = UserInfo.getOrganizationId();
        Id prodId = UserInfo.getUserId();
        Map<String, Object> asset = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'A-001',
            'AccountId' => acctId,
            'Product2Id' => prodId,
            'Product2' => new Map<String, Object>{ 'Name' => 'Widget' },
            'Status' => 'Terminated',
            'UsageEndDate' => Date.today().addDays(-30)
        };
        CurrencyContext.addToTestMap(asset, 'USD');
        AST001TerminatedNoCreditDetector.testStubAssets = new List<Map<String, Object>>{ asset };
        AST001TerminatedNoCreditDetector.testStubSubsByKey = new Map<String, Map<String, Object>>{
            String.valueOf(acctId) + '::' + String.valueOf(prodId) => new Map<String, Object>{
                'Id' => UserInfo.getUserId(),
                'SBQQ__NetPrice__c' => 60000,
                'SBQQ__Quantity__c' => 1
            }
        };
        AST001TerminatedNoCreditDetector.testStubAccountsWithCreditMemo = new Set<Id>();
        AST001TerminatedNoCreditDetector d = new AST001TerminatedNoCreditDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        AST001TerminatedNoCreditDetector.testStubAssets = null;
        AST001TerminatedNoCreditDetector.testStubSubsByKey = null;
        AST001TerminatedNoCreditDetector.testStubAccountsWithCreditMemo = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void ast001_creditMemoExists_skips() {
        Id acctId = UserInfo.getOrganizationId();
        Id prodId = UserInfo.getUserId();
        Map<String, Object> asset = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'AccountId' => acctId,
            'Product2Id' => prodId,
            'Status' => 'Terminated'
        };
        CurrencyContext.addToTestMap(asset, 'USD');
        AST001TerminatedNoCreditDetector.testStubAssets = new List<Map<String, Object>>{ asset };
        AST001TerminatedNoCreditDetector.testStubSubsByKey = new Map<String, Map<String, Object>>{
            String.valueOf(acctId) + '::' + String.valueOf(prodId) => new Map<String, Object>{
                'Id' => UserInfo.getUserId(),
                'SBQQ__NetPrice__c' => 60000,
                'SBQQ__Quantity__c' => 1
            }
        };
        // Credit memo exists → no flag.
        AST001TerminatedNoCreditDetector.testStubAccountsWithCreditMemo = new Set<Id>{ acctId };
        AST001TerminatedNoCreditDetector d = new AST001TerminatedNoCreditDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        AST001TerminatedNoCreditDetector.testStubAssets = null;
        AST001TerminatedNoCreditDetector.testStubSubsByKey = null;
        AST001TerminatedNoCreditDetector.testStubAccountsWithCreditMemo = null;
        System.assertEquals(0, r.size());
    }

    @isTest static void ast001_runWithoutStubs_drivesSoqlPath() {
        AST001TerminatedNoCreditDetector d = new AST001TerminatedNoCreditDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    @isTest static void ast001_assetsStub_helpersUnstubbed_drivesHelperCode() {
        Map<String, Object> asset = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'AccountId' => UserInfo.getOrganizationId(),
            'Product2Id' => UserInfo.getUserId(),
            'Status' => 'Terminated'
        };
        CurrencyContext.addToTestMap(asset, 'USD');
        AST001TerminatedNoCreditDetector.testStubAssets = new List<Map<String, Object>>{ asset };
        // Helpers run against local org.
        AST001TerminatedNoCreditDetector d = new AST001TerminatedNoCreditDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        AST001TerminatedNoCreditDetector.testStubAssets = null;
        System.assert(r != null);
    }

    // ─── QL-FOR-002: Approval skipped ────────────────────────────────

    private static Map<String, Object> ql002Row(Decimal discount, Decimal threshold) {
        return new Map<String, Object>{
            'lineId' => UserInfo.getUserId(),
            'lineName' => 'QL-001',
            'quoteId' => UserInfo.getUserId(),
            'quoteName' => 'Q-001',
            'accountName' => 'Acme',
            'productId' => UserInfo.getUserId(),
            'productName' => 'Widget',
            'discount' => discount,
            'threshold' => threshold,
            'listPrice' => 100,
            'netPrice' => 100 - discount,
            'qty' => 1,
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void ql002_highDiscount_critical() {
        DetectorResult r = QL002ApprovalSkippedDetector.evaluateRow(ql002Row(60, 20));
        System.assertEquals('Critical', r.severity);
        System.assertEquals(0, r.gapUsd, 'governance — no $ claim');
    }

    @isTest static void ql002_mediumDiscount_warning() {
        DetectorResult r = QL002ApprovalSkippedDetector.evaluateRow(ql002Row(30, 20));
        System.assertEquals('Warning', r.severity);
    }

    @isTest static void ql002_belowThreshold_skips() {
        System.assertEquals(null, QL002ApprovalSkippedDetector.evaluateRow(ql002Row(10, 20)));
    }

    @isTest static void ql002_handlesNullLineId() {
        Map<String, Object> row = ql002Row(60, 20);
        row.put('lineId', null);
        System.assertEquals(null, QL002ApprovalSkippedDetector.evaluateRow(row));
    }

    @isTest static void ql002_runWithStubRows() {
        QL002ApprovalSkippedDetector.testStubRows = new List<Map<String, Object>>{
            ql002Row(60, 20),
            ql002Row(10, 20)
        };
        QL002ApprovalSkippedDetector d = new QL002ApprovalSkippedDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        QL002ApprovalSkippedDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void ql002_runWithStubLines_drivesFullPipeline() {
        QL002ApprovalSkippedDetector.testStubMinThreshold = 20;
        Map<String, Object> line = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'QL-001',
            'SBQQ__Quote__c' => UserInfo.getUserId(),
            'SBQQ__Discount__c' => 60,
            'SBQQ__ListPrice__c' => 100,
            'SBQQ__NetPrice__c' => 40,
            'SBQQ__Quantity__c' => 1
        };
        CurrencyContext.addToTestMap(line, 'USD');
        QL002ApprovalSkippedDetector.testStubLines = new List<Map<String, Object>>{ line };
        QL002ApprovalSkippedDetector.testStubApprovedLineIds = new Set<Id>();
        QL002ApprovalSkippedDetector d = new QL002ApprovalSkippedDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        QL002ApprovalSkippedDetector.testStubMinThreshold = null;
        QL002ApprovalSkippedDetector.testStubLines = null;
        QL002ApprovalSkippedDetector.testStubApprovedLineIds = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void ql002_approvalExists_skips() {
        Id lineId = UserInfo.getUserId();
        QL002ApprovalSkippedDetector.testStubMinThreshold = 20;
        Map<String, Object> line = new Map<String, Object>{
            'Id' => lineId,
            'Name' => 'QL-001',
            'SBQQ__Discount__c' => 60,
            'SBQQ__NetPrice__c' => 40,
            'SBQQ__Quantity__c' => 1
        };
        CurrencyContext.addToTestMap(line, 'USD');
        QL002ApprovalSkippedDetector.testStubLines = new List<Map<String, Object>>{ line };
        QL002ApprovalSkippedDetector.testStubApprovedLineIds = new Set<Id>{ lineId };
        QL002ApprovalSkippedDetector d = new QL002ApprovalSkippedDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        QL002ApprovalSkippedDetector.testStubMinThreshold = null;
        QL002ApprovalSkippedDetector.testStubLines = null;
        QL002ApprovalSkippedDetector.testStubApprovedLineIds = null;
        System.assertEquals(0, r.size());
    }

    @isTest static void ql002_runWithoutStubs_drivesSoqlPath() {
        QL002ApprovalSkippedDetector d = new QL002ApprovalSkippedDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    @isTest static void ql002_thresholdStub_linesUnstubbed_drivesHelpers() {
        // Threshold set so we skip findMinThreshold helper, but lines
        // are not stubbed → SOQL runs (may return 0 rows in test) and
        // approval lookup helper runs.
        QL002ApprovalSkippedDetector.testStubMinThreshold = 20;
        QL002ApprovalSkippedDetector d = new QL002ApprovalSkippedDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        QL002ApprovalSkippedDetector.testStubMinThreshold = null;
        System.assert(r != null);
    }
}
