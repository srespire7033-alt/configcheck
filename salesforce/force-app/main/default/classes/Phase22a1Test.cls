/**
 * Phase 22a-1 — Tests for the 5 product/pricebook hygiene detectors.
 *
 * Uses the testStubRows static on each detector to bypass SOQL.
 * Verifies: each detector returns one DetectorResult per stubbed
 * row, with the right detectorId, severity, and primaryRecord type.
 * Empty-input and null-field happy paths are covered.
 *
 * No SOQL-based integration tests here — the detectors all use
 * OrgQueryService.query which has its own coverage; the test stub
 * pattern keeps this fast and deterministic.
 */
@IsTest
private class Phase22a1Test {

    private static Id fakeProductId() {
        return '01t' + '000000000001AAA'; // 15-char stub Id
    }

    private static Map<String, Object> sampleRow(String name, String code) {
        return new Map<String, Object>{
            'Id' => (Id) fakeProductId(),
            'Name' => name,
            'ProductCode' => code
        };
    }

    @IsTest
    static void pb001_returns_one_result_per_row_with_correct_metadata() {
        PB001ProductNoPricebookDetector.testStubRows = new List<Map<String, Object>>{
            sampleRow('Acme Widget', 'WIDGET-001'),
            sampleRow('Acme Gizmo', 'GIZMO-002')
        };
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');

        List<DetectorResult> results = new PB001ProductNoPricebookDetector().run(ctx);

        System.assertEquals(2, results.size());
        DetectorResult r = results[0];
        System.assertEquals('PB-001', r.detectorId);
        System.assertEquals('Warning', r.severity);
        System.assertEquals(0, r.gapUsd);
        System.assertEquals('Product2', r.primaryRecord.sObjectType);
        System.assert(r.title.contains('Acme Widget'), 'Title should embed product name');
        System.assert(r.description.contains('WIDGET-001'), 'Description should embed ProductCode');
    }

    @IsTest
    static void pb001_handles_blank_product_code_gracefully() {
        PB001ProductNoPricebookDetector.testStubRows = new List<Map<String, Object>>{
            sampleRow('No-Code Product', null)
        };
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');

        List<DetectorResult> results = new PB001ProductNoPricebookDetector().run(ctx);
        System.assertEquals(1, results.size());
        // Description should NOT contain '(null)' or '()' artefacts.
        System.assert(!results[0].description.contains('(null)'));
        System.assert(!results[0].description.contains('()'));
    }

    @IsTest
    static void pb002_marks_severity_warning() {
        PB002ProductNoDescDetector.testStubRows = new List<Map<String, Object>>{
            sampleRow('No-Desc Widget', 'NDW-001')
        };
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');

        List<DetectorResult> results = new PB002ProductNoDescDetector().run(ctx);
        System.assertEquals(1, results.size());
        System.assertEquals('PB-002', results[0].detectorId);
        System.assertEquals('Warning', results[0].severity);
    }

    @IsTest
    static void pb003_returns_correct_id_and_severity() {
        PB003ProductNoCodeDetector.testStubRows = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => fakeProductId(), 'Name' => 'NoCode' }
        };
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');

        List<DetectorResult> results = new PB003ProductNoCodeDetector().run(ctx);
        System.assertEquals(1, results.size());
        System.assertEquals('PB-003', results[0].detectorId);
        System.assertEquals('Warning', results[0].severity);
    }

    @IsTest
    static void pb004_marks_severity_info() {
        PB004ProductNoFamilyDetector.testStubRows = new List<Map<String, Object>>{
            sampleRow('NoFam', 'NF-001')
        };
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');

        List<DetectorResult> results = new PB004ProductNoFamilyDetector().run(ctx);
        System.assertEquals(1, results.size());
        System.assertEquals('PB-004', results[0].detectorId);
        System.assertEquals('Info', results[0].severity);
    }

    @IsTest
    static void ua001_marks_severity_info_and_correct_id() {
        UA001ProductUnusedDetector.testStubRows = new List<Map<String, Object>>{
            sampleRow('Stale Product', 'STALE-001')
        };
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');

        List<DetectorResult> results = new UA001ProductUnusedDetector().run(ctx);
        System.assertEquals(1, results.size());
        System.assertEquals('UA-001', results[0].detectorId);
        System.assertEquals('Info', results[0].severity);
    }

    @IsTest
    static void all_detectors_return_empty_on_empty_stub() {
        PB001ProductNoPricebookDetector.testStubRows = new List<Map<String, Object>>();
        PB002ProductNoDescDetector.testStubRows    = new List<Map<String, Object>>();
        PB003ProductNoCodeDetector.testStubRows    = new List<Map<String, Object>>();
        PB004ProductNoFamilyDetector.testStubRows  = new List<Map<String, Object>>();
        UA001ProductUnusedDetector.testStubRows    = new List<Map<String, Object>>();
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');

        System.assertEquals(0, new PB001ProductNoPricebookDetector().run(ctx).size());
        System.assertEquals(0, new PB002ProductNoDescDetector().run(ctx).size());
        System.assertEquals(0, new PB003ProductNoCodeDetector().run(ctx).size());
        System.assertEquals(0, new PB004ProductNoFamilyDetector().run(ctx).size());
        System.assertEquals(0, new UA001ProductUnusedDetector().run(ctx).size());
    }

    @IsTest
    static void ua001_handles_soql_failure_cleanly() {
        // Forces the non-stub path. On Techtorch (no SBQQ namespace) the
        // SOQL will throw inside OrgQueryService.query → caught → returns
        // empty list. On an SBQQ-bearing org it executes for real and
        // returns whatever Product2 matches. Either way no exception.
        UA001ProductUnusedDetector.testStubRows = null;
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');

        List<DetectorResult> results = new UA001ProductUnusedDetector().run(ctx);

        System.assertNotEquals(null, results, 'Should never return null');
    }

    @IsTest
    static void detector_metadata_is_consistent() {
        // Each detector reports its own id from getDetectorId().
        System.assertEquals('PB-001', new PB001ProductNoPricebookDetector().getDetectorId());
        System.assertEquals('PB-002', new PB002ProductNoDescDetector().getDetectorId());
        System.assertEquals('PB-003', new PB003ProductNoCodeDetector().getDetectorId());
        System.assertEquals('PB-004', new PB004ProductNoFamilyDetector().getDetectorId());
        System.assertEquals('UA-001', new UA001ProductUnusedDetector().getDetectorId());
        // Labels are non-blank.
        System.assertNotEquals('', new PB001ProductNoPricebookDetector().getLabel());
        // UA-001 does NOT apply to ARM (SBQQ-only).
        System.assert(
            new UA001ProductUnusedDetector().getAppliesTo().contains('CPQ'),
            'UA-001 should apply to CPQ'
        );
        System.assert(
            !new UA001ProductUnusedDetector().getAppliesTo().contains('ARM'),
            'UA-001 should NOT apply to ARM (no SBQQ surface there)'
        );
    }
}
