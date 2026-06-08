@isTest
private class QL001RefactorTest {

    @isTest
    static void run_withStubRows_returnsFinding() {
        QL001BundleZeroPriceDetector.testStubRows = new List<Map<String, Object>>{
            new Map<String, Object>{
                'lineId' => '01tNS0000000001AAA',
                'lineName' => 'TestLine',
                'listPrice' => 100,
                'qty' => 10,
                'quoteName' => 'Q-Test',
                'productName' => 'Test Product',
                'currencyIsoCode' => 'USD'
            }
        };
        Test.startTest();
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ', null, null);
        List<DetectorResult> r = new QL001BundleZeroPriceDetector().run(ctx);
        Test.stopTest();
        System.assertEquals(1, r.size(), 'one stub row → one finding');
        System.assertEquals('QL-FOR-001', r[0].detectorId);
        System.assertEquals(1000, r[0].entitledUsd);
    }

    @isTest
    static void run_withoutStubs_localScan_handlesAbsentField() {
        // No stub rows; runs against host schema. SBQQ__Required__c is the
        // primary predicate — if it's absent, detector should NOT throw.
        Test.startTest();
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ', null, null);
        List<DetectorResult> r = new QL001BundleZeroPriceDetector().run(ctx);
        Test.stopTest();
        System.assertNotEquals(null, r);
        // Either 0 (host has no CPQ data / fields absent) or some matching
        // — both are valid; we just want no exception.
    }

    @isTest
    static void evaluateRow_zeroPriceListZero_returnsNull() {
        Map<String, Object> row = new Map<String, Object>{
            'lineId' => '01tNS0000000001AAA',
            'listPrice' => 0,
            'qty' => 10
        };
        System.assertEquals(null, QL001BundleZeroPriceDetector.evaluateRow(row),
            'List $0 → no finding');
    }

    @isTest
    static void unwrap_extractsNestedRelationshipNames() {
        Map<String, Object> raw = new Map<String, Object>{
            'Id' => '01tNS0000000001AAA', 'Name' => 'L1',
            'SBQQ__ListPrice__c' => 100, 'SBQQ__Quantity__c' => 5,
            'SBQQ__Quote__r' => new Map<String, Object>{ 'Name' => 'Q-Quote' },
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'P-Product' }
        };
        Map<String, Object> u = QL001BundleZeroPriceDetector.unwrap(raw);
        System.assertEquals('Q-Quote', u.get('quoteName'));
        System.assertEquals('P-Product', u.get('productName'));
        System.assertEquals(100, u.get('listPrice'));
    }

    @isTest
    static void unwrap_nullInput_returnsEmpty() {
        Map<String, Object> u = QL001BundleZeroPriceDetector.unwrap(null);
        System.assertNotEquals(null, u);
        System.assertEquals(0, u.size());
    }

    @isTest
    static void evaluateRow_smallExpected_returnsNull() {
        Map<String, Object> row = new Map<String, Object>{
            'lineId' => '01tNS0000000001AAA',
            'listPrice' => 0.1,
            'qty' => 1
        };
        System.assertEquals(null, QL001BundleZeroPriceDetector.evaluateRow(row),
            'Expected ≤ $1 → noise; skip');
    }
}
