@isTest
private class DetectorCatalogSeverityTest {

    @isTest
    static void getSeverity_returnsCatalogValueWhenSet() {
        // Phase 24a backfilled severity from Vercel. Phase 24p demoted
        // TR-001 from Critical to Warning (it's a config-state issue,
        // not an active workflow block — orgs using external tax
        // engines have null tax rules by design). Test now asserts
        // we pick up Warning from the catalog over the Info fallback.
        Test.startTest();
        String sev = DetectorCatalogController.getSeverity('TR-001', 'Info');
        Test.stopTest();
        System.assertEquals('Warning', sev,
            'TR-001 should pick up Warning from catalog, not the Info fallback');
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

    // ─── DetectorResult.emitPerRecord coverage ───

    @isTest
    static void emitPerRecord_emitsOneFindingPerRecord() {
        List<SourceRecord> recs = new List<SourceRecord>{
            new SourceRecord('Product2', '01tNS0000000001AAA', 'P1'),
            new SourceRecord('Product2', '01tNS0000000002AAA', 'P2'),
            new SourceRecord('Product2', '01tNS0000000003AAA', 'P3')
        };
        List<DetectorResult> out = DetectorResult.emitPerRecord(
            recs, 'TR-001', 'Critical', 2000, 0.85,
            'Product "{name}" missing tax rule',
            'Active product has no tax rule.'
        );
        System.assertEquals(3, out.size(), '3 records → 3 findings');
        System.assertEquals('Product "P2" missing tax rule', out[1].title);
        System.assertEquals('TR-001', out[0].detectorId);
        System.assertEquals(2000, out[2].gapUsd);
    }

    @isTest
    static void emitPerRecord_emptyList_returnsEmpty() {
        List<DetectorResult> out = DetectorResult.emitPerRecord(
            new List<SourceRecord>(), 'TR-001', 'Critical', 0, 1.0, '{name}', 'd');
        System.assertEquals(0, out.size());
    }

    @isTest
    static void emitPerRecord_nullList_returnsEmpty() {
        List<DetectorResult> out = DetectorResult.emitPerRecord(
            null, 'TR-001', 'Critical', 0, 1.0, '{name}', 'd');
        System.assertEquals(0, out.size());
    }

    // ─── DetectorContext coverage (push to >75%) ───
    @isTest
    static void detectorContext_remoteIsTrueWhenBothSet() {
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ', '001000000000001', 'NC');
        System.assertEquals(true, ctx.isRemote());
        System.assertEquals('NC', ctx.namedCredentialName);
        System.assertEquals('CPQ', ctx.productType);
    }

    @isTest
    static void detectorContext_remoteIsFalseWhenIdNull() {
        DetectorContext ctx = new DetectorContext(null, 'EUR', 'ARM');
        System.assertEquals(false, ctx.isRemote());
        System.assertEquals('EUR', ctx.defaultCurrency);
    }

    @isTest
    static void detectorContext_snapshotRoundtrip() {
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        ctx.putSnapshot('Account', new List<SObject>{ new Account(Name='Snap') });
        List<SObject> got = ctx.getSnapshot('Account');
        System.assertEquals(1, got.size());
        System.assertEquals(null, ctx.getSnapshot('Missing'));
    }

    @isTest
    static void emitPerRecord_nullName_usesPlaceholder() {
        List<SourceRecord> recs = new List<SourceRecord>{
            new SourceRecord('Product2', '01tNS0000000001AAA', null)
        };
        List<DetectorResult> out = DetectorResult.emitPerRecord(
            recs, 'TR-001', 'Info', 0, 1.0,
            'Missing {name} detail', 'd');
        System.assertEquals('Missing record detail', out[0].title);
    }
}
