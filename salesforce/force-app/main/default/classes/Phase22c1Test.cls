/**
 * Phase 22c-1 — Tests for the 6 ARM bundles (23 checks).
 * No ARM surface on Techtorch — uses testStub paths.
 */
@IsTest
private class Phase22c1Test {

    private static Integer idCounter = 0;
    private static Id mkId(String prefix3) {
        idCounter++;
        String suffix = String.valueOf(idCounter);
        while (suffix.length() < 12) suffix = '0' + suffix;
        return (Id) (prefix3 + suffix);
    }
    private static Id prodId() { return mkId('01t'); }
    private static Id psmId() { return mkId('a0m'); }
    private static Id psmoId() { return mkId('a0o'); }
    private static Id pbeId() { return mkId('01u'); }
    private static Id catId() { return mkId('a0k'); }
    private static Id cpId() { return mkId('a0n'); }
    private static Id prcId() { return mkId('a0r'); }
    private static Id adId() { return mkId('a0d'); }
    private static Id apvId() { return mkId('a0v'); }
    private static Id acId() { return mkId('a0c'); }
    private static Id abId() { return mkId('a0b'); }
    private static Id qId() { return mkId('a0q'); }
    private static Id rsId() { return mkId('a0s'); }

    private static DetectorContext ctx() {
        return new DetectorContext(null, 'USD', 'ARM');
    }

    // ── Catalog ────────────────────────────────────────────────────

    @IsTest static void arm_catalog_all_checks() {
        Id p1 = prodId();
        Id p2 = prodId();
        Id catA = catId();
        ArmCatalogChecksBundle.testStubProducts = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => p1, 'Name' => 'NoModel', 'Family' => null },
            new Map<String, Object>{ 'Id' => p2, 'Name' => 'HasModel', 'Family' => null }
        };
        ArmCatalogChecksBundle.testStubPSMOs = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => psmoId(), 'Product2Id' => p2, 'ProductSellingModelId' => psmId(), 'IsActive' => true }
        };
        ArmCatalogChecksBundle.testStubPBEs = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => pbeId(), 'Product2Id' => p2, 'IsActive' => true }
        };
        ArmCatalogChecksBundle.testStubCategories = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => catA, 'Name' => 'Cat', 'IsActive' => false }
        };
        ArmCatalogChecksBundle.testStubCatProducts = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => cpId(), 'ProductId' => p2, 'ProductCategoryId' => catA }
        };
        List<DetectorResult> r = new ArmCatalogChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        System.assert(fired.contains('ARM-001'), 'ARM-001');
        System.assert(fired.contains('ARM-002b'), 'ARM-002b');
        System.assert(fired.contains('ARM-010'), 'ARM-010');
        System.assert(fired.contains('ARM-018'), 'ARM-018');
    }

    @IsTest static void arm_catalog_surface_skip() {
        ArmCatalogChecksBundle.testStubProducts = null;
        System.assertEquals(0, new ArmCatalogChecksBundle().run(ctx()).size());
    }

    // ── Selling Models ─────────────────────────────────────────────

    @IsTest static void arm_psm_all_checks() {
        Id activeM = psmId();
        Id inactiveM = psmId();
        Id draftM = psmId();
        Id p1 = prodId();
        ArmSellingModelChecksBundle.testStubModels = new List<Map<String, Object>>{
            // ARM-002: Term, no SellingFrequencyId
            new Map<String, Object>{ 'Id' => activeM, 'Name' => 'TermNoFreq', 'IsActive' => true,
                'SellingModelType' => 'TermDefined', 'SellingFrequencyId' => null, 'PricingTerm' => 12 },
            // ARM-011: Term, no PricingTerm
            new Map<String, Object>{ 'Id' => psmId(), 'Name' => 'TermNoTerm', 'IsActive' => true,
                'SellingModelType' => 'TermDefined', 'SellingFrequencyId' => mkId('a0f'), 'PricingTerm' => 0 },
            // Inactive
            new Map<String, Object>{ 'Id' => inactiveM, 'Name' => 'Inact', 'IsActive' => false,
                'SellingModelType' => 'OneTime' },
            // ARM-133: Draft, referenced
            new Map<String, Object>{ 'Id' => draftM, 'Name' => 'Draft', 'IsActive' => true,
                'SellingModelType' => 'OneTime', 'Status' => 'Draft' }
        };
        ArmSellingModelChecksBundle.testStubPSMOs = new List<Map<String, Object>>{
            // ARM-012: active option → inactive model
            new Map<String, Object>{ 'Id' => psmoId(), 'Product2Id' => p1,
                'ProductSellingModelId' => inactiveM, 'IsActive' => true },
            // ARM-019: duplicate pair
            new Map<String, Object>{ 'Id' => psmoId(), 'Product2Id' => p1,
                'ProductSellingModelId' => activeM, 'IsActive' => true },
            new Map<String, Object>{ 'Id' => psmoId(), 'Product2Id' => p1,
                'ProductSellingModelId' => activeM, 'IsActive' => true },
            // ARM-133 reference
            new Map<String, Object>{ 'Id' => psmoId(), 'Product2Id' => p1,
                'ProductSellingModelId' => draftM, 'IsActive' => true }
        };
        ArmSellingModelChecksBundle.testStubPBEs = new List<Map<String, Object>>();
        List<DetectorResult> r = new ArmSellingModelChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        System.assert(fired.contains('ARM-002'), 'ARM-002');
        System.assert(fired.contains('ARM-011'), 'ARM-011');
        System.assert(fired.contains('ARM-012'), 'ARM-012');
        System.assert(fired.contains('ARM-019'), 'ARM-019');
        System.assert(fired.contains('ARM-133'), 'ARM-133');
    }

    @IsTest static void arm_psm_surface_skip() {
        ArmSellingModelChecksBundle.testStubModels = null;
        ArmSellingModelChecksBundle.testStubPSMOs = null;
        ArmSellingModelChecksBundle.testStubPBEs = null;
        System.assertEquals(0, new ArmSellingModelChecksBundle().run(ctx()).size());
    }

    // ── Bundles ────────────────────────────────────────────────────

    @IsTest static void arm_bundles_all_checks() {
        Id activeP = prodId(); Id inactiveP = prodId(); Id bundleP = prodId();
        ArmBundleChecksBundle.testStubProducts = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => activeP, 'Name' => 'X', 'Family' => null, 'IsActive' => true },
            new Map<String, Object>{ 'Id' => inactiveP, 'Name' => 'Y', 'Family' => null, 'IsActive' => false },
            new Map<String, Object>{ 'Id' => bundleP, 'Name' => 'BigBundle', 'Family' => null, 'IsActive' => true }
        };
        ArmBundleChecksBundle.testStubComponents = new List<Map<String, Object>>{
            // ARM-013: min > max
            new Map<String, Object>{ 'Id' => prcId(), 'ParentProductId' => activeP,
                'ChildProductId' => activeP, 'MinQuantity' => 10, 'MaxQuantity' => 5 },
            // ARM-014: inactive child
            new Map<String, Object>{ 'Id' => prcId(), 'ParentProductId' => activeP,
                'ChildProductId' => inactiveP, 'MinQuantity' => 1, 'MaxQuantity' => 5 },
            // ARM-015: inactive parent still has components
            new Map<String, Object>{ 'Id' => prcId(), 'ParentProductId' => inactiveP,
                'ChildProductId' => activeP, 'MinQuantity' => 1, 'MaxQuantity' => 5 }
        };
        List<DetectorResult> r = new ArmBundleChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        System.assert(fired.contains('ARM-005'), 'ARM-005'); // bundleP has 'bundle' in name, no components
        System.assert(fired.contains('ARM-013'), 'ARM-013');
        System.assert(fired.contains('ARM-014'), 'ARM-014');
        System.assert(fired.contains('ARM-015'), 'ARM-015');
    }

    @IsTest static void arm_bundles_surface_skip() {
        ArmBundleChecksBundle.testStubProducts = null;
        ArmBundleChecksBundle.testStubComponents = null;
        System.assertEquals(0, new ArmBundleChecksBundle().run(ctx()).size());
    }

    // ── Attributes ─────────────────────────────────────────────────

    @IsTest static void arm_attrs_all_checks() {
        Id activeAc = acId(); Id inactiveAc = acId();
        Id pickDef = adId(); Id reqDef = adId(); Id orphanCatDef = adId();
        ArmAttributeChecksBundle.testStubRules = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => abId(), 'Name' => 'NoDates', 'IsActive' => true,
                'EffectiveStartDate' => null, 'EffectiveEndDate' => null }
        };
        ArmAttributeChecksBundle.testStubDefs = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => pickDef, 'Name' => 'Picklist1', 'Code' => 'PK1',
                'DataType' => 'Picklist', 'IsActive' => true, 'IsRequired' => false, 'DefaultValue' => 'X', 'AttributeCategoryId' => activeAc },
            new Map<String, Object>{ 'Id' => reqDef, 'Name' => 'ReqNoDef', 'Code' => 'R',
                'DataType' => 'Text', 'IsActive' => true, 'IsRequired' => true, 'DefaultValue' => null, 'AttributeCategoryId' => activeAc },
            new Map<String, Object>{ 'Id' => orphanCatDef, 'Name' => 'OrphanCat', 'Code' => 'O',
                'DataType' => 'Text', 'IsActive' => true, 'IsRequired' => false, 'DefaultValue' => 'x', 'AttributeCategoryId' => inactiveAc }
        };
        ArmAttributeChecksBundle.testStubValues = new List<Map<String, Object>>();  // pickDef has no values → ARM-024
        ArmAttributeChecksBundle.testStubCategories = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => activeAc, 'Name' => 'AC', 'IsActive' => true },
            new Map<String, Object>{ 'Id' => inactiveAc, 'Name' => 'IC', 'IsActive' => false }
        };
        List<DetectorResult> r = new ArmAttributeChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        System.assert(fired.contains('ARM-004'), 'ARM-004');
        System.assert(fired.contains('ARM-024'), 'ARM-024');
        System.assert(fired.contains('ARM-025'), 'ARM-025');
        System.assert(fired.contains('ARM-026'), 'ARM-026');
    }

    @IsTest static void arm_attrs_surface_skip() {
        ArmAttributeChecksBundle.testStubRules = null;
        ArmAttributeChecksBundle.testStubDefs = null;
        ArmAttributeChecksBundle.testStubValues = null;
        ArmAttributeChecksBundle.testStubCategories = null;
        System.assertEquals(0, new ArmAttributeChecksBundle().run(ctx()).size());
    }

    // ── Qualification ──────────────────────────────────────────────

    @IsTest static void arm_qual_all_checks() {
        Id activeP = prodId(); Id inactiveP = prodId();
        ArmQualificationChecksBundle.testStubQuals = new List<Map<String, Object>>{
            // ARM-110: expired but qualified
            new Map<String, Object>{ 'Id' => qId(), 'Name' => 'Exp', 'ProductId' => activeP,
                'RootProductId' => activeP, 'IsQualified' => true,
                'EffectiveFromDate' => Date.today().addYears(-2),
                'EffectiveToDate' => Date.today().addMonths(-1) },
            // ARM-111: reversed dates
            new Map<String, Object>{ 'Id' => qId(), 'Name' => 'Rev', 'ProductId' => activeP,
                'RootProductId' => activeP, 'IsQualified' => false,
                'EffectiveFromDate' => Date.today(),
                'EffectiveToDate' => Date.today().addDays(-30) },
            // ARM-112: references inactive
            new Map<String, Object>{ 'Id' => qId(), 'Name' => 'InactRef', 'ProductId' => inactiveP,
                'RootProductId' => activeP, 'IsQualified' => false,
                'EffectiveFromDate' => null, 'EffectiveToDate' => null }
        };
        ArmQualificationChecksBundle.testStubProducts = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => activeP, 'IsActive' => true },
            new Map<String, Object>{ 'Id' => inactiveP, 'IsActive' => false }
        };
        List<DetectorResult> r = new ArmQualificationChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        System.assert(fired.contains('ARM-110'), 'ARM-110');
        System.assert(fired.contains('ARM-111'), 'ARM-111');
        System.assert(fired.contains('ARM-112'), 'ARM-112');
    }

    @IsTest static void arm_qual_surface_skip() {
        ArmQualificationChecksBundle.testStubQuals = null;
        ArmQualificationChecksBundle.testStubProducts = null;
        System.assertEquals(0, new ArmQualificationChecksBundle().run(ctx()).size());
    }

    // ── Ramp ───────────────────────────────────────────────────────

    @IsTest static void arm_ramp_all_checks() {
        Id p1 = prodId(); Id m1 = psmId();
        ArmRampChecksBundle.testStubRamps = new List<Map<String, Object>>{
            // ARM-120: non-FreeTrial, no model
            new Map<String, Object>{ 'Id' => rsId(), 'Name' => 'NoModel', 'ProductId' => p1,
                'ProductSellingModelId' => null, 'SegmentType' => 'Standard',
                'TrialDuration' => null, 'DurationType' => null },
            // ARM-121: FreeTrial, no duration
            new Map<String, Object>{ 'Id' => rsId(), 'Name' => 'NoDur', 'ProductId' => p1,
                'ProductSellingModelId' => null, 'SegmentType' => 'FreeTrial',
                'TrialDuration' => null, 'DurationType' => null },
            // ARM-122: two custom on same (p1, m1)
            new Map<String, Object>{ 'Id' => rsId(), 'Name' => 'C1', 'ProductId' => p1,
                'ProductSellingModelId' => m1, 'SegmentType' => 'Custom',
                'TrialDuration' => 1, 'DurationType' => 'Days' },
            new Map<String, Object>{ 'Id' => rsId(), 'Name' => 'C2', 'ProductId' => p1,
                'ProductSellingModelId' => m1, 'SegmentType' => 'Custom',
                'TrialDuration' => 1, 'DurationType' => 'Days' }
        };
        List<DetectorResult> r = new ArmRampChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        System.assert(fired.contains('ARM-120'), 'ARM-120');
        System.assert(fired.contains('ARM-121'), 'ARM-121');
        System.assert(fired.contains('ARM-122'), 'ARM-122');
    }

    @IsTest static void arm_ramp_surface_skip() {
        ArmRampChecksBundle.testStubRamps = null;
        System.assertEquals(0, new ArmRampChecksBundle().run(ctx()).size());
    }

    // ── Direct helper calls for coverage ──────────────────────────

    @IsTest static void direct_calls_for_coverage() {
        // Empty inputs return 0 — exercises all 23 evaluate methods cheaply.
        List<Map<String, Object>> empty = new List<Map<String, Object>>();
        System.assertEquals(0, ArmCatalogChecksBundle.evaluateARM001(empty, empty).size());
        System.assertEquals(0, ArmCatalogChecksBundle.evaluateARM002b(empty, empty).size());
        System.assertEquals(0, ArmCatalogChecksBundle.evaluateARM010(empty, empty, empty).size());
        System.assertEquals(0, ArmCatalogChecksBundle.evaluateARM018(empty, empty, empty).size());
        System.assertEquals(0, ArmSellingModelChecksBundle.evaluateARM002(empty).size());
        System.assertEquals(0, ArmSellingModelChecksBundle.evaluateARM011(empty).size());
        System.assertEquals(0, ArmSellingModelChecksBundle.evaluateARM012(empty, empty).size());
        System.assertEquals(0, ArmSellingModelChecksBundle.evaluateARM019(empty).size());
        System.assertEquals(0, ArmSellingModelChecksBundle.evaluateARM133(empty, empty, empty).size());
        System.assertEquals(0, ArmBundleChecksBundle.evaluateARM005(empty, empty).size());
        System.assertEquals(0, ArmBundleChecksBundle.evaluateARM013(empty).size());
        System.assertEquals(0, ArmBundleChecksBundle.evaluateARM014(empty, empty).size());
        System.assertEquals(0, ArmBundleChecksBundle.evaluateARM015(empty, empty).size());
        System.assertEquals(0, ArmAttributeChecksBundle.evaluateARM004(empty).size());
        System.assertEquals(0, ArmAttributeChecksBundle.evaluateARM024(empty, empty).size());
        System.assertEquals(0, ArmAttributeChecksBundle.evaluateARM025(empty).size());
        System.assertEquals(0, ArmAttributeChecksBundle.evaluateARM026(empty, empty).size());
        System.assertEquals(0, ArmQualificationChecksBundle.evaluateARM110(empty).size());
        System.assertEquals(0, ArmQualificationChecksBundle.evaluateARM111(empty).size());
        System.assertEquals(0, ArmQualificationChecksBundle.evaluateARM112(empty, empty).size());
        System.assertEquals(0, ArmRampChecksBundle.evaluateARM120(empty).size());
        System.assertEquals(0, ArmRampChecksBundle.evaluateARM121(empty).size());
        System.assertEquals(0, ArmRampChecksBundle.evaluateARM122(empty).size());
    }
}
