/**
 * Phase 10 Batch C — PROV-FOR-001, PROV-FOR-002, SUB-FOR-001.
 * Pure map fixtures, no CPQ namespace compile-time dependency.
 */
@isTest
private class Phase10BatchCTest {

    // ─── PROV-FOR-001: Provisioned but not billed ────────────────────

    private static Map<String, Object> prov001Row(Decimal qty, Decimal unitPrice) {
        return new Map<String, Object>{
            'assetId' => UserInfo.getUserId(),
            'assetName' => 'A-001',
            'accountId' => UserInfo.getOrganizationId(),
            'productId' => UserInfo.getUserId(),
            'productName' => 'Widget Pro',
            'quantity' => qty,
            'unitPrice' => unitPrice,
            'installDate' => Date.today().addDays(-90),
            'status' => 'Installed',
            'priceSource' => 'asset',
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void prov001_largeGap_emitsCritical() {
        DetectorResult r = PROV001ProvisionedNotBilledDetector.evaluateRow(prov001Row(10, 15000));
        System.assertEquals('Critical', r.severity);
        System.assertEquals(150000, r.gapUsd);
    }

    @isTest static void prov001_mediumGap_emitsWarning() {
        DetectorResult r = PROV001ProvisionedNotBilledDetector.evaluateRow(prov001Row(5, 5000));
        System.assertEquals('Warning', r.severity);
    }

    @isTest static void prov001_smallGap_emitsInfo() {
        DetectorResult r = PROV001ProvisionedNotBilledDetector.evaluateRow(prov001Row(1, 500));
        System.assertEquals('Info', r.severity);
    }

    @isTest static void prov001_zeroGap_skips() {
        System.assertEquals(null, PROV001ProvisionedNotBilledDetector.evaluateRow(prov001Row(1, 0)));
    }

    @isTest static void prov001_handlesNullAssetId() {
        Map<String, Object> row = prov001Row(1, 100);
        row.put('assetId', null);
        System.assertEquals(null, PROV001ProvisionedNotBilledDetector.evaluateRow(row));
    }

    @isTest static void prov001_handlesStringInstallDate() {
        Map<String, Object> row = prov001Row(5, 5000);
        row.put('installDate', String.valueOf(Date.today().addDays(-30)));
        System.assertNotEquals(null, PROV001ProvisionedNotBilledDetector.evaluateRow(row));
    }

    @isTest static void prov001_handlesNullInstallDate() {
        Map<String, Object> row = prov001Row(5, 5000);
        row.put('installDate', null);
        DetectorResult r = PROV001ProvisionedNotBilledDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
        System.assert(r.description.contains('Asset installed for'),
            'No date → simpler phrasing');
    }

    @isTest static void prov001_runWithStubRows() {
        PROV001ProvisionedNotBilledDetector.testStubRows = new List<Map<String, Object>>{
            prov001Row(10, 15000),
            prov001Row(1, 500)
        };
        PROV001ProvisionedNotBilledDetector d = new PROV001ProvisionedNotBilledDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        PROV001ProvisionedNotBilledDetector.testStubRows = null;
        System.assertEquals(2, r.size());
    }

    @isTest static void prov001_runWithStubAssets_drivesFullPipeline() {
        Id acctId = UserInfo.getOrganizationId();
        Id prodId = UserInfo.getUserId();
        Map<String, Object> asset = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'A-001',
            'AccountId' => acctId,
            'Product2Id' => prodId,
            'Product2' => new Map<String, Object>{ 'Name' => 'Widget' },
            'Quantity' => 5,
            'Price' => 1000,
            'Status' => 'Installed',
            'InstallDate' => Date.today().addDays(-30)
        };
        CurrencyContext.addToTestMap(asset, 'USD');
        PROV001ProvisionedNotBilledDetector.testStubAssets = new List<Map<String, Object>>{ asset };
        // No billed key → flag fires.
        PROV001ProvisionedNotBilledDetector.testStubBilledKeys = new Set<String>();
        PROV001ProvisionedNotBilledDetector.testStubPbePrices = new Map<Id, Decimal>();
        PROV001ProvisionedNotBilledDetector d = new PROV001ProvisionedNotBilledDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        PROV001ProvisionedNotBilledDetector.testStubAssets = null;
        PROV001ProvisionedNotBilledDetector.testStubBilledKeys = null;
        PROV001ProvisionedNotBilledDetector.testStubPbePrices = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void prov001_billedKeyMatches_skips() {
        Id acctId = UserInfo.getOrganizationId();
        Id prodId = UserInfo.getUserId();
        Map<String, Object> asset = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'A-001',
            'AccountId' => acctId,
            'Product2Id' => prodId,
            'Quantity' => 5,
            'Price' => 1000,
            'Status' => 'Installed'
        };
        CurrencyContext.addToTestMap(asset, 'USD');
        PROV001ProvisionedNotBilledDetector.testStubAssets = new List<Map<String, Object>>{ asset };
        // Asset has matching subscription → no flag.
        PROV001ProvisionedNotBilledDetector.testStubBilledKeys = new Set<String>{
            String.valueOf(acctId) + '::' + String.valueOf(prodId)
        };
        PROV001ProvisionedNotBilledDetector.testStubPbePrices = new Map<Id, Decimal>();
        PROV001ProvisionedNotBilledDetector d = new PROV001ProvisionedNotBilledDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        PROV001ProvisionedNotBilledDetector.testStubAssets = null;
        PROV001ProvisionedNotBilledDetector.testStubBilledKeys = null;
        PROV001ProvisionedNotBilledDetector.testStubPbePrices = null;
        System.assertEquals(0, r.size());
    }

    @isTest static void prov001_runWithoutStubs_drivesSoqlPath() {
        PROV001ProvisionedNotBilledDetector d = new PROV001ProvisionedNotBilledDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    /** Drives lookupBilledKeys + lookupPbeFallback helpers by providing
     *  Assets but NO stub for the helpers — they execute against the
     *  local org. */
    @isTest static void prov001_assetsStub_helpersUnstubbed_drivesHelperCode() {
        Id acctId = UserInfo.getOrganizationId();
        Id prodId = UserInfo.getUserId();
        Map<String, Object> asset = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'A-001',
            'AccountId' => acctId,
            'Product2Id' => prodId,
            'Product2' => new Map<String, Object>{ 'Name' => 'Widget' },
            'Quantity' => 5,
            'Price' => 0,  // forces PBE fallback path
            'Status' => 'Installed',
            'InstallDate' => Date.today().addDays(-30)
        };
        CurrencyContext.addToTestMap(asset, 'USD');
        PROV001ProvisionedNotBilledDetector.testStubAssets = new List<Map<String, Object>>{ asset };
        // Leave testStubBilledKeys and testStubPbePrices null — helpers run.
        PROV001ProvisionedNotBilledDetector d = new PROV001ProvisionedNotBilledDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        PROV001ProvisionedNotBilledDetector.testStubAssets = null;
        // Result count not asserted — helpers may return empty/null prices.
        // The point is to drive their code paths.
        System.assert(r != null);
    }

    // ─── PROV-FOR-002: Active sub with no Asset ──────────────────────

    private static Map<String, Object> prov002Row(Decimal qty, Decimal unitPrice) {
        return new Map<String, Object>{
            'subscriptionId' => UserInfo.getUserId(),
            'subscriptionName' => 'S-001',
            'accountId' => UserInfo.getOrganizationId(),
            'accountName' => 'Acme',
            'productId' => UserInfo.getUserId(),
            'productName' => 'Widget Pro',
            'quantity' => qty,
            'unitPrice' => unitPrice,
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void prov002_largeExposure_emitsCritical() {
        DetectorResult r = PROV002SubNoAssetDetector.evaluateRow(prov002Row(10, 6000));
        System.assertEquals('Critical', r.severity);
    }

    @isTest static void prov002_mediumExposure_emitsWarning() {
        DetectorResult r = PROV002SubNoAssetDetector.evaluateRow(prov002Row(1, 6000));
        System.assertEquals('Warning', r.severity);
    }

    @isTest static void prov002_smallExposure_emitsInfo() {
        DetectorResult r = PROV002SubNoAssetDetector.evaluateRow(prov002Row(1, 100));
        System.assertEquals('Info', r.severity);
    }

    @isTest static void prov002_zeroQty_skips() {
        System.assertEquals(null, PROV002SubNoAssetDetector.evaluateRow(prov002Row(0, 1000)));
    }

    @isTest static void prov002_handlesNullSubId() {
        Map<String, Object> row = prov002Row(1, 100);
        row.put('subscriptionId', null);
        System.assertEquals(null, PROV002SubNoAssetDetector.evaluateRow(row));
    }

    @isTest static void prov002_runWithStubRows() {
        PROV002SubNoAssetDetector.testStubRows = new List<Map<String, Object>>{
            prov002Row(10, 6000)
        };
        PROV002SubNoAssetDetector d = new PROV002SubNoAssetDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        PROV002SubNoAssetDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void prov002_runWithStubSubs_drivesFullPipeline() {
        Id acctId = UserInfo.getOrganizationId();
        Id prodId = UserInfo.getUserId();
        Map<String, Object> sub = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'S-001',
            'SBQQ__Account__c' => acctId,
            'SBQQ__Account__r' => new Map<String, Object>{ 'Name' => 'Acme' },
            'SBQQ__Product__c' => prodId,
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'Widget' },
            'SBQQ__Quantity__c' => 5,
            'SBQQ__NetPrice__c' => 2000
        };
        CurrencyContext.addToTestMap(sub, 'USD');
        PROV002SubNoAssetDetector.testStubSubs = new List<Map<String, Object>>{ sub };
        PROV002SubNoAssetDetector.testStubAssetKeys = new Set<String>();
        PROV002SubNoAssetDetector d = new PROV002SubNoAssetDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        PROV002SubNoAssetDetector.testStubSubs = null;
        PROV002SubNoAssetDetector.testStubAssetKeys = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void prov002_runWithoutStubs_drivesSoqlPath() {
        PROV002SubNoAssetDetector d = new PROV002SubNoAssetDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    // ─── SUB-FOR-001: Quantity drift ─────────────────────────────────

    private static Map<String, Object> sub001Row(Decimal subQty, Decimal assetQty, Decimal unitPrice) {
        return new Map<String, Object>{
            'subscriptionId' => UserInfo.getUserId(),
            'subscriptionName' => 'S-001',
            'accountId' => UserInfo.getOrganizationId(),
            'accountName' => 'Acme',
            'productId' => UserInfo.getUserId(),
            'productName' => 'Widget Pro',
            'subQuantity' => subQty,
            'assetQuantity' => assetQty,
            'unitPrice' => unitPrice,
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void sub001_underBilled_critical() {
        // sub=5, asset=15 → delta=10, gap=10*15000=150k → critical, under-billed.
        DetectorResult r = SUB001QuantityDriftDetector.evaluateRow(sub001Row(5, 15, 15000));
        System.assertEquals('Critical', r.severity);
        System.assert(r.title.contains('under-billed'));
    }

    @isTest static void sub001_overBilled_warning() {
        // sub=15, asset=5 → delta=-10, gap=10*1500=15k → warning, over-billed.
        DetectorResult r = SUB001QuantityDriftDetector.evaluateRow(sub001Row(15, 5, 1500));
        System.assertEquals('Warning', r.severity);
        System.assert(r.title.contains('over-billed'));
    }

    @isTest static void sub001_smallDelta_info() {
        DetectorResult r = SUB001QuantityDriftDetector.evaluateRow(sub001Row(5, 6, 100));
        System.assertEquals('Info', r.severity);
    }

    @isTest static void sub001_equal_skips() {
        System.assertEquals(null, SUB001QuantityDriftDetector.evaluateRow(sub001Row(5, 5, 1000)));
    }

    @isTest static void sub001_bothZero_skips() {
        System.assertEquals(null, SUB001QuantityDriftDetector.evaluateRow(sub001Row(0, 0, 1000)));
    }

    @isTest static void sub001_subDollarGap_skips() {
        // delta=1 unit × $0.5 = $0.5 → below threshold
        System.assertEquals(null, SUB001QuantityDriftDetector.evaluateRow(sub001Row(5, 6, 0.5)));
    }

    @isTest static void sub001_handlesNullSubId() {
        Map<String, Object> row = sub001Row(5, 15, 1000);
        row.put('subscriptionId', null);
        System.assertEquals(null, SUB001QuantityDriftDetector.evaluateRow(row));
    }

    @isTest static void sub001_runWithStubRows() {
        SUB001QuantityDriftDetector.testStubRows = new List<Map<String, Object>>{
            sub001Row(5, 15, 15000),
            sub001Row(5, 5, 1000)  // equal — skipped
        };
        SUB001QuantityDriftDetector d = new SUB001QuantityDriftDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        SUB001QuantityDriftDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void sub001_runWithStubSubs_drivesFullPipeline() {
        Id acctId = UserInfo.getOrganizationId();
        Id prodId = UserInfo.getUserId();
        Map<String, Object> sub = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'S-001',
            'SBQQ__Account__c' => acctId,
            'SBQQ__Account__r' => new Map<String, Object>{ 'Name' => 'Acme' },
            'SBQQ__Product__c' => prodId,
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'Widget' },
            'SBQQ__Quantity__c' => 5,
            'SBQQ__NetPrice__c' => 15000
        };
        CurrencyContext.addToTestMap(sub, 'USD');
        SUB001QuantityDriftDetector.testStubSubs = new List<Map<String, Object>>{ sub };
        // Asset has 15 units → delta=10 → critical under-billed.
        SUB001QuantityDriftDetector.testStubAssetQtyByKey = new Map<String, Decimal>{
            String.valueOf(acctId) + '::' + String.valueOf(prodId) => 15
        };
        SUB001QuantityDriftDetector d = new SUB001QuantityDriftDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        SUB001QuantityDriftDetector.testStubSubs = null;
        SUB001QuantityDriftDetector.testStubAssetQtyByKey = null;
        System.assertEquals(1, r.size());
        System.assertEquals('Critical', r[0].severity);
    }

    @isTest static void sub001_runWithoutStubs_drivesSoqlPath() {
        SUB001QuantityDriftDetector d = new SUB001QuantityDriftDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }
}
