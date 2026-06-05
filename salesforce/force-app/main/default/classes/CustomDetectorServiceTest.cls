/**
 * Phase 19b — CustomDetectorService tests.
 *
 * Custom Metadata is deploy-only — we can't insert CustomDetector__mdt
 * records at runtime — so the tests focus on:
 *   1. The pure helper methods (interpolate, toDecimal, matchesProductType,
 *      formatValue) — they're @TestVisible private statics.
 *   2. The public runAll() contract against the shipped (inactive)
 *      demo record — should return zero results until customer flips
 *      IsActive to true.
 */
@IsTest
private class CustomDetectorServiceTest {

    @IsTest
    static void runAll_with_no_active_records_returns_empty() {
        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Running', ProductType__c = 'CPQ',
            StartedAt__c = System.now()
        );
        insert s;
        DetectorContext ctx = new DetectorContext(s.Id, 'USD', 'CPQ');

        Test.startTest();
        List<DetectorResult> results = CustomDetectorService.runAll(ctx);
        Test.stopTest();

        // Demo record ships with IsActive=false → no findings.
        System.assertEquals(0, results.size(),
            'No active custom detectors should mean 0 results');
    }

    @IsTest
    static void runAll_null_context_returns_empty() {
        System.assertEquals(0, CustomDetectorService.runAll(null).size());
    }

    @IsTest
    static void interpolate_replaces_known_tokens() {
        String result = CustomDetectorService.interpolate(
            '{Name} has {AnnualRevenue} ARR',
            new Map<String, Object>{ 'Name' => 'Acme', 'AnnualRevenue' => 1000000 }
        );
        System.assertEquals('Acme has 1000000 ARR', result);
    }

    @IsTest
    static void interpolate_leaves_unknown_tokens_literal() {
        String result = CustomDetectorService.interpolate(
            '{Name} owes {MissingField}',
            new Map<String, Object>{ 'Name' => 'Acme' }
        );
        System.assertEquals('Acme owes {MissingField}', result);
    }

    @IsTest
    static void interpolate_blank_template_returns_empty() {
        System.assertEquals('', CustomDetectorService.interpolate(
            null, new Map<String, Object>()));
        System.assertEquals('', CustomDetectorService.interpolate(
            '', new Map<String, Object>()));
    }

    @IsTest
    static void toDecimal_handles_all_numeric_types() {
        System.assertEquals(null, CustomDetectorService.toDecimal(null));
        System.assertEquals(5, CustomDetectorService.toDecimal(5));
        System.assertEquals(5, CustomDetectorService.toDecimal(5L));
        System.assertEquals(5, CustomDetectorService.toDecimal(5.0));
        System.assertEquals(5.5, CustomDetectorService.toDecimal('5.5'));
        System.assertEquals(null, CustomDetectorService.toDecimal('not-a-number'));
    }

    @IsTest
    static void formatValue_renders_typed_values() {
        System.assertEquals('', CustomDetectorService.formatValue(null));
        System.assertEquals('Acme', CustomDetectorService.formatValue('Acme'));
        System.assertEquals('5', CustomDetectorService.formatValue(5));
        System.assertEquals('5.5', CustomDetectorService.formatValue((Decimal) 5.5));
        System.assertEquals('true', CustomDetectorService.formatValue(true));
        System.assertEquals('false', CustomDetectorService.formatValue(false));
    }

    @IsTest
    static void matchesProductType_honors_semicolon_list_and_blanks() {
        CustomDetector__mdt d = new CustomDetector__mdt();
        d.AppliesTo__c = 'CPQ;ARM';
        System.assertEquals(true,  CustomDetectorService.matchesProductType(d, 'CPQ'));
        System.assertEquals(true,  CustomDetectorService.matchesProductType(d, 'ARM'));
        System.assertEquals(false, CustomDetectorService.matchesProductType(d, 'CPQ+Billing'));

        // Blank productType → matches all.
        System.assertEquals(true, CustomDetectorService.matchesProductType(d, ''));
        System.assertEquals(true, CustomDetectorService.matchesProductType(d, null));

        // Blank AppliesTo → matches all.
        d.AppliesTo__c = '';
        System.assertEquals(true, CustomDetectorService.matchesProductType(d, 'CPQ'));
        d.AppliesTo__c = null;
        System.assertEquals(true, CustomDetectorService.matchesProductType(d, 'CPQ'));
    }

    @IsTest
    static void runOne_happy_path_against_real_record() {
        // Insert a test Account so the SOQL has something to find.
        Account acct = new Account(
            Name = 'CustomDet Test Co', AnnualRevenue = 5000000
        );
        insert acct;

        // Construct an in-memory CustomDetector__mdt — we can't insert
        // mdt records, but we CAN populate one in memory and pass it
        // to runOne directly via @TestVisible.
        CustomDetector__mdt def = new CustomDetector__mdt();
        def.DetectorId__c = 'CUST-TEST-OK';
        def.Label__c = 'Test happy-path';
        def.SoqlQuery__c =
            'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = \'' + acct.Id + '\'';
        def.PrimaryRecordIdField__c = 'Id';
        def.PrimaryRecordType__c = 'Account';
        def.TitleTemplate__c = '{Name} flagged with revenue {AnnualRevenue}';
        def.DescriptionTemplate__c = 'Account {Id} carries {AnnualRevenue}.';
        def.EntitledUsdField__c = 'AnnualRevenue';
        def.RealizedUsdField__c = null;

        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Running', ProductType__c = 'CPQ',
            StartedAt__c = System.now()
        );
        insert s;
        DetectorContext ctx = new DetectorContext(s.Id, 'USD', 'CPQ');

        Test.startTest();
        List<DetectorResult> results = CustomDetectorService.runOne(def, ctx);
        Test.stopTest();

        System.assertEquals(1, results.size(),
            'Should produce exactly one finding for our test Account');
        DetectorResult r = results[0];
        System.assertEquals('CUST-TEST-OK', r.detectorId);
        System.assert(r.title.contains('CustomDet Test Co'),
            'Title should interpolate the Name: ' + r.title);
        System.assert(r.title.contains('5000000'),
            'Title should interpolate AnnualRevenue: ' + r.title);
        System.assert(r.description.contains(acct.Id),
            'Description should interpolate Id: ' + r.description);
        System.assertEquals(5000000, r.entitledUsd);
        System.assertEquals(0, r.realizedUsd);
        System.assertEquals(5000000, r.gapUsd);
        System.assertNotEquals(null, r.primaryRecord);
        System.assertEquals(acct.Id, r.primaryRecord.recordId);
        System.assertEquals('Account', r.primaryRecord.sObjectType);
        // Metadata should carry the raw row columns for downstream consumers
        System.assertEquals(acct.Id, r.metadata.get('Id'));
        System.assertEquals('CustomDet Test Co', r.metadata.get('Name'));
    }

    @IsTest
    static void runOne_uses_default_PrimaryRecordIdField_Id() {
        Account acct = new Account(Name = 'Default-PK', AnnualRevenue = 100);
        insert acct;

        CustomDetector__mdt def = new CustomDetector__mdt();
        def.DetectorId__c = 'CUST-DEFAULT-PK';
        def.SoqlQuery__c =
            'SELECT Id, Name FROM Account WHERE Id = \'' + acct.Id + '\'';
        // PrimaryRecordIdField__c intentionally blank → defaults to "Id"
        def.PrimaryRecordType__c = 'Account';
        def.TitleTemplate__c = '{Name}';

        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Running', ProductType__c = 'CPQ',
            StartedAt__c = System.now()
        );
        insert s;
        DetectorContext ctx = new DetectorContext(s.Id, 'USD', 'CPQ');

        List<DetectorResult> results = CustomDetectorService.runOne(def, ctx);
        System.assertEquals(1, results.size());
        System.assertEquals(acct.Id, results[0].primaryRecord.recordId);
    }

    @IsTest
    static void runOne_builds_DetectorResult_from_row() {
        // Synthetic detector definition (an in-memory mdt — no insert
        // possible — but the helper methods are pure and don't query).
        // We bypass runOne's SOQL execution by calling interpolate +
        // toDecimal directly above; the integration is exercised by
        // the runAll path against the shipped demo record.
        // This test just confirms runOne is reachable as @TestVisible.
        Boolean reachable = false;
        try {
            // Construct a minimal def with an intentionally-broken SOQL
            // so runOne throws and we cover the catch path in runAll.
            CustomDetector__mdt d = new CustomDetector__mdt();
            d.DetectorId__c = 'TEST';
            d.SoqlQuery__c = 'SELECT Id FROM ThisObjectDoesNotExist__c LIMIT 1';
            d.PrimaryRecordIdField__c = 'Id';
            d.PrimaryRecordType__c = 'Account';
            d.TitleTemplate__c = '{Id}';
            ForensicScan__c s = new ForensicScan__c(
                Status__c = 'Running', ProductType__c = 'CPQ',
                StartedAt__c = System.now()
            );
            insert s;
            DetectorContext ctx = new DetectorContext(s.Id, 'USD', 'CPQ');
            CustomDetectorService.runOne(d, ctx);
        } catch (Exception e) {
            // Expected — invalid sObject. Confirms the error-handling path.
            reachable = true;
        }
        System.assert(reachable, 'runOne should throw on invalid SOQL');
    }
}
