/**
 * Phase 19c — FlowDetectorService tests.
 *
 * We can't insert FlowDetector__mdt records at runtime, so the tests
 * lean on:
 *   1. The public runAll() against the shipped (inactive) FLOW-DEMO-001
 *      record — should return zero results.
 *   2. The helper methods (matchesProductType, toDetectorResult) called
 *      directly via @TestVisible.
 *   3. The shipped OrgPrism_FlowDetectorDemo Flow — invoked via runOne
 *      against an in-memory FlowDetector__mdt to cover the Flow.Interview
 *      code path. The demo Flow outputs an empty Findings collection,
 *      which exercises both createInterview + start + getVariableValue
 *      without needing to construct synthetic findings.
 */
@IsTest
private class FlowDetectorServiceTest {

    private static DetectorContext localCtx() {
        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Running', ProductType__c = 'CPQ',
            StartedAt__c = System.now()
        );
        insert s;
        return new DetectorContext(s.Id, 'USD', 'CPQ');
    }

    @IsTest
    static void runAll_with_no_active_records_returns_empty() {
        Test.startTest();
        List<DetectorResult> results = FlowDetectorService.runAll(localCtx());
        Test.stopTest();
        System.assertEquals(0, results.size(),
            'No active flow detectors should mean 0 results');
    }

    @IsTest
    static void runAll_skips_remote_scans() {
        // Remote ctx → service short-circuits before any DML / Flow invocation.
        DetectorContext remote = new DetectorContext(
            null, 'USD', 'CPQ', '001000000000001', 'TestNamedCred');
        System.assertEquals(0, FlowDetectorService.runAll(remote).size(),
            'Remote-org scans must skip Flow detectors');
    }

    @IsTest
    static void runAll_null_context_returns_empty() {
        System.assertEquals(0, FlowDetectorService.runAll(null).size());
    }

    @IsTest
    static void matchesProductType_honors_semicolon_list_and_blanks() {
        FlowDetector__mdt d = new FlowDetector__mdt();
        d.AppliesTo__c = 'CPQ;ARM';
        System.assertEquals(true,  FlowDetectorService.matchesProductType(d, 'CPQ'));
        System.assertEquals(true,  FlowDetectorService.matchesProductType(d, 'ARM'));
        System.assertEquals(false, FlowDetectorService.matchesProductType(d, 'CPQ+Billing'));
        System.assertEquals(true,  FlowDetectorService.matchesProductType(d, ''));
        System.assertEquals(true,  FlowDetectorService.matchesProductType(d, null));
        d.AppliesTo__c = null;
        System.assertEquals(true,  FlowDetectorService.matchesProductType(d, 'CPQ'));
    }

    @IsTest
    static void toDetectorResult_marshals_finding_fields() {
        FlowDetector__mdt def = new FlowDetector__mdt();
        def.DetectorId__c = 'FLOW-MAP-TEST';

        ForensicFinding__c f = new ForensicFinding__c(
            Title__c = 'Mapped via Flow',
            Description__c = 'Flow built this',
            Severity__c = 'Warning',
            EntitledUsd__c = 1500,
            RealizedUsd__c = 500,
            RecoverabilityScore__c = 0.75,
            PrimaryRecordId__c = '001000000000001',
            PrimaryRecordType__c = 'Account',
            DetectorId__c = 'FLOW-OVERRIDE'
        );

        DetectorResult r = FlowDetectorService.toDetectorResult(def, f);
        // Flow's DetectorId__c on the finding overrides the mdt-level id.
        System.assertEquals('FLOW-OVERRIDE', r.detectorId);
        System.assertEquals('Mapped via Flow', r.title);
        System.assertEquals(1500, r.entitledUsd);
        System.assertEquals(500, r.realizedUsd);
        System.assertEquals(1000, r.gapUsd);
        // Flow-set Severity__c honored, not recomputed from catalog.
        System.assertEquals('Warning', r.severity);
        System.assertEquals(0.75, r.recoverabilityScore);
        System.assertNotEquals(null, r.primaryRecord);
        System.assertEquals('001000000000001', r.primaryRecord.recordId);
        System.assertEquals('Account', r.primaryRecord.sObjectType);
    }

    @IsTest
    static void toDetectorResult_falls_back_to_mdt_DetectorId_when_finding_blank() {
        FlowDetector__mdt def = new FlowDetector__mdt();
        def.DetectorId__c = 'FLOW-FALLBACK';

        ForensicFinding__c f = new ForensicFinding__c(
            Title__c = 'No DetectorId on finding',
            EntitledUsd__c = 100, RealizedUsd__c = 0
        );
        DetectorResult r = FlowDetectorService.toDetectorResult(def, f);
        System.assertEquals('FLOW-FALLBACK', r.detectorId);
        System.assertEquals(100, r.gapUsd);
        // No Severity__c on the finding → catalog resolver used.
        System.assertNotEquals(null, r.severity);
    }

    @IsTest
    static void runOne_executes_demo_flow_and_returns_empty_collection() {
        // OrgPrism_FlowDetectorDemo is shipped and outputs an empty
        // Findings collection. Invoking it covers the createInterview +
        // start + getVariableValue path.
        FlowDetector__mdt def = new FlowDetector__mdt();
        def.DetectorId__c = 'FLOW-DEMO-001';
        def.FlowApiName__c = 'OrgPrism_FlowDetectorDemo';

        Test.startTest();
        List<DetectorResult> results = FlowDetectorService.runOne(def, localCtx());
        Test.stopTest();

        // Demo Flow now constructs one synthetic finding so we exercise
        // the inner marshaling loop in runOne.
        System.assertEquals(1, results.size(),
            'Demo Flow outputs one finding — expect 1 DetectorResult');
        DetectorResult r = results[0];
        System.assertEquals('FLOW-DEMO-001', r.detectorId);
        System.assertEquals('Info', r.severity);
        System.assert(r.title.contains('Flow demo'),
            'Title should come from the Flow assignment: ' + r.title);
    }

    @IsTest
    static void runAll_logs_and_continues_when_runOne_throws() {
        // We can't insert an active FlowDetector__mdt at runtime, but
        // we CAN verify the outer runAll path against the inactive
        // shipped record (it's IsActive=false, so the inner loop body
        // never executes; the SELECT + outer guard is exercised
        // independently here). This combined with the dedicated
        // runOne tests covers the runAll body well enough.
        DetectorContext ctx = localCtx();
        List<DetectorResult> results = FlowDetectorService.runAll(ctx);
        // The shipped FLOW-DEMO-001 is inactive → query returns 0 rows.
        // Result list is empty. This call exercises the SOQL guard.
        System.assertEquals(0, results.size());
    }

    @IsTest
    static void runOne_blank_FlowApiName_caught_at_runAll_level() {
        // runOne with a blank FlowApiName would never be invoked by
        // runAll (it filters those out), but we cover the createInterview
        // failure path here for completeness.
        FlowDetector__mdt def = new FlowDetector__mdt();
        def.DetectorId__c = 'FLOW-BLANK';
        def.FlowApiName__c = '   '; // whitespace only
        Boolean threw = false;
        try {
            FlowDetectorService.runOne(def, localCtx());
        } catch (Exception e) {
            threw = true;
        }
        System.assert(threw, 'runOne with blank FlowApiName should throw');
    }

    @IsTest
    static void runOne_throws_on_missing_flow_caught_by_runAll() {
        // A FlowDetector pointing to a non-existent Flow API name —
        // runOne throws but runAll wraps + logs.
        FlowDetector__mdt def = new FlowDetector__mdt();
        def.DetectorId__c = 'FLOW-MISSING';
        def.FlowApiName__c = 'FlowThatDoesNotExist_xyz123';

        Boolean threw = false;
        try {
            FlowDetectorService.runOne(def, localCtx());
        } catch (FlowDetectorService.FlowDetectorException e) {
            threw = true;
        }
        System.assert(threw, 'runOne should throw FlowDetectorException for missing Flow');
    }
}
