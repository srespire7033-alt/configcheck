/**
 * Phase 22a-4 — Tests for DiscountSchedule / ContractedPrice /
 * AdvancedPricing bundles (12 checks). Uses stub data; no live SOQL.
 */
@IsTest
private class Phase22a4Test {

    private static Integer idCounter = 0;
    private static Id mkId(String prefix3) {
        idCounter++;
        String suffix = String.valueOf(idCounter);
        while (suffix.length() < 12) suffix = '0' + suffix;
        return (Id) (prefix3 + suffix);
    }
    private static Id sId() { return mkId('a0d'); }
    private static Id tId() { return mkId('a0t'); }
    private static Id cId() { return mkId('a0p'); }
    private static Id pid() { return mkId('01t'); }

    private static Map<String, Object> sub(List<Map<String, Object>> recs) {
        return new Map<String, Object>{ 'records' => recs };
    }
    private static Map<String, Object> tier(String name, Decimal lo, Decimal hi, Decimal disc) {
        return new Map<String, Object>{
            'Id' => tId(), 'Name' => name,
            'SBQQ__LowerBound__c' => lo,
            'SBQQ__UpperBound__c' => hi,
            'SBQQ__Discount__c' => disc
        };
    }

    // ── DS-001 ─────────────────────────────────────────────────────

    @IsTest
    static void ds001_flags_overlapping_tiers() {
        Map<String, Object> sched = new Map<String, Object>{
            'Id' => sId(), 'Name' => 'S1',
            'SBQQ__DiscountTiers__r' => sub(new List<Map<String, Object>>{
                tier('T1', 1, 50, 10),
                tier('T2', 40, 100, 20)
            })
        };
        System.assertEquals(1, DiscountScheduleChecksBundle.evaluateDS001(
            new List<Map<String, Object>>{ sched }).size());
    }

    @IsTest
    static void ds001_no_overlap_for_adjacent_tiers() {
        Map<String, Object> sched = new Map<String, Object>{
            'Id' => sId(), 'Name' => 'S1',
            'SBQQ__DiscountTiers__r' => sub(new List<Map<String, Object>>{
                tier('T1', 1, 50, 10),
                tier('T2', 50, 100, 20)
            })
        };
        // Adjacent (touching) tiers don't overlap with strict-less-than test
        System.assertEquals(0, DiscountScheduleChecksBundle.evaluateDS001(
            new List<Map<String, Object>>{ sched }).size());
    }

    // ── DS-002 ─────────────────────────────────────────────────────

    @IsTest
    static void ds002_flags_gap_between_tiers() {
        Map<String, Object> sched = new Map<String, Object>{
            'Id' => sId(), 'Name' => 'S1',
            'SBQQ__DiscountTiers__r' => sub(new List<Map<String, Object>>{
                tier('T1', 1, 50, 10),
                tier('T2', 60, 100, 20)
            })
        };
        System.assertEquals(1, DiscountScheduleChecksBundle.evaluateDS002(
            new List<Map<String, Object>>{ sched }).size());
    }

    // ── DS-003 ─────────────────────────────────────────────────────

    @IsTest
    static void ds003_flags_negative_discount() {
        Map<String, Object> sched = new Map<String, Object>{
            'Id' => sId(), 'Name' => 'S1',
            'SBQQ__DiscountTiers__r' => sub(new List<Map<String, Object>>{
                tier('T1', 1, 100, -5)
            })
        };
        System.assertEquals(1, DiscountScheduleChecksBundle.evaluateDS003(
            new List<Map<String, Object>>{ sched }).size());
    }

    // ── DS-004 ─────────────────────────────────────────────────────

    @IsTest
    static void ds004_aggregates_empty_schedules() {
        Map<String, Object> sched = new Map<String, Object>{
            'Id' => sId(), 'Name' => 'Empty',
            'SBQQ__DiscountTiers__r' => sub(new List<Map<String, Object>>())
        };
        List<DetectorResult> out = DiscountScheduleChecksBundle.evaluateDS004(
            new List<Map<String, Object>>{ sched });
        System.assertEquals(1, out.size());
        System.assertEquals('Info', out[0].severity);
    }

    // ── CP-001 ─────────────────────────────────────────────────────

    @IsTest
    static void cp001_emits_separate_finding_for_expired() {
        Map<String, Object> cp = new Map<String, Object>{
            'Id' => cId(), 'SBQQ__Price__c' => 100,
            'SBQQ__EffectiveDate__c' => Date.today().addYears(-2),
            'SBQQ__ExpirationDate__c' => Date.today().addYears(-1),
            'SBQQ__Account__r' => new Map<String, Object>{ 'Name' => 'Acme' },
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'Widget', 'IsActive' => true }
        };
        List<DetectorResult> out = ContractedPriceChecksBundle.evaluateCP001(
            new List<Map<String, Object>>{ cp });
        System.assertEquals(1, out.size());
        System.assert(out[0].title.contains('expired'));
    }

    @IsTest
    static void cp001_emits_finding_for_zero_price_active() {
        Map<String, Object> cp = new Map<String, Object>{
            'Id' => cId(), 'SBQQ__Price__c' => 0,
            'SBQQ__EffectiveDate__c' => Date.today().addDays(-30),
            'SBQQ__ExpirationDate__c' => Date.today().addDays(30),
            'SBQQ__Account__r' => new Map<String, Object>{ 'Name' => 'Acme' },
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'Widget', 'IsActive' => true }
        };
        List<DetectorResult> out = ContractedPriceChecksBundle.evaluateCP001(
            new List<Map<String, Object>>{ cp });
        System.assertEquals(1, out.size());
        System.assert(out[0].title.contains('zero or null price'));
        System.assertEquals(200, out[0].gapUsd);
    }

    @IsTest
    static void cp001_emits_finding_for_inactive_product() {
        Map<String, Object> cp = new Map<String, Object>{
            'Id' => cId(), 'SBQQ__Price__c' => 100,
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'X', 'IsActive' => false },
            'SBQQ__Account__r' => new Map<String, Object>{ 'Name' => 'Y' }
        };
        List<DetectorResult> out = ContractedPriceChecksBundle.evaluateCP001(
            new List<Map<String, Object>>{ cp });
        System.assertEquals(1, out.size());
        System.assert(out[0].title.contains('inactive products'));
    }

    // ── CP-002 ─────────────────────────────────────────────────────

    @IsTest
    static void cp002_flags_both_dates_null() {
        Map<String, Object> cp = new Map<String, Object>{
            'Id' => cId(), 'SBQQ__Price__c' => 100,
            'SBQQ__EffectiveDate__c' => null, 'SBQQ__ExpirationDate__c' => null,
            'SBQQ__Account__r' => new Map<String, Object>{ 'Name' => 'A' },
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'P' }
        };
        List<DetectorResult> out = ContractedPriceChecksBundle.evaluateCP002(
            new List<Map<String, Object>>{ cp });
        System.assertEquals(1, out.size());
        System.assertEquals('Critical', out[0].severity);
    }

    // ── CP-003 ─────────────────────────────────────────────────────

    @IsTest
    static void cp003_flags_no_source_quote_line() {
        Map<String, Object> cp = new Map<String, Object>{
            'Id' => cId(), 'SBQQ__OriginalQuoteLine__c' => null,
            'SBQQ__Account__r' => new Map<String, Object>{ 'Name' => 'A' },
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'P' }
        };
        System.assertEquals(1, ContractedPriceChecksBundle.evaluateCP003(
            new List<Map<String, Object>>{ cp }).size());
    }

    @IsTest
    static void cp003_skips_when_field_absent() {
        Map<String, Object> cp = new Map<String, Object>{
            'Id' => cId(),
            'SBQQ__Account__r' => new Map<String, Object>{ 'Name' => 'A' },
            'SBQQ__Product__r' => new Map<String, Object>{ 'Name' => 'P' }
            // No SBQQ__OriginalQuoteLine__c key — field not in SELECT
        };
        System.assertEquals(0, ContractedPriceChecksBundle.evaluateCP003(
            new List<Map<String, Object>>{ cp }).size());
    }

    // ── AP-001 ─────────────────────────────────────────────────────

    @IsTest
    static void ap001_flags_mdq_missing_subscription_fields() {
        Map<String, Object> p = new Map<String, Object>{
            'Id' => pid(), 'Name' => 'MDQ Product', 'IsActive' => true,
            'SBQQ__PricingMethod__c' => 'Block',
            'SBQQ__SubscriptionType__c' => null,
            'SBQQ__SubscriptionPricing__c' => null,
            'SBQQ__ChargeType__c' => 'Recurring'
        };
        List<DetectorResult> out = AdvancedPricingChecksBundle.evaluateAP001(
            new List<Map<String, Object>>{ p });
        System.assertEquals(1, out.size());
        System.assertEquals('Critical', out[0].severity);
        System.assert(out[0].title.contains('Subscription Type'));
    }

    // ── AP-002 ─────────────────────────────────────────────────────

    @IsTest
    static void ap002_flags_pot_not_in_any_bundle() {
        Id productId = pid();
        Map<String, Object> p = new Map<String, Object>{
            'Id' => productId, 'Name' => 'X',
            'SBQQ__PricingMethod__c' => 'Percent Of Total'
        };
        // Not in option child set
        System.assertEquals(1, AdvancedPricingChecksBundle.evaluateAP002(
            new List<Map<String, Object>>{ p }, new Set<Id>()).size());
    }

    @IsTest
    static void ap002_no_fire_when_in_bundle() {
        Id productId = pid();
        Map<String, Object> p = new Map<String, Object>{
            'Id' => productId, 'Name' => 'X',
            'SBQQ__PricingMethod__c' => 'Percent Of Total'
        };
        System.assertEquals(0, AdvancedPricingChecksBundle.evaluateAP002(
            new List<Map<String, Object>>{ p }, new Set<Id>{ productId }).size());
    }

    // ── AP-003 ─────────────────────────────────────────────────────

    @IsTest
    static void ap003_flags_cost_pricing_without_pbe() {
        Map<String, Object> p = new Map<String, Object>{
            'Id' => pid(), 'Name' => 'X',
            'SBQQ__PricingMethod__c' => 'Cost'
        };
        System.assertEquals(1, AdvancedPricingChecksBundle.evaluateAP003(
            new List<Map<String, Object>>{ p }, new Set<Id>()).size());
    }

    // ── AP-004 ─────────────────────────────────────────────────────

    @IsTest
    static void ap004_flags_recurring_without_frequency() {
        Map<String, Object> p = new Map<String, Object>{
            'Id' => pid(), 'Name' => 'X',
            'SBQQ__ChargeType__c' => 'Recurring',
            'SBQQ__BillingFrequency__c' => null
        };
        System.assertEquals(1, AdvancedPricingChecksBundle.evaluateAP004(
            new List<Map<String, Object>>{ p }).size());
    }

    // ── AP-005 ─────────────────────────────────────────────────────

    @IsTest
    static void ap005_no_fire_for_under_3_methods() {
        List<Map<String, Object>> ps = new List<Map<String, Object>>();
        ps.add(new Map<String, Object>{ 'Id' => pid(), 'Name' => 'A', 'SBQQ__PricingMethod__c' => 'List' });
        ps.add(new Map<String, Object>{ 'Id' => pid(), 'Name' => 'B', 'SBQQ__PricingMethod__c' => 'Block' });
        System.assertEquals(0, AdvancedPricingChecksBundle.evaluateAP005(ps).size());
    }

    @IsTest
    static void ap005_fires_for_3_plus_methods() {
        List<Map<String, Object>> ps = new List<Map<String, Object>>();
        for (String m : new List<String>{ 'List', 'Block', 'Cost', 'Percent Of Total' }) {
            ps.add(new Map<String, Object>{ 'Id' => pid(), 'Name' => m, 'SBQQ__PricingMethod__c' => m });
        }
        List<DetectorResult> out = AdvancedPricingChecksBundle.evaluateAP005(ps);
        System.assertEquals(1, out.size());
        System.assert(out[0].title.contains('4'));
    }

    // ── Bundles dispatch correctly ────────────────────────────────

    @IsTest
    static void bundles_have_correct_ids() {
        System.assertEquals('DS-BUNDLE', new DiscountScheduleChecksBundle().getDetectorId());
        System.assertEquals('CP-BUNDLE', new ContractedPriceChecksBundle().getDetectorId());
        System.assertEquals('AP-BUNDLE', new AdvancedPricingChecksBundle().getDetectorId());
    }

    @IsTest
    static void bundles_return_empty_on_empty_stubs() {
        DiscountScheduleChecksBundle.testStubRows = new List<Map<String, Object>>();
        ContractedPriceChecksBundle.testStubRows = new List<Map<String, Object>>();
        AdvancedPricingChecksBundle.testStubProducts = new List<Map<String, Object>>();
        AdvancedPricingChecksBundle.testStubOptionChildIds = new Set<Id>();
        AdvancedPricingChecksBundle.testStubPbeProductIds = new Set<Id>();
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        System.assertEquals(0, new DiscountScheduleChecksBundle().run(ctx).size());
        System.assertEquals(0, new ContractedPriceChecksBundle().run(ctx).size());
        System.assertEquals(0, new AdvancedPricingChecksBundle().run(ctx).size());
    }
}
