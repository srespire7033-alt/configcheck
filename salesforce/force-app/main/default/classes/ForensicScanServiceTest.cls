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
    static void suppressionFilter_skipsMatchingPair() {
        // SourceRecord needs a valid Id — use the running user's Id as a stand-in.
        Id matchId = UserInfo.getUserId();
        Id otherId = UserInfo.getOrganizationId();
        insert new ForensicSuppression__c(
            DetectorId__c = 'REN-001',
            PrimaryRecordId__c = (String) matchId,
            Reason__c = 'False Positive'
        );

        Test.startTest();
        Set<String> keys = ForensicScanService.loadSuppressionKeys();

        DetectorResult matching = new DetectorResult();
        matching.detectorId = 'REN-001';
        matching.primaryRecord = new SourceRecord('User', matchId, 'matching user');

        DetectorResult different = new DetectorResult();
        different.detectorId = 'REN-001';
        different.primaryRecord = new SourceRecord('Organization', otherId, 'other');

        DetectorResult nullRec = new DetectorResult();
        nullRec.detectorId = 'REN-001';

        Boolean a = ForensicScanService.isSuppressed(keys, matching);
        Boolean b = ForensicScanService.isSuppressed(keys, different);
        Boolean c = ForensicScanService.isSuppressed(keys, nullRec);
        Boolean d = ForensicScanService.isSuppressed(new Set<String>(), matching);
        Test.stopTest();

        System.assertEquals(true, a, 'Matching pair should be suppressed');
        System.assertEquals(false, b, 'Same detector, different record → not suppressed');
        System.assertEquals(false, c, 'Null primary record → not suppressed');
        System.assertEquals(false, d, 'Empty suppression set short-circuits to false');
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

    /**
     * End-to-end: inject stub rows into REN001 so the orchestrator
     * actually emits findings, exercising the toFindingRecord +
     * persistence path that's normally only hit when CPQ data exists.
     */
    @isTest
    static void startScan_persistsFindings_whenDetectorEmitsResults() {
        REN001RenewalUpliftDetector.testStubRows = new List<Map<String, Object>>{
            new Map<String, Object>{
                'lineId' => UserInfo.getUserId(),
                'lineName' => 'QL-001',
                'netPrice' => 50000,
                'listPrice' => 100000,
                'originalPrice' => 100000,
                'upliftPct' => 20,
                'quoteName' => 'Q-001',
                'accountName' => 'Acme',
                'subscriptionId' => UserInfo.getUserId(),
                'currencyIsoCode' => 'USD'
            }
        };

        Test.startTest();
        Id scanId = ForensicScanService.startScan('CPQ');
        Test.stopTest();

        ForensicScan__c scan = [
            SELECT Status__c, FindingCount__c, TotalLeakageUsd__c
            FROM ForensicScan__c WHERE Id = :scanId
        ];
        System.assertEquals('Completed', scan.Status__c);
        System.assertEquals(1, scan.FindingCount__c, 'Should persist 1 finding');
        System.assert(scan.TotalLeakageUsd__c > 0, 'Should have leakage > 0');

        List<ForensicFinding__c> findings = [
            SELECT Id, DetectorId__c, Severity__c, GapUsd__c, Title__c,
                   PrimaryRecordType__c, PrimaryRecordId__c, SourceRecordRefs__c, Metadata__c
            FROM ForensicFinding__c WHERE ForensicScan__c = :scanId
        ];
        System.assertEquals(1, findings.size());
        System.assertEquals('REN-001', findings[0].DetectorId__c);
        System.assertEquals('Critical', findings[0].Severity__c);
        System.assertNotEquals(null, findings[0].SourceRecordRefs__c);
        System.assertNotEquals(null, findings[0].Metadata__c);
        System.assertEquals('SBQQ__QuoteLine__c', findings[0].PrimaryRecordType__c);

        REN001RenewalUpliftDetector.testStubRows = null;
    }

    @isTest
    static void toFindingRecord_serializesPrimaryAndMetadata() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Running', ProductType__c = 'CPQ', StartedAt__c = System.now()
        );
        insert scan;

        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'REN-001';
        dr.severity = 'Warning';
        dr.entitledUsd = 10000;
        dr.realizedUsd = 6000;
        dr.computeGap();
        dr.currencyIsoCode = 'USD';
        dr.recoverabilityScore = 0.75;
        dr.title = 'Test finding';
        dr.description = 'Test description';
        dr.primaryRecord = new SourceRecord('Account', UserInfo.getUserId(), 'Acme')
            .withFinancial('total', 1000);
        dr.metadata.put('source', 'test');

        ForensicFinding__c f = ForensicScanService.toFindingRecord(scan.Id, dr);
        System.assertEquals(scan.Id, f.ForensicScan__c);
        System.assertEquals('REN-001', f.DetectorId__c);
        System.assertEquals('Account', f.PrimaryRecordType__c);
        System.assertEquals('Open', f.Status__c);
        System.assertNotEquals(null, f.SourceRecordRefs__c);
        System.assert(f.SourceRecordRefs__c.contains('Acme'), 'Source refs should serialize primary record');
        System.assert(f.Metadata__c.contains('test'), 'Metadata should serialize');
    }

    @isTest
    static void toFindingRecord_handlesNullPrimary() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Running', ProductType__c = 'CPQ', StartedAt__c = System.now()
        );
        insert scan;
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'X-001';
        dr.severity = 'Info';
        dr.entitledUsd = 100;
        dr.realizedUsd = 50;
        dr.computeGap();
        dr.title = 't';
        dr.description = 'd';

        ForensicFinding__c f = ForensicScanService.toFindingRecord(scan.Id, dr);
        System.assertEquals(null, f.PrimaryRecordType__c);
        System.assertEquals(null, f.PrimaryRecordId__c);
    }

    @isTest
    static void primaryRecordAsMap_handlesNull() {
        Map<String, Object> result = ForensicScanService.primaryRecordAsMap(null);
        System.assertEquals(null, result);
    }

    @isTest
    static void primaryRecordAsMap_serializesAllFields() {
        SourceRecord sr = new SourceRecord('Order', UserInfo.getUserId(), 'O-1')
            .withFinancial('amount', 5000);
        Map<String, Object> m = ForensicScanService.primaryRecordAsMap(sr);
        System.assertEquals('Order', m.get('type'));
        System.assertEquals('O-1', m.get('name'));
        System.assertNotEquals(null, m.get('financials'));
    }

    @isTest
    static void supportingRecordsAsList_handlesNull() {
        List<Object> result = ForensicScanService.supportingRecordsAsList(null);
        System.assertEquals(0, result.size());
    }

    @isTest
    static void supportingRecordsAsList_serializesList() {
        List<SourceRecord> supporting = new List<SourceRecord>{
            new SourceRecord('Order', UserInfo.getUserId(), 'O-1'),
            new SourceRecord('Contract', UserInfo.getUserId(), 'C-1')
        };
        List<Object> result = ForensicScanService.supportingRecordsAsList(supporting);
        System.assertEquals(2, result.size());
    }

    // ───────────────────────────────────────────────────────────────
    // Phase 22L — chunked remote-scan path
    // ───────────────────────────────────────────────────────────────

    /** Detector stub that emits one canned result. Lets us hit
     *  runDetectorChunk's persist path without depending on real
     *  CPQ/ARM packages being installed. */
    public class StubDetector implements IDetector {
        private final String id;
        private final List<DetectorResult> results;
        public StubDetector(String id, List<DetectorResult> results) {
            this.id = id; this.results = results;
        }
        public String getDetectorId() { return id; }
        public String getLabel() { return id; }
        public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ' }; }
        public List<DetectorResult> run(DetectorContext ctx) { return results; }
    }

    /** Detector stub that throws — verifies per-detector try/catch +
     *  ErrorMessage__c accumulation across a chunk. */
    public class ThrowingDetector implements IDetector {
        public String getDetectorId() { return 'STUB-THROW'; }
        public String getLabel() { return 'throws'; }
        public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ' }; }
        public List<DetectorResult> run(DetectorContext ctx) {
            throw new System.NullPointerException();
        }
    }

    @isTest
    static void runDetectorChunk_emptyList_emitsNothing() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Running', StartedAt__c = System.now()
        );
        insert scan;
        DetectorContext ctx = new DetectorContext(scan.Id, 'USD', 'CPQ');

        Test.startTest();
        ForensicScanService.runDetectorChunk(scan.Id, ctx, new List<IDetector>());
        Test.stopTest();

        Integer findings = [SELECT COUNT() FROM ForensicFinding__c WHERE ForensicScan__c = :scan.Id];
        System.assertEquals(0, findings);
    }

    @isTest
    static void runDetectorChunk_persistsEmittedFinding() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Running', StartedAt__c = System.now()
        );
        insert scan;

        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'STUB-001';
        dr.severity = 'Warning';
        dr.gapUsd = 100;
        dr.title = 'stub';
        dr.description = 'stub-finding';

        DetectorContext ctx = new DetectorContext(scan.Id, 'USD', 'CPQ');
        Test.startTest();
        ForensicScanService.runDetectorChunk(scan.Id, ctx,
            new List<IDetector>{ new StubDetector('STUB-001', new List<DetectorResult>{ dr }) });
        Test.stopTest();

        List<ForensicFinding__c> findings = [
            SELECT DetectorId__c FROM ForensicFinding__c
            WHERE ForensicScan__c = :scan.Id
        ];
        System.assertEquals(1, findings.size());
        System.assertEquals('STUB-001', findings[0].DetectorId__c);
    }

    @isTest
    static void runDetectorChunk_swallowsDetectorErrorIntoScanField() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Running', StartedAt__c = System.now()
        );
        insert scan;
        DetectorContext ctx = new DetectorContext(scan.Id, 'USD', 'CPQ');

        Test.startTest();
        ForensicScanService.runDetectorChunk(scan.Id, ctx,
            new List<IDetector>{ new ThrowingDetector() });
        Test.stopTest();

        ForensicScan__c after2 = [
            SELECT ErrorMessage__c FROM ForensicScan__c WHERE Id = :scan.Id
        ];
        System.assertNotEquals(null, after2.ErrorMessage__c,
            'Detector exception should land in ErrorMessage__c');
        System.assert(after2.ErrorMessage__c.contains('STUB-THROW'),
            'Error message should include detector id');
    }

    @isTest
    static void finalizeRemoteScan_marksCompletedAndTotals() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Running', StartedAt__c = System.now()
        );
        insert scan;
        // Pre-insert a finding so totals are non-zero.
        insert new ForensicFinding__c(
            ForensicScan__c = scan.Id,
            DetectorId__c = 'STUB-001', Severity__c = 'Warning',
            GapUsd__c = 250, Title__c = 't', Description__c = 'd',
            Status__c = 'Open', DetectedAt__c = System.now()
        );

        Test.startTest();
        ForensicScanService.finalizeRemoteScan(scan.Id, 'CPQ', null, null);
        Test.stopTest();

        ForensicScan__c result = [
            SELECT Status__c, FindingCount__c, TotalLeakageUsd__c, CompletedAt__c
            FROM ForensicScan__c WHERE Id = :scan.Id
        ];
        System.assertEquals('Completed', result.Status__c);
        System.assertEquals(1, result.FindingCount__c);
        System.assertEquals(250, result.TotalLeakageUsd__c);
        System.assertNotEquals(null, result.CompletedAt__c);
    }

    @isTest
    static void finalizeRemoteScan_marksPartialWhenErrorMessageSet() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Running', StartedAt__c = System.now(),
            ErrorMessage__c = 'STUB-001: simulated detector error'
        );
        insert scan;

        Test.startTest();
        ForensicScanService.finalizeRemoteScan(scan.Id, 'CPQ', null, null);
        Test.stopTest();

        ForensicScan__c result = [
            SELECT Status__c FROM ForensicScan__c WHERE Id = :scan.Id
        ];
        System.assertEquals('Partial', result.Status__c);
    }
}
