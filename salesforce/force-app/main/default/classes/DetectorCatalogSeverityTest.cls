@isTest
private class DetectorCatalogSeverityTest {

    @isTest
    static void getSeverity_returnsCatalogValueWhenSet() {
        // Phase 24a backfilled the catalog from Vercel. TR-001 is Critical.
        Test.startTest();
        String sev = DetectorCatalogController.getSeverity('TR-001', 'Info');
        Test.stopTest();
        System.assertEquals('Critical', sev,
            'TR-001 should pick up Critical from catalog, not the Info fallback');
    }

    @isTest
    static void getSeverity_returnsFallbackWhenCatalogSilent() {
        // Forensic FOR-detectors don't have Severity__c set; fallback wins.
        String sev = DetectorCatalogController.getSeverity('REN-001', 'Warning');
        System.assertEquals('Warning', sev,
            'When catalog Severity__c is null, the fallback must be returned verbatim');
    }

    @isTest
    static void getSeverity_unknownDetector_returnsFallback() {
        String sev = DetectorCatalogController.getSeverity('NO-SUCH-DETECTOR-XYZ', 'Critical');
        System.assertEquals('Critical', sev,
            'Unknown detector id → fallback (no NPE)');
    }

    @isTest
    static void getSeverity_nullDetector_returnsFallback() {
        String sev = DetectorCatalogController.getSeverity(null, 'Warning');
        System.assertEquals('Warning', sev,
            'Null id → fallback (no NPE)');
    }

    @isTest
    static void getSeverity_warningCatalogEntry() {
        // BR-004 is Warning per Vercel.
        String sev = DetectorCatalogController.getSeverity('BR-004', 'Info');
        System.assertEquals('Warning', sev);
    }
}
