@isTest
private class DetectorOverrideServiceTest {

    private static ConnectedOrg__c makeOrg() {
        ConnectedOrg__c c = new ConnectedOrg__c(
            Name = 'Test Override Org',
            ProductType__c = 'CPQ+Billing',
            NamedCredentialName__c = 'TestNC',
            InstanceUrl__c = 'https://test.salesforce.com'
        );
        insert c;
        return c;
    }

    private static DetectorResult result(String detectorId, String severity) {
        DetectorResult r = new DetectorResult();
        r.detectorId = detectorId;
        r.severity = severity;
        r.gapUsd = 0;
        r.title = 'test ' + detectorId;
        return r;
    }

    @isTest
    static void applyOverrides_localScan_passesThrough() {
        // connectedOrgId == null means local scan → no override lookup
        List<DetectorResult> inp = new List<DetectorResult>{
            result('TR-001', 'Critical'), result('GL-001', 'Warning')
        };
        List<DetectorResult> out = DetectorOverrideService.applyOverrides(inp, null);
        System.assertEquals(2, out.size());
        System.assertEquals('Critical', out[0].severity);
    }

    @isTest
    static void applyOverrides_noOverrides_passesThrough() {
        ConnectedOrg__c o = makeOrg();
        List<DetectorResult> inp = new List<DetectorResult>{
            result('TR-001', 'Critical')
        };
        List<DetectorResult> out = DetectorOverrideService.applyOverrides(inp, o.Id);
        System.assertEquals(1, out.size());
        System.assertEquals('Critical', out[0].severity, 'No override → catalog default kept');
    }

    @isTest
    static void applyOverrides_severityOverride_rewrites() {
        ConnectedOrg__c o = makeOrg();
        insert new DetectorOverride__c(
            ConnectedOrg__c = o.Id,
            DetectorId__c = 'TR-001',
            SeverityOverride__c = 'Info',
            IsActive__c = true
        );
        List<DetectorResult> inp = new List<DetectorResult>{
            result('TR-001', 'Critical'), result('GL-001', 'Critical')
        };
        List<DetectorResult> out = DetectorOverrideService.applyOverrides(inp, o.Id);
        System.assertEquals(2, out.size(), 'GL-001 unaffected; TR-001 rewritten');
        Map<String, String> byId = new Map<String, String>();
        for (DetectorResult r : out) byId.put(r.detectorId, r.severity);
        System.assertEquals('Info', byId.get('TR-001'), 'Severity overridden');
        System.assertEquals('Critical', byId.get('GL-001'), 'Untouched detector kept');
    }

    @isTest
    static void applyOverrides_notApplicable_drops() {
        ConnectedOrg__c o = makeOrg();
        insert new DetectorOverride__c(
            ConnectedOrg__c = o.Id,
            DetectorId__c = 'TR-001',
            SeverityOverride__c = 'Not Applicable',
            IsActive__c = true
        );
        List<DetectorResult> inp = new List<DetectorResult>{
            result('TR-001', 'Critical'), result('GL-001', 'Warning')
        };
        List<DetectorResult> out = DetectorOverrideService.applyOverrides(inp, o.Id);
        System.assertEquals(1, out.size(), 'TR-001 dropped');
        System.assertEquals('GL-001', out[0].detectorId);
    }

    @isTest
    static void applyOverrides_inactiveOverride_ignored() {
        ConnectedOrg__c o = makeOrg();
        insert new DetectorOverride__c(
            ConnectedOrg__c = o.Id,
            DetectorId__c = 'TR-001',
            SeverityOverride__c = 'Info',
            IsActive__c = false
        );
        List<DetectorResult> inp = new List<DetectorResult>{ result('TR-001', 'Critical') };
        List<DetectorResult> out = DetectorOverrideService.applyOverrides(inp, o.Id);
        System.assertEquals('Critical', out[0].severity,
            'IsActive__c=false → override ignored, catalog default wins');
    }

    @isTest
    static void controller_getOverridesForOrg_includesDefaults() {
        ConnectedOrg__c o = makeOrg();
        Test.startTest();
        List<DetectorOverrideController.OverrideRow> rows =
            DetectorOverrideController.getOverridesForOrg(o.Id);
        Test.stopTest();
        // Should return one row per active Detector__mdt; we have 200+
        // shipped detectors so this is a non-trivial list.
        System.assert(rows.size() > 50, 'Catalog should produce many rows; got ' + rows.size());
        // Every row should have a detectorId; overrideRecordId stays null
        // for orgs with no override rows yet.
        for (DetectorOverrideController.OverrideRow r : rows) {
            System.assertNotEquals(null, r.detectorId);
            System.assertEquals(null, r.overrideRecordId);
        }
    }

    @isTest
    static void controller_saveOverrides_upsertsAndDeletes() {
        ConnectedOrg__c o = makeOrg();
        // Save: create a TR-001 Info override.
        DetectorOverrideController.OverrideRow row = new DetectorOverrideController.OverrideRow();
        row.detectorId = 'TR-001';
        row.overrideSeverity = 'Info';
        row.isActive = true;
        row.notes = 'using avalara';
        DetectorOverrideController.saveOverrides(o.Id, new List<DetectorOverrideController.OverrideRow>{ row });
        DetectorOverride__c created = [
            SELECT Id, SeverityOverride__c, Notes__c
            FROM DetectorOverride__c WHERE ConnectedOrg__c = :o.Id LIMIT 1
        ];
        System.assertEquals('Info', created.SeverityOverride__c);
        System.assertEquals('using avalara', created.Notes__c);

        // Now delete via null severity + existing recordId.
        row.overrideRecordId = created.Id;
        row.overrideSeverity = null;
        DetectorOverrideController.saveOverrides(o.Id, new List<DetectorOverrideController.OverrideRow>{ row });
        Integer remaining = [SELECT COUNT() FROM DetectorOverride__c WHERE ConnectedOrg__c = :o.Id];
        System.assertEquals(0, remaining, 'Override deleted');
    }
}
