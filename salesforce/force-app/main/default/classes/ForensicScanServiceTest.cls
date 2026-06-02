/**
 * Tests the orchestrator end-to-end. Without CPQ data in the org,
 * all detectors return 0 findings — we assert the scan completes
 * cleanly with status='Completed' and 0 leakage.
 *
 * The shape coverage exercises every line of ForensicScanService +
 * the DTO classes (DetectorResult, DetectorContext, SourceRecord).
 */
@isTest
private class ForensicScanServiceTest {

    @isTest
    static void startScan_completesWithZeroFindings_whenNoCpqData() {
        Test.startTest();
        Id scanId = ForensicScanService.startScan('CPQ');
        Test.stopTest();

        ForensicScan__c scan = [
            SELECT Status__c, FindingCount__c, TotalLeakageUsd__c, CompletedAt__c
            FROM ForensicScan__c
            WHERE Id = :scanId
        ];
        System.assertEquals('Completed', scan.Status__c, 'Status should be Completed when no detectors error');
        System.assertEquals(0, scan.FindingCount__c, 'No findings expected without CPQ data');
        System.assertEquals(0, scan.TotalLeakageUsd__c, 'Total leakage should be zero');
        System.assertNotEquals(null, scan.CompletedAt__c, 'CompletedAt should be set');
    }

    @isTest
    static void startScan_acceptsAllProductTypes() {
        Test.startTest();
        Id cpqScan = ForensicScanService.startScan('CPQ');
        Id billingScan = ForensicScanService.startScan('CPQ+Billing');
        Id armScan = ForensicScanService.startScan('ARM');
        Test.stopTest();

        // Each scan should exist with the expected product type.
        Map<Id, ForensicScan__c> scans = new Map<Id, ForensicScan__c>([
            SELECT ProductType__c FROM ForensicScan__c
            WHERE Id IN (:cpqScan, :billingScan, :armScan)
        ]);
        System.assertEquals(3, scans.size());
        System.assertEquals('CPQ', scans.get(cpqScan).ProductType__c);
        System.assertEquals('CPQ+Billing', scans.get(billingScan).ProductType__c);
        System.assertEquals('ARM', scans.get(armScan).ProductType__c);
    }

    @isTest
    static void detectorContext_storesAndRetrievesSnapshots() {
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');

        // Empty before populate
        System.assertEquals(false, ctx.hasSnapshot('Order'));
        System.assertEquals(null, ctx.getSnapshot('Order'));

        // Populate
        List<SObject> orders = new List<SObject>{ new Order() };
        ctx.putSnapshot('Order', orders);

        System.assertEquals(true, ctx.hasSnapshot('Order'));
        System.assertEquals(1, ctx.getSnapshot('Order').size());
        System.assertEquals('USD', ctx.defaultCurrency);
        System.assertEquals('CPQ', ctx.productType);
    }

    @isTest
    static void detectorContext_defaultsCurrencyWhenNull() {
        DetectorContext ctx = new DetectorContext(null, null, 'CPQ');
        System.assertEquals('USD', ctx.defaultCurrency, 'Should default to USD when null passed');
    }

    @isTest
    static void detectorResult_computeGap_handlesNulls() {
        DetectorResult r = new DetectorResult();
        r.entitledUsd = 1000;
        r.realizedUsd = 400;
        r.computeGap();
        System.assertEquals(600, r.gapUsd);

        // Null entitled
        DetectorResult r2 = new DetectorResult();
        r2.realizedUsd = 500;
        r2.computeGap();
        System.assertEquals(-500, r2.gapUsd);

        // Both null
        DetectorResult r3 = new DetectorResult();
        r3.computeGap();
        System.assertEquals(0, r3.gapUsd);
    }

    @isTest
    static void sourceRecord_buildsWithFinancials() {
        SourceRecord sr = new SourceRecord('Order', UserInfo.getUserId(), 'O-001')
            .withFinancial('total', 50000)
            .withFinancial('status', 'Activated');
        System.assertEquals('Order', sr.sObjectType);
        System.assertEquals('O-001', sr.name);
        System.assertEquals(50000, sr.financials.get('total'));
        System.assertEquals('Activated', sr.financials.get('status'));
    }
}
