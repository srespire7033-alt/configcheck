/**
 * Phase 22c-2 — Tests for the 3 ARM pricing bundles (13 checks).
 */
@IsTest
private class Phase22c2Test {

    private static Integer idCounter = 0;
    private static Id mkId(String prefix3) {
        idCounter++;
        String suffix = String.valueOf(idCounter);
        while (suffix.length() < 12) suffix = '0' + suffix;
        return (Id) (prefix3 + suffix);
    }
    private static Id schedId() { return mkId('a0s'); }
    private static Id tierId()  { return mkId('a0t'); }
    private static Id ruleId()  { return mkId('a0r'); }
    private static Id cardId()  { return mkId('a0c'); }
    private static Id entryId() { return mkId('a0e'); }
    private static Id esId()    { return mkId('a0x'); }
    private static Id dtId()    { return mkId('a0d'); }
    private static Id pbId()    { return mkId('01s'); }

    private static DetectorContext ctx() {
        return new DetectorContext(null, 'USD', 'ARM');
    }

    // ── Price Adjustments ──────────────────────────────────────────

    @IsTest static void padj_all_checks() {
        Id sched1 = schedId();   // overlapping + has tiers
        Id sched2 = schedId();   // active, no tiers (ARM-016)
        ArmPriceAdjustmentChecksBundle.testStubSchedules = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => sched1, 'Name' => 'S1', 'IsActive' => true },
            new Map<String, Object>{ 'Id' => sched2, 'Name' => 'EmptyS', 'IsActive' => true }
        };
        ArmPriceAdjustmentChecksBundle.testStubTiers = new List<Map<String, Object>>{
            // ARM-003: overlap on sched1
            new Map<String, Object>{ 'Id' => tierId(), 'PriceAdjustmentScheduleId' => sched1,
                'LowerBound' => 0, 'UpperBound' => 10 },
            new Map<String, Object>{ 'Id' => tierId(), 'PriceAdjustmentScheduleId' => sched1,
                'LowerBound' => 5, 'UpperBound' => 20 },
            // ARM-017: reversed bounds
            new Map<String, Object>{ 'Id' => tierId(), 'PriceAdjustmentScheduleId' => sched1,
                'LowerBound' => 100, 'UpperBound' => 50 }
        };
        ArmPriceAdjustmentChecksBundle.testStubRules = new List<Map<String, Object>>{
            // ARM-020: expired but active
            new Map<String, Object>{ 'Id' => ruleId(), 'Name' => 'OldRule', 'IsActive' => true,
                'EffectiveEndDate' => Date.today().addDays(-30) }
        };
        List<DetectorResult> r = new ArmPriceAdjustmentChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        System.assert(fired.contains('ARM-003'), 'ARM-003');
        System.assert(fired.contains('ARM-016'), 'ARM-016');
        System.assert(fired.contains('ARM-017'), 'ARM-017');
        System.assert(fired.contains('ARM-020'), 'ARM-020');
    }

    @IsTest static void padj_surface_skip() {
        ArmPriceAdjustmentChecksBundle.testStubSchedules = null;
        ArmPriceAdjustmentChecksBundle.testStubTiers = null;
        ArmPriceAdjustmentChecksBundle.testStubRules = null;
        System.assertEquals(0, new ArmPriceAdjustmentChecksBundle().run(ctx()).size());
    }

    // ── Rate Cards + Procedures + Decision Tables ──────────────────

    @IsTest static void rcproc_all_checks() {
        Id card1 = cardId();    // active, no entries → ARM-021
        Id card2 = cardId();    // expired → ARM-023
        Id card3 = cardId();    // has entry but null price → ARM-022
        ArmRateCardProcedureChecksBundle.testStubRateCards = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => card1, 'Name' => 'EmptyCard', 'IsActive' => true, 'EffectiveEndDate' => null },
            new Map<String, Object>{ 'Id' => card2, 'Name' => 'ExpCard', 'IsActive' => true,
                'EffectiveEndDate' => Date.today().addDays(-10) },
            new Map<String, Object>{ 'Id' => card3, 'Name' => 'NullPriceCard', 'IsActive' => true, 'EffectiveEndDate' => null }
        };
        ArmRateCardProcedureChecksBundle.testStubRateCardEntries = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => entryId(), 'RateCardId' => card3, 'Price' => null },
            new Map<String, Object>{ 'Id' => entryId(), 'RateCardId' => card3, 'Price' => 0 },
            new Map<String, Object>{ 'Id' => entryId(), 'RateCardId' => card2, 'Price' => 100 }
        };
        ArmRateCardProcedureChecksBundle.testStubExpressionSetsAll = new List<Map<String, Object>>{
            // ARM-006: missing UsageType
            new Map<String, Object>{ 'Id' => esId(), 'ApiName' => 'NoUT', 'UsageType' => null },
            // ARM-027: 2 active pricing procedures
            new Map<String, Object>{ 'Id' => esId(), 'ApiName' => 'P1', 'UsageType' => 'Pricing' },
            new Map<String, Object>{ 'Id' => esId(), 'ApiName' => 'P2', 'UsageType' => 'Pricing' }
        };
        ArmRateCardProcedureChecksBundle.testStubDecisionTables = new List<Map<String, Object>>{
            // ARM-008: some Draft
            new Map<String, Object>{ 'Id' => dtId(), 'MasterLabel' => 'DT1', 'Status' => 'Draft' },
            new Map<String, Object>{ 'Id' => dtId(), 'MasterLabel' => 'DT2', 'Status' => 'Inactive' }
        };
        List<DetectorResult> r = new ArmRateCardProcedureChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        System.assert(fired.contains('ARM-021'), 'ARM-021');
        System.assert(fired.contains('ARM-022'), 'ARM-022');
        System.assert(fired.contains('ARM-023'), 'ARM-023');
        System.assert(fired.contains('ARM-006'), 'ARM-006');
        System.assert(fired.contains('ARM-027'), 'ARM-027');
        System.assert(fired.contains('ARM-008'), 'ARM-008');
        System.assert(fired.contains('ARM-029'), 'ARM-029');  // no Active among 2 Draft/Inactive
    }

    @IsTest static void rcproc_surface_skip() {
        ArmRateCardProcedureChecksBundle.testStubRateCards = null;
        ArmRateCardProcedureChecksBundle.testStubRateCardEntries = null;
        ArmRateCardProcedureChecksBundle.testStubExpressionSetsAll = null;
        ArmRateCardProcedureChecksBundle.testStubDecisionTables = null;
        System.assertEquals(0, new ArmRateCardProcedureChecksBundle().run(ctx()).size());
    }

    // ── Price Books ────────────────────────────────────────────────

    @IsTest static void pbook_arm007_gated_by_rc() {
        // RC sentinel ABSENT → ARM-007 must NOT fire even with multi-book conflict.
        ArmPriceBookChecksBundle.testStubRcSentinelPresent = false;
        ArmPriceBookChecksBundle.testStubPriceBooks = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => pbId(), 'Name' => 'Std', 'IsActive' => true, 'IsStandard' => true },
            new Map<String, Object>{ 'Id' => pbId(), 'Name' => 'A', 'IsActive' => true, 'IsStandard' => false, 'CurrencyIsoCode' => 'USD' },
            new Map<String, Object>{ 'Id' => pbId(), 'Name' => 'B', 'IsActive' => true, 'IsStandard' => false, 'CurrencyIsoCode' => 'USD' }
        };
        List<DetectorResult> r = new ArmPriceBookChecksBundle().run(ctx());
        for (DetectorResult dr : r) System.assertNotEquals('ARM-007', dr.detectorId, 'ARM-007 must not fire without RC sentinel');
    }

    @IsTest static void pbook_all_checks_with_rc() {
        ArmPriceBookChecksBundle.testStubRcSentinelPresent = true;
        ArmPriceBookChecksBundle.testStubPriceBooks = new List<Map<String, Object>>{
            // ARM-028: standard inactive
            new Map<String, Object>{ 'Id' => pbId(), 'Name' => 'Std', 'IsActive' => false, 'IsStandard' => true },
            // ARM-007: 2 active USD custom
            new Map<String, Object>{ 'Id' => pbId(), 'Name' => 'A', 'IsActive' => true, 'IsStandard' => false, 'CurrencyIsoCode' => 'USD' },
            new Map<String, Object>{ 'Id' => pbId(), 'Name' => 'B', 'IsActive' => true, 'IsStandard' => false, 'CurrencyIsoCode' => 'USD' }
        };
        List<DetectorResult> r = new ArmPriceBookChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        System.assert(fired.contains('ARM-007'), 'ARM-007');
        System.assert(fired.contains('ARM-028'), 'ARM-028');
    }

    // ── Direct helper coverage ─────────────────────────────────────

    @IsTest static void direct_calls_for_coverage() {
        List<Map<String, Object>> empty = new List<Map<String, Object>>();
        System.assertEquals(0, ArmPriceAdjustmentChecksBundle.evaluateARM003(empty, empty).size());
        System.assertEquals(0, ArmPriceAdjustmentChecksBundle.evaluateARM016(empty, empty).size());
        System.assertEquals(0, ArmPriceAdjustmentChecksBundle.evaluateARM017(empty, empty).size());
        System.assertEquals(0, ArmPriceAdjustmentChecksBundle.evaluateARM020(empty).size());
        System.assertEquals(0, ArmRateCardProcedureChecksBundle.evaluateARM021(empty, empty).size());
        System.assertEquals(0, ArmRateCardProcedureChecksBundle.evaluateARM022(empty, empty).size());
        System.assertEquals(0, ArmRateCardProcedureChecksBundle.evaluateARM023(empty).size());
        System.assertEquals(0, ArmRateCardProcedureChecksBundle.evaluateARM006(empty).size());
        System.assertEquals(0, ArmRateCardProcedureChecksBundle.evaluateARM027(empty).size());
        System.assertEquals(0, ArmRateCardProcedureChecksBundle.evaluateARM008(empty).size());
        System.assertEquals(0, ArmRateCardProcedureChecksBundle.evaluateARM029(empty).size());
        System.assertEquals(0, ArmPriceBookChecksBundle.evaluateARM007(empty).size());
        System.assertEquals(0, ArmPriceBookChecksBundle.evaluateARM028(empty).size());
    }
}
