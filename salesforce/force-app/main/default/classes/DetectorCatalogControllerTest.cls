/**
 * Phase 19a — DetectorCatalogController tests.
 *
 * The 20 Detector__mdt records ship with the org, so the catalog is
 * always populated. These tests assert the lookups + helper methods
 * behave correctly against that real seeded data, plus exercise the
 * cache-priming path for synthetic edge cases.
 */
@IsTest
private class DetectorCatalogControllerTest {

    @IsTest
    static void getCatalog_returns_seeded_detectors() {
        Test.startTest();
        List<DetectorCatalogController.CatalogEntry> entries =
            DetectorCatalogController.getCatalog();
        Test.stopTest();

        System.assert(entries.size() >= 20,
            'Expected at least 20 catalog entries from seeded records; got ' + entries.size());

        // Spot-check one: REN-001 should have a label.
        Boolean found = false;
        for (DetectorCatalogController.CatalogEntry e : entries) {
            if (e.detectorId == 'REN-001') {
                System.assertNotEquals(null, e.label, 'REN-001 should have a label');
                System.assertEquals('revenue_leakage', e.category, 'REN-001 in revenue_leakage category');
                found = true;
            }
        }
        System.assert(found, 'REN-001 missing from catalog');
    }

    @IsTest
    static void getLabel_falls_back_to_detector_id() {
        // Unknown detector → returns the id itself, doesn't throw.
        String label = DetectorCatalogController.getLabel('NEVER-SEEN');
        System.assertEquals('NEVER-SEEN', label);
    }

    @IsTest
    static void getLabel_returns_seeded_label() {
        String label = DetectorCatalogController.getLabel('REN-001');
        System.assertNotEquals(null, label);
        System.assertNotEquals('REN-001', label,
            'Label should be the human-readable name, not the id');
    }

    @IsTest
    static void resolveSeverity_uses_mdt_thresholds() {
        // REN-001 has thresholds: Critical > 10000, Warning > 1000.
        System.assertEquals('Critical', DetectorCatalogController.resolveSeverity('REN-001', 15000));
        System.assertEquals('Warning',  DetectorCatalogController.resolveSeverity('REN-001', 5000));
        System.assertEquals('Info',     DetectorCatalogController.resolveSeverity('REN-001', 500));
        System.assertEquals('Info',     DetectorCatalogController.resolveSeverity('REN-001', null));
    }

    @IsTest
    static void resolveSeverity_unknown_detector_uses_defaults() {
        // No mdt record → fallback Critical>10000, Warning>1000.
        System.assertEquals('Critical', DetectorCatalogController.resolveSeverity('NEW-DETECTOR', 50000));
        System.assertEquals('Warning',  DetectorCatalogController.resolveSeverity('NEW-DETECTOR', 5000));
        System.assertEquals('Info',     DetectorCatalogController.resolveSeverity('NEW-DETECTOR', 500));
    }

    @IsTest
    static void getRecoverability_returns_seeded_value_or_default() {
        Decimal r = DetectorCatalogController.getRecoverability('REN-001', 0.5);
        System.assertNotEquals(0.5, r, 'Should NOT use default when mdt has a value');
        Decimal d = DetectorCatalogController.getRecoverability('UNKNOWN', 0.5);
        System.assertEquals(0.5, d, 'Unknown detector should fall back to default');
    }

    @IsTest
    static void appliesTo_blank_productType_matches_all() {
        System.assertEquals(true, DetectorCatalogController.appliesTo('REN-001', null));
        System.assertEquals(true, DetectorCatalogController.appliesTo('REN-001', ''));
    }

    @IsTest
    static void appliesTo_honors_semicolon_list() {
        // REN-001 seeded with CPQ;CPQ+Billing;ARM → all three match.
        System.assertEquals(true, DetectorCatalogController.appliesTo('REN-001', 'CPQ'));
        System.assertEquals(true, DetectorCatalogController.appliesTo('REN-001', 'CPQ+Billing'));
        System.assertEquals(true, DetectorCatalogController.appliesTo('REN-001', 'ARM'));
        // QL-FOR-001 seeded with CPQ;CPQ+Billing only.
        System.assertEquals(false, DetectorCatalogController.appliesTo('QL-FOR-001', 'ARM'));
        // ORD-FOR-001 only CPQ+Billing.
        System.assertEquals(false, DetectorCatalogController.appliesTo('ORD-FOR-001', 'CPQ'));
        System.assertEquals(true,  DetectorCatalogController.appliesTo('ORD-FOR-001', 'CPQ+Billing'));
    }

    @IsTest
    static void appliesTo_unknown_detector_returns_true() {
        // Future-proof: if a detector class exists but mdt isn't seeded,
        // we run it (don't silently hide it).
        System.assertEquals(true, DetectorCatalogController.appliesTo('FUTURE-DET', 'CPQ'));
    }

    @IsTest
    static void isActive_returns_true_for_seeded_records() {
        System.assertEquals(true, DetectorCatalogController.isActive('REN-001'));
    }

    @IsTest
    static void isActive_returns_true_for_unknown_detector() {
        // Graceful fallback — if not in catalog, don't suppress.
        System.assertEquals(true, DetectorCatalogController.isActive('NOT-IN-CATALOG'));
    }

    // ── Phase 22a-0: RequiredSurface__c gating ──────────────────────

    @IsTest
    static void surfaceAvailable_returns_true_when_no_requirement() {
        // Seeded REN-001 has no RequiredSurface__c → always runs.
        System.assertEquals(true,
            DetectorCatalogController.surfaceAvailable('REN-001', false));
    }

    @IsTest
    static void surfaceAvailable_returns_true_for_unknown_detector() {
        // Unknown detector → no catalog record → no gating → returns true.
        System.assertEquals(true,
            DetectorCatalogController.surfaceAvailable('NEVER-SEEN', false));
    }

    @IsTest
    static void surfaceAvailable_returns_true_for_remote_scans() {
        // Remote scans use the target org's schema, not host. Always pass.
        Detector__mdt mock = new Detector__mdt(
            DetectorId__c = 'MOCK-1', IsActive__c = true,
            RequiredSurface__c = 'NotARealObject__c');
        DetectorCatalogController.primeCacheForTest(
            new Map<String, Detector__mdt>{ 'MOCK-1' => mock });
        System.assertEquals(true,
            DetectorCatalogController.surfaceAvailable('MOCK-1', true));
    }

    @IsTest
    static void surfaceAvailable_returns_false_when_required_object_absent() {
        Detector__mdt mock = new Detector__mdt(
            DetectorId__c = 'MOCK-2', IsActive__c = true,
            RequiredSurface__c = 'NotARealObject__c');
        DetectorCatalogController.primeCacheForTest(
            new Map<String, Detector__mdt>{ 'MOCK-2' => mock });
        System.assertEquals(false,
            DetectorCatalogController.surfaceAvailable('MOCK-2', false));
    }

    @IsTest
    static void surfaceAvailable_requires_all_listed_objects() {
        // Phase 24z-F — semicolon-list = AND, not OR. ARM-001 has
        // "Product2;ProductSellingModelOption" — needs both because the
        // SOQL joins across them. OR semantic let ARM-001 fire against
        // vanilla DE (Product2 alone) → 17 false positives per scan.
        Detector__mdt missing = new Detector__mdt(
            DetectorId__c = 'MOCK-3', IsActive__c = true,
            RequiredSurface__c = 'NotARealObject__c;Account');
        DetectorCatalogController.primeCacheForTest(
            new Map<String, Detector__mdt>{ 'MOCK-3' => missing });
        System.assertEquals(false,
            DetectorCatalogController.surfaceAvailable('MOCK-3', false),
            'AND semantics: one missing surface must block the detector');

        Detector__mdt allPresent = new Detector__mdt(
            DetectorId__c = 'MOCK-4', IsActive__c = true,
            RequiredSurface__c = 'Account;Contact');
        DetectorCatalogController.primeCacheForTest(
            new Map<String, Detector__mdt>{ 'MOCK-4' => allPresent });
        System.assertEquals(true,
            DetectorCatalogController.surfaceAvailable('MOCK-4', false),
            'AND semantics: all present should pass');
    }

    @IsTest
    static void getRequiredSurface_returns_seeded_value_or_null() {
        // Seeded detectors don't have RequiredSurface__c populated yet.
        // The method should return null/blank rather than throw.
        String s = DetectorCatalogController.getRequiredSurface('REN-001');
        System.assert(String.isBlank(s),
            'Seeded REN-001 has no RequiredSurface__c; got: ' + s);
    }
}
