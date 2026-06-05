/** Phase 22c-4 — Tests for the 4 deferred checks. */
@IsTest
private class Phase22c4Test {

    private static Integer ic = 0;
    private static Id mk(String p3) {
        ic++; String s = String.valueOf(ic);
        while (s.length() < 12) s = '0' + s;
        return (Id) (p3 + s);
    }
    private static DetectorContext ctx() { return new DetectorContext(null, 'USD', 'ARM'); }
    static Set<String> ids(List<DetectorResult> r) {
        Set<String> s = new Set<String>();
        for (DetectorResult dr : r) s.add(dr.detectorId);
        return s;
    }

    @IsTest static void arm131_outside_window() {
        Id sched = mk('a0s');
        ArmDeferredPricingChecksBundle.testStubSchedules = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => sched, 'Name' => 'Sched',
                'EffectiveStartDate' => Date.today(), 'EffectiveEndDate' => Date.today().addMonths(6) }
        };
        ArmDeferredPricingChecksBundle.testStubAdjRules = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mk('a0r'), 'Name' => 'R1', 'IsActive' => true,
                'PriceAdjustmentScheduleId' => sched,
                'EffectiveStartDate' => Date.today().addDays(-10),
                'EffectiveEndDate' => Date.today().addMonths(3) }
        };
        Set<String> fired = ids(new ArmDeferredPricingChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-131'));
    }

    @IsTest static void arm131_within_window_quiet() {
        Id sched = mk('a0s');
        ArmDeferredPricingChecksBundle.testStubSchedules = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => sched, 'Name' => 'Sched',
                'EffectiveStartDate' => Date.today(), 'EffectiveEndDate' => Date.today().addMonths(6) }
        };
        ArmDeferredPricingChecksBundle.testStubAdjRules = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mk('a0r'), 'Name' => 'R1', 'IsActive' => true,
                'PriceAdjustmentScheduleId' => sched,
                'EffectiveStartDate' => Date.today().addDays(10),
                'EffectiveEndDate' => Date.today().addMonths(3) }
        };
        Set<String> fired = ids(new ArmDeferredPricingChecksBundle().run(ctx()));
        System.assert(!fired.contains('ARM-131'));
    }

    @IsTest static void arm192_no_items() {
        Id plan = mk('a0p');
        ArmBillingPolicyChecksBundle.testStubMilestonePlans = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => plan, 'Name' => 'P1', 'Status' => 'Active',
                'DefaultBillingTreatmentId' => mk('a0t'),
                'DefaultBillingTreatment' => new Map<String, Object>{ 'Status' => 'Active' } }
        };
        ArmBillingPolicyChecksBundle.testStubMilestonePlanItems = new List<Map<String, Object>>();
        Set<String> fired = ids(new ArmBillingPolicyChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-192'));
    }

    @IsTest static void arm192_inactive_treatment() {
        Id plan = mk('a0p');
        ArmBillingPolicyChecksBundle.testStubMilestonePlans = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => plan, 'Name' => 'P1', 'Status' => 'Active',
                'DefaultBillingTreatmentId' => mk('a0t'),
                'DefaultBillingTreatment' => new Map<String, Object>{ 'Status' => 'Inactive' } }
        };
        ArmBillingPolicyChecksBundle.testStubMilestonePlanItems = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mk('a0i'), 'BillingMilestonePlanId' => plan }
        };
        Set<String> fired = ids(new ArmBillingPolicyChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-192'));
    }

    @IsTest static void arm212_orphan_alternate() {
        Id setA = mk('a0q');
        ArmClauseChecksBundle.testStubClauses = new List<Map<String, Object>>{
            // Alternate with no main sibling
            new Map<String, Object>{ 'Id' => mk('a0l'), 'Name' => 'AltOrphan', 'Status' => 'Active',
                'Content' => 'x', 'DocumentClauseSetId' => setA, 'IsAlternateClause' => true,
                'ClauseName' => 'C1', 'ClauseLanguage' => 'en',
                'CreatedDate' => Datetime.now(), 'LastModifiedDate' => Datetime.now(),
                'DocumentClauseSet' => new Map<String, Object>{ 'Status' => 'Active' } },
            // Main exists for C2/en — alternate of C2 should NOT fire
            new Map<String, Object>{ 'Id' => mk('a0l'), 'Name' => 'MainC2', 'Status' => 'Active',
                'Content' => 'x', 'DocumentClauseSetId' => setA, 'IsAlternateClause' => false,
                'ClauseName' => 'C2', 'ClauseLanguage' => 'en',
                'CreatedDate' => Datetime.now(), 'LastModifiedDate' => Datetime.now(),
                'DocumentClauseSet' => new Map<String, Object>{ 'Status' => 'Active' } },
            new Map<String, Object>{ 'Id' => mk('a0l'), 'Name' => 'AltC2', 'Status' => 'Active',
                'Content' => 'x', 'DocumentClauseSetId' => setA, 'IsAlternateClause' => true,
                'ClauseName' => 'C2', 'ClauseLanguage' => 'en',
                'CreatedDate' => Datetime.now(), 'LastModifiedDate' => Datetime.now(),
                'DocumentClauseSet' => new Map<String, Object>{ 'Status' => 'Active' } }
        };
        Set<String> fired = ids(new ArmClauseChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-212'));
        // Verify offender count is exactly 1 (only the C1 alternate)
        Integer arm212Findings = 0;
        for (DetectorResult dr : new ArmClauseChecksBundle().run(ctx())) {
            if (dr.detectorId == 'ARM-212') arm212Findings = 1 + dr.supportingRecords.size();
        }
        System.assertEquals(1, arm212Findings, 'Only AltC1 should be flagged');
    }

    @IsTest static void arm214_modified_after_archival() {
        Datetime cd = Datetime.newInstance(2024, 1, 1, 10, 0, 0);
        Datetime md = Datetime.newInstance(2024, 6, 1, 10, 0, 0);
        ArmClauseChecksBundle.testStubClauses = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mk('a0l'), 'Name' => 'OldArch', 'Status' => 'Archived',
                'Content' => 'x', 'DocumentClauseSetId' => null, 'IsAlternateClause' => false,
                'ClauseName' => null, 'ClauseLanguage' => null,
                'CreatedDate' => cd, 'LastModifiedDate' => md,
                'DocumentClauseSet' => null }
        };
        Set<String> fired = ids(new ArmClauseChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-214'));
    }

    @IsTest static void direct_coverage() {
        List<Map<String, Object>> e = new List<Map<String, Object>>();
        System.assertEquals(0, ArmDeferredPricingChecksBundle.evaluateARM131(e, e).size());
        System.assertEquals(0, ArmBillingPolicyChecksBundle.evaluateARM192(e, e).size());
        System.assertEquals(0, ArmClauseChecksBundle.evaluateARM212(e).size());
        System.assertEquals(0, ArmClauseChecksBundle.evaluateARM214(e).size());
    }
}
