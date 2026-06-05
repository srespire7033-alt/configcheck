/**
 * Phase 22c-3 — Tests for 9 ARM advanced bundles (32 checks).
 * Compact: focused stub scenarios + bulk direct-helper coverage.
 */
@IsTest
private class Phase22c3Test {

    private static Integer idCounter = 0;
    private static Id mkId(String prefix3) {
        idCounter++;
        String suffix = String.valueOf(idCounter);
        while (suffix.length() < 12) suffix = '0' + suffix;
        return (Id) (prefix3 + suffix);
    }
    private static DetectorContext ctx() { return new DetectorContext(null, 'USD', 'ARM'); }

    // ── ContextDefinition ──
    @IsTest static void ctx_009_and_030() {
        ArmContextDefinitionChecksBundle.testStubDefs = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0c'), 'DeveloperName' => 'D1', 'IsActive' => false }
        };
        Set<String> fired = ids(new ArmContextDefinitionChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-009'));
        System.assert(fired.contains('ARM-030'));
    }
    @IsTest static void ctx_skip() {
        ArmContextDefinitionChecksBundle.testStubDefs = null;
        System.assertEquals(0, new ArmContextDefinitionChecksBundle().run(ctx()).size());
    }

    // ── Assets ──
    @IsTest static void assets_all() {
        Id a1 = mkId('02i'); Id a2 = mkId('02i'); Id a3 = mkId('02i');
        ArmAssetChecksBundle.testStubAssets = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => a1, 'Name' => 'A1', 'Status' => 'Active' }, // 031 (no period)
            new Map<String, Object>{ 'Id' => a2, 'Name' => 'A2', 'Status' => 'Active',
                'CurrentLifecycleEndDate' => Date.today().addDays(-10) }, // 032
            new Map<String, Object>{ 'Id' => a3, 'Name' => 'A3', 'Status' => 'Active' }
        };
        ArmAssetChecksBundle.testStubStatePeriods = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0p'), 'AssetId' => a3, 'IsCurrent' => true, 'Quantity' => 5 },
            new Map<String, Object>{ 'Id' => mkId('a0p'), 'AssetId' => a3, 'IsCurrent' => true, 'Quantity' => 0 } // 034 + 035
        };
        ArmAssetChecksBundle.testStubRelations = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0r'), 'AssetId' => a1, 'RelatedAssetId' => null } // 033
        };
        Set<String> fired = ids(new ArmAssetChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-031'));
        System.assert(fired.contains('ARM-032'));
        System.assert(fired.contains('ARM-033'));
        System.assert(fired.contains('ARM-034'));
        System.assert(fired.contains('ARM-035'));
    }
    @IsTest static void assets_skip() {
        ArmAssetChecksBundle.testStubAssets = null;
        ArmAssetChecksBundle.testStubStatePeriods = null;
        ArmAssetChecksBundle.testStubRelations = null;
        System.assertEquals(0, new ArmAssetChecksBundle().run(ctx()).size());
    }

    // ── Contracts ──
    @IsTest static void contracts_all() {
        ArmContractChecksBundle.testStubContracts = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('800'), 'ContractNumber' => 'C1', 'Status' => 'Activated',
                'EndDate' => Date.today().addDays(-30) }, // 037
            new Map<String, Object>{ 'Id' => mkId('800'), 'ContractNumber' => 'C2', 'Status' => 'Draft',
                'StartDate' => Date.today(), 'EndDate' => Date.today().addDays(-30) } // 039
        };
        ArmContractChecksBundle.testStubItemPrices = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0i'), 'Name' => 'IP1',
                'EffectiveStartDate' => null, 'EffectiveEndDate' => null, 'Price' => 100 }, // 036
            new Map<String, Object>{ 'Id' => mkId('a0i'), 'Name' => 'IP2',
                'EffectiveStartDate' => Date.today(), 'EffectiveEndDate' => null, 'Price' => 0 } // 038
        };
        Set<String> fired = ids(new ArmContractChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-036'));
        System.assert(fired.contains('ARM-037'));
        System.assert(fired.contains('ARM-038'));
        System.assert(fired.contains('ARM-039'));
    }
    @IsTest static void contracts_skip() {
        ArmContractChecksBundle.testStubContracts = null;
        ArmContractChecksBundle.testStubItemPrices = null;
        System.assertEquals(0, new ArmContractChecksBundle().run(ctx()).size());
    }

    // ── Usage Management ──
    @IsTest static void usage_all() {
        ArmUsageManagementChecksBundle.testStubUomClasses = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0u'), 'Name' => 'U', 'IsActive' => true, 'DefaultUomId' => null } // 040
        };
        ArmUsageManagementChecksBundle.testStubResources = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0w'), 'Name' => 'R1', 'Status' => 'Inactive', 'UnitOfMeasureClassId' => mkId('a0u') }, // 041
            new Map<String, Object>{ 'Id' => mkId('a0w'), 'Name' => 'R2', 'Status' => 'Active', 'UnitOfMeasureClassId' => null } // 044
        };
        ArmUsageManagementChecksBundle.testStubGrants = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0g'), 'Name' => 'G1', 'Status' => 'Active',
                'EffectiveStartDate' => null, 'EffectiveEndDate' => Date.today().addDays(-10) }, // 042
            new Map<String, Object>{ 'Id' => mkId('a0g'), 'Name' => 'G2', 'Status' => 'Inactive',
                'EffectiveStartDate' => Date.today(), 'EffectiveEndDate' => Date.today().addDays(-30) } // 043
        };
        Set<String> fired = ids(new ArmUsageManagementChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-040'));
        System.assert(fired.contains('ARM-041'));
        System.assert(fired.contains('ARM-042'));
        System.assert(fired.contains('ARM-043'));
        System.assert(fired.contains('ARM-044'));
    }
    @IsTest static void usage_skip() {
        ArmUsageManagementChecksBundle.testStubUomClasses = null;
        ArmUsageManagementChecksBundle.testStubResources = null;
        ArmUsageManagementChecksBundle.testStubGrants = null;
        System.assertEquals(0, new ArmUsageManagementChecksBundle().run(ctx()).size());
    }

    // ── Orchestration ──
    @IsTest static void orch_all() {
        Id grp1 = mkId('a0h');
        ArmOrchestrationChecksBundle.testStubSteps = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0s'), 'Name' => 'S1', 'FulfillmentStepDefinitionGroupId' => null } // 045
        };
        ArmOrchestrationChecksBundle.testStubGroups = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => grp1, 'Name' => 'G1' } // 046 (empty)
        };
        ArmOrchestrationChecksBundle.testStubTaskRules = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0t'), 'Name' => 'T1', 'Status' => 'Active', 'AssignedToId' => null } // 047
        };
        ArmOrchestrationChecksBundle.testStubScenarios = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0n'), 'Name' => 'Sc1', 'Status' => 'Draft' } // 048
        };
        Id sd = mkId('a0s');
        ArmOrchestrationChecksBundle.testStubDeps = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0e'), 'FulfillmentStepDefinitionId' => sd,
                'DependsOnStepDefinitionId' => sd } // 171 self
        };
        Set<String> fired = ids(new ArmOrchestrationChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-045'));
        System.assert(fired.contains('ARM-046'));
        System.assert(fired.contains('ARM-047'));
        System.assert(fired.contains('ARM-048'));
        System.assert(fired.contains('ARM-171'));
    }
    @IsTest static void orch_skip() {
        ArmOrchestrationChecksBundle.testStubSteps = null;
        ArmOrchestrationChecksBundle.testStubGroups = null;
        ArmOrchestrationChecksBundle.testStubTaskRules = null;
        ArmOrchestrationChecksBundle.testStubScenarios = null;
        ArmOrchestrationChecksBundle.testStubDeps = null;
        System.assertEquals(0, new ArmOrchestrationChecksBundle().run(ctx()).size());
    }

    // ── Cost Books ──
    @IsTest static void costbook_all() {
        Id b1 = mkId('a0b'); Id b2 = mkId('a0b'); Id b3 = mkId('a0b');
        ArmCostBookChecksBundle.testStubBooks = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => b1, 'Name' => 'B1', 'IsActive' => true, 'IsStandard' => false, 'CurrencyIsoCode' => 'USD' }, // 049 + 051
            new Map<String, Object>{ 'Id' => b2, 'Name' => 'B2', 'IsActive' => true, 'IsStandard' => false, 'CurrencyIsoCode' => 'USD' },
            new Map<String, Object>{ 'Id' => b3, 'Name' => 'B3', 'IsActive' => true, 'IsStandard' => false }
        };
        ArmCostBookChecksBundle.testStubEntries = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0y'), 'CostBookId' => b3, 'Cost' => 0 } // 050
        };
        Set<String> fired = ids(new ArmCostBookChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-049'));
        System.assert(fired.contains('ARM-050'));
        System.assert(fired.contains('ARM-051'));
    }
    @IsTest static void costbook_skip() {
        ArmCostBookChecksBundle.testStubBooks = null;
        ArmCostBookChecksBundle.testStubEntries = null;
        System.assertEquals(0, new ArmCostBookChecksBundle().run(ctx()).size());
    }

    // ── Billing Policies ──
    @IsTest static void billpol_all() {
        Id arr1 = mkId('a0a');
        ArmBillingPolicyChecksBundle.testStubPolicies = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0p'), 'Name' => 'P1', 'Status' => 'Active',
                'BillingTreatmentSelection' => 'Default', 'DefaultBillingTreatmentId' => null,
                'DefaultBillingTreatment' => null } // 190
        };
        ArmBillingPolicyChecksBundle.testStubArrangements = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => arr1, 'Name' => 'A1', 'Status' => 'Active' } // 191
        };
        ArmBillingPolicyChecksBundle.testStubArrangementLines = new List<Map<String, Object>>();
        ArmBillingPolicyChecksBundle.testStubRetryRuleSets = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0z'), 'Name' => 'R1', 'Status' => 'Active', 'IsOrgDefault' => true },
            new Map<String, Object>{ 'Id' => mkId('a0z'), 'Name' => 'R2', 'Status' => 'Active', 'IsOrgDefault' => true } // 193
        };
        Set<String> fired = ids(new ArmBillingPolicyChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-190'));
        System.assert(fired.contains('ARM-191'));
        System.assert(fired.contains('ARM-193'));
    }
    @IsTest static void billpol_skip() {
        ArmBillingPolicyChecksBundle.testStubPolicies = null;
        ArmBillingPolicyChecksBundle.testStubArrangements = null;
        ArmBillingPolicyChecksBundle.testStubArrangementLines = null;
        ArmBillingPolicyChecksBundle.testStubRetryRuleSets = null;
        System.assertEquals(0, new ArmBillingPolicyChecksBundle().run(ctx()).size());
    }

    // ── Clauses ──
    @IsTest static void clause_all() {
        Id set1 = mkId('a0q');
        ArmClauseChecksBundle.testStubClauses = new List<Map<String, Object>>{
            // 210: active, blank content
            new Map<String, Object>{ 'Id' => mkId('a0l'), 'Name' => 'CL1', 'Status' => 'Active',
                'Content' => null, 'DocumentClauseSetId' => set1, 'IsAlternateClause' => false,
                'ClauseName' => 'X', 'ClauseLanguage' => 'en',
                'DocumentClauseSet' => new Map<String, Object>{ 'Status' => 'Active' } },
            // 211: 2 main in same set/name/lang
            new Map<String, Object>{ 'Id' => mkId('a0l'), 'Name' => 'CL2a', 'Status' => 'Active',
                'Content' => 'body', 'DocumentClauseSetId' => set1, 'IsAlternateClause' => false,
                'ClauseName' => 'Y', 'ClauseLanguage' => 'en',
                'DocumentClauseSet' => new Map<String, Object>{ 'Status' => 'Active' } },
            new Map<String, Object>{ 'Id' => mkId('a0l'), 'Name' => 'CL2b', 'Status' => 'Active',
                'Content' => 'body', 'DocumentClauseSetId' => set1, 'IsAlternateClause' => false,
                'ClauseName' => 'Y', 'ClauseLanguage' => 'en',
                'DocumentClauseSet' => new Map<String, Object>{ 'Status' => 'Active' } },
            // 213: references inactive set
            new Map<String, Object>{ 'Id' => mkId('a0l'), 'Name' => 'CL3', 'Status' => 'Active',
                'Content' => 'body', 'DocumentClauseSetId' => mkId('a0q'), 'IsAlternateClause' => false,
                'ClauseName' => 'Z', 'ClauseLanguage' => 'en',
                'DocumentClauseSet' => new Map<String, Object>{ 'Status' => 'Inactive' } }
        };
        ArmClauseChecksBundle.testStubClauseSets = new List<Map<String, Object>>();
        Set<String> fired = ids(new ArmClauseChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-210'));
        System.assert(fired.contains('ARM-211'));
        System.assert(fired.contains('ARM-213'));
    }
    @IsTest static void clause_skip() {
        ArmClauseChecksBundle.testStubClauses = null;
        ArmClauseChecksBundle.testStubClauseSets = null;
        System.assertEquals(0, new ArmClauseChecksBundle().run(ctx()).size());
    }

    // ── Deferred Pricing (ARM-130, ARM-132) ──
    @IsTest static void defprice_all() {
        Id sched = mkId('a0s');
        ArmDeferredPricingChecksBundle.testStubSchedules = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => sched, 'Name' => 'Sched',
                'EffectiveStartDate' => Date.today(), 'EffectiveEndDate' => Date.today().addMonths(6) }
        };
        ArmDeferredPricingChecksBundle.testStubTiers = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0t'), 'PriceAdjustmentScheduleId' => sched,
                'EffectiveStartDate' => Date.today().addDays(-10), 'EffectiveEndDate' => Date.today().addMonths(3) } // 130
        };
        Id p1 = mkId('01t'); Id m1 = mkId('a0m'); Id m2 = mkId('a0m');
        ArmDeferredPricingChecksBundle.testStubPbes = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('01u'), 'Product2Id' => p1, 'ProductSellingModelId' => m1, 'IsActive' => true }, // 132 (no PSMO match)
            new Map<String, Object>{ 'Id' => mkId('01u'), 'Product2Id' => p1, 'ProductSellingModelId' => m2, 'IsActive' => true }
        };
        ArmDeferredPricingChecksBundle.testStubPsmos = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => mkId('a0o'), 'Product2Id' => p1, 'ProductSellingModelId' => m2, 'IsActive' => true }
        };
        Set<String> fired = ids(new ArmDeferredPricingChecksBundle().run(ctx()));
        System.assert(fired.contains('ARM-130'));
        System.assert(fired.contains('ARM-132'));
    }
    @IsTest static void defprice_skip() {
        ArmDeferredPricingChecksBundle.testStubSchedules = null;
        ArmDeferredPricingChecksBundle.testStubTiers = null;
        ArmDeferredPricingChecksBundle.testStubPbes = null;
        ArmDeferredPricingChecksBundle.testStubPsmos = null;
        System.assertEquals(0, new ArmDeferredPricingChecksBundle().run(ctx()).size());
    }

    // ── Direct helper coverage on empty inputs ──
    @IsTest static void direct_empty_coverage() {
        List<Map<String, Object>> e = new List<Map<String, Object>>();
        System.assertEquals(0, ArmContextDefinitionChecksBundle.evaluateARM009(e).size());
        System.assertEquals(0, ArmContextDefinitionChecksBundle.evaluateARM030(e).size());
        System.assertEquals(0, ArmAssetChecksBundle.evaluateARM031(e, e).size());
        System.assertEquals(0, ArmAssetChecksBundle.evaluateARM032(e).size());
        System.assertEquals(0, ArmAssetChecksBundle.evaluateARM033(e).size());
        System.assertEquals(0, ArmAssetChecksBundle.evaluateARM034(e).size());
        System.assertEquals(0, ArmAssetChecksBundle.evaluateARM035(e).size());
        System.assertEquals(0, ArmContractChecksBundle.evaluateARM036(e).size());
        System.assertEquals(0, ArmContractChecksBundle.evaluateARM037(e).size());
        System.assertEquals(0, ArmContractChecksBundle.evaluateARM038(e).size());
        System.assertEquals(0, ArmContractChecksBundle.evaluateARM039(e).size());
        System.assertEquals(0, ArmUsageManagementChecksBundle.evaluateARM040(e).size());
        System.assertEquals(0, ArmUsageManagementChecksBundle.evaluateARM041(e).size());
        System.assertEquals(0, ArmUsageManagementChecksBundle.evaluateARM042(e).size());
        System.assertEquals(0, ArmUsageManagementChecksBundle.evaluateARM043(e).size());
        System.assertEquals(0, ArmUsageManagementChecksBundle.evaluateARM044(e).size());
        System.assertEquals(0, ArmOrchestrationChecksBundle.evaluateARM045(e).size());
        System.assertEquals(0, ArmOrchestrationChecksBundle.evaluateARM046(e, e).size());
        System.assertEquals(0, ArmOrchestrationChecksBundle.evaluateARM047(e).size());
        System.assertEquals(0, ArmOrchestrationChecksBundle.evaluateARM048(e).size());
        System.assertEquals(0, ArmOrchestrationChecksBundle.evaluateARM171(e).size());
        System.assertEquals(0, ArmCostBookChecksBundle.evaluateARM049(e, e).size());
        System.assertEquals(0, ArmCostBookChecksBundle.evaluateARM050(e).size());
        System.assertEquals(0, ArmCostBookChecksBundle.evaluateARM051(e).size());
        System.assertEquals(0, ArmBillingPolicyChecksBundle.evaluateARM190(e).size());
        System.assertEquals(0, ArmBillingPolicyChecksBundle.evaluateARM191(e, e).size());
        System.assertEquals(0, ArmBillingPolicyChecksBundle.evaluateARM193(e).size());
        System.assertEquals(0, ArmClauseChecksBundle.evaluateARM210(e).size());
        System.assertEquals(0, ArmClauseChecksBundle.evaluateARM211(e).size());
        System.assertEquals(0, ArmClauseChecksBundle.evaluateARM213(e).size());
        System.assertEquals(0, ArmDeferredPricingChecksBundle.evaluateARM130(e, e).size());
        System.assertEquals(0, ArmDeferredPricingChecksBundle.evaluateARM132(e, e).size());
    }

    static Set<String> ids(List<DetectorResult> r) {
        Set<String> s = new Set<String>();
        for (DetectorResult dr : r) s.add(dr.detectorId);
        return s;
    }
}
