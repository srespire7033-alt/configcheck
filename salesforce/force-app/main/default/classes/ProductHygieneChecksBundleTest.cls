@isTest
private class ProductHygieneChecksBundleTest {

    private static Integer ic = 0;
    private static Id mkId(String prefix3) {
        ic++;
        String s = String.valueOf(ic);
        while (s.length() < 12) s = '0' + s;
        return (Id) (prefix3 + s);
    }
    private static DetectorContext ctx() { return new DetectorContext(null, 'USD', null); }

    private static Map<String, Object> product(String name, String code, String descText, String family) {
        return new Map<String, Object>{
            'Id' => mkId('01t'), 'Name' => name, 'ProductCode' => code,
            'Description' => descText, 'Family' => family
        };
    }

    @isTest
    static void emitsOneFindingPerCheckEvenWithManyOffenders() {
        // 4 products, each with at least one hygiene issue + missing pbe
        List<Map<String, Object>> ps = new List<Map<String, Object>>{
            product('P1', null, null, null),
            product('P2', 'CODE-2', null, null),
            product('P3', null, 'desc', 'Software'),
            product('P4', 'CODE-4', 'desc', null)
        };
        ProductHygieneChecksBundle.testStubProducts = ps;
        ProductHygieneChecksBundle.testStubPbeProducts = new List<Map<String, Object>>();
        ProductHygieneChecksBundle.testStubUsedProducts = new List<Map<String, Object>>();
        ProductHygieneChecksBundle.testStubSbqqPresent = true;

        List<DetectorResult> rs = new ProductHygieneChecksBundle().run(ctx());
        Map<String, DetectorResult> byId = new Map<String, DetectorResult>();
        for (DetectorResult r : rs) byId.put(r.detectorId, r);

        // 4 bundle checks should each emit at most one finding.
        // PB-002 lives in CustomDetector__mdt as of Phase 24f pilot,
        // so the bundle no longer dispatches it.
        System.assert(byId.containsKey('PB-001'), 'PB-001 should fire');
        System.assert(!byId.containsKey('PB-002'), 'PB-002 migrated to CustomDetector__mdt');
        System.assert(!byId.containsKey('PB-003'), 'PB-003 migrated to CustomDetector__mdt');
        System.assert(!byId.containsKey('PB-004'), 'PB-004 migrated to CustomDetector__mdt');
        System.assert(byId.containsKey('UA-001'), 'UA-001 should fire');

        // PB-001: all 4 products lack PricebookEntry → 1 primary + 3 supporting = 4 total
        System.assertEquals(4, 1 + byId.get('PB-001').supportingRecords.size(), 'PB-001 should have 4 affected, in 1 finding');
        // Verify primaryRecord is set
        System.assertNotEquals(null, byId.get('PB-001').primaryRecord);
    }

    @isTest
    static void zeroOffenders_emitsNoFindings() {
        List<Map<String, Object>> ps = new List<Map<String, Object>>{
            product('Healthy', 'OK', 'has desc', 'Software')
        };
        Id healthyId = (Id) ps[0].get('Id');
        ProductHygieneChecksBundle.testStubProducts = ps;
        ProductHygieneChecksBundle.testStubPbeProducts = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Product2Id' => healthyId }
        };
        ProductHygieneChecksBundle.testStubUsedProducts = new List<Map<String, Object>>{
            new Map<String, Object>{ 'SBQQ__Product__c' => healthyId }
        };
        ProductHygieneChecksBundle.testStubSbqqPresent = true;

        List<DetectorResult> rs = new ProductHygieneChecksBundle().run(ctx());
        System.assertEquals(0, rs.size(), 'A fully-healthy product should produce no findings');
    }

    @isTest
    static void ua001_skipsWhenSbqqAbsent() {
        ProductHygieneChecksBundle.testStubProducts = new List<Map<String, Object>>{ product('P', null, null, null) };
        ProductHygieneChecksBundle.testStubPbeProducts = new List<Map<String, Object>>();
        ProductHygieneChecksBundle.testStubUsedProducts = new List<Map<String, Object>>();
        ProductHygieneChecksBundle.testStubSbqqPresent = false;

        List<DetectorResult> rs = new ProductHygieneChecksBundle().run(ctx());
        for (DetectorResult r : rs) {
            System.assertNotEquals('UA-001', r.detectorId, 'UA-001 must not fire when SBQQ surface is absent');
        }
    }

    @isTest
    static void supportingRecordsCappedAt25_pb003() {
        // Phase 24g: PB-003 moved to CustomDetector__mdt (per-record, no cap),
        // so bundle.run() no longer dispatches PB-003. We still exercise the
        // evaluator directly to keep coverage on the legacy summary path
        // (it's retained as dead code for one cycle, same as the pilot).
        List<Map<String, Object>> ps = new List<Map<String, Object>>();
        for (Integer i = 0; i < 30; i++) ps.add(product('P' + i, null, 'desc', 'F'));

        List<DetectorResult> rs = ProductHygieneChecksBundle.evaluatePB003(ps);
        System.assertEquals(1, rs.size(), 'evaluatePB003 still emits one summary finding');
        DetectorResult pb003 = rs[0];
        // 1 primary + max 24 supporting = 25 affected refs visible
        System.assert(pb003.supportingRecords.size() <= 24, 'supportingRecords capped');
        // Title should still report the full 30
        System.assert(pb003.title.startsWith('30 '), 'Title should show total offender count, not just cap');
    }

    @isTest
    static void directHelpers_emptyInputs() {
        List<Map<String, Object>> e = new List<Map<String, Object>>();
        System.assertEquals(0, ProductHygieneChecksBundle.evaluatePB001(e, new Set<Id>()).size());
        System.assertEquals(0, ProductHygieneChecksBundle.evaluatePB002(e).size());
        System.assertEquals(0, ProductHygieneChecksBundle.evaluatePB003(e).size());
        System.assertEquals(0, ProductHygieneChecksBundle.evaluatePB004(e).size());
        System.assertEquals(0, ProductHygieneChecksBundle.evaluateUA001(e, new Set<Id>()).size());
        System.assertEquals(0, ProductHygieneChecksBundle.evaluatePB005(e, new Map<Id, Integer>()).size());
        System.assertEquals(0, ProductHygieneChecksBundle.evaluatePB006(e).size());
    }

    @isTest
    static void pb005_flags_products_with_more_than_five_tiers() {
        Map<String, Object> heavy = product('Heavy', 'H', 'd', 'F');
        Map<String, Object> normal = product('Normal', 'N', 'd', 'F');
        List<Map<String, Object>> ps = new List<Map<String, Object>>{ heavy, normal };
        Map<Id, Integer> counts = new Map<Id, Integer>{
            (Id) heavy.get('Id') => 12,
            (Id) normal.get('Id') => 3
        };
        List<DetectorResult> rs = ProductHygieneChecksBundle.evaluatePB005(ps, counts);
        System.assertEquals(1, rs.size());
        DetectorResult dr = rs[0];
        System.assertEquals('PB-005', dr.detectorId);
        System.assert(dr.title.startsWith('1 '), 'Only heavy product (>5 tiers) should be flagged');
    }

    @isTest
    static void pb005_no_proliferation_no_finding() {
        Map<String, Object> p = product('OK', 'OK', 'd', 'F');
        Map<Id, Integer> counts = new Map<Id, Integer>{ (Id) p.get('Id') => 5 };
        System.assertEquals(0, ProductHygieneChecksBundle.evaluatePB005(
            new List<Map<String, Object>>{ p }, counts).size(),
            'Exactly 5 tiers is at the threshold — not flagged');
    }

    @isTest
    static void pb006_flags_renewal_only_active_product() {
        List<Map<String, Object>> ps = new List<Map<String, Object>>{
            product('Widget (Renewal Only)', 'WID', 'd', 'F'),
            product('Legacy Maintenance Plan', 'LMP', 'd', 'F'),
            product('Premium Widget', 'PW', 'd', 'F')
        };
        List<DetectorResult> rs = ProductHygieneChecksBundle.evaluatePB006(ps);
        System.assertEquals(1, rs.size());
        System.assertEquals('PB-006', rs[0].detectorId);
        System.assert(rs[0].title.startsWith('2 '), 'Two retirement-named products should be flagged');
    }

    @isTest
    static void pb006_case_insensitive_match() {
        List<Map<String, Object>> ps = new List<Map<String, Object>>{
            product('DEPRECATED ITEM', 'D', 'd', 'F'),
            product('Some Obsolete Thing', 'O', 'd', 'F'),
            product('Do Not Sell SKU', 'NS', 'd', 'F')
        };
        List<DetectorResult> rs = ProductHygieneChecksBundle.evaluatePB006(ps);
        System.assertEquals(1, rs.size());
        System.assert(rs[0].title.startsWith('3 '));
    }

    @isTest
    static void pb006_clean_names_no_findings() {
        List<Map<String, Object>> ps = new List<Map<String, Object>>{
            product('Premium Subscription', 'PS', 'd', 'F'),
            product('Annual Plan', 'AP', 'd', 'F')
        };
        System.assertEquals(0, ProductHygieneChecksBundle.evaluatePB006(ps).size());
    }

    @isTest
    static void pb006_blank_name_skipped() {
        List<Map<String, Object>> ps = new List<Map<String, Object>>{
            product(null, 'X', 'd', 'F')
        };
        System.assertEquals(0, ProductHygieneChecksBundle.evaluatePB006(ps).size());
    }

    @isTest
    static void pb005_via_bundle_with_stub_counts() {
        Map<String, Object> heavy = product('Heavy', 'OK', 'desc', 'F');
        Id heavyId = (Id) heavy.get('Id');
        ProductHygieneChecksBundle.testStubProducts = new List<Map<String, Object>>{ heavy };
        ProductHygieneChecksBundle.testStubPbeProducts = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Product2Id' => heavyId }
        };
        ProductHygieneChecksBundle.testStubUsedProducts = new List<Map<String, Object>>{
            new Map<String, Object>{ 'SBQQ__Product__c' => heavyId }
        };
        ProductHygieneChecksBundle.testStubSbqqPresent = true;
        ProductHygieneChecksBundle.testStubBlockPriceCounts = new Map<Id, Integer>{ heavyId => 9 };

        List<DetectorResult> rs = new ProductHygieneChecksBundle().run(ctx());
        ProductHygieneChecksBundle.testStubBlockPriceCounts = null;
        Boolean found = false;
        for (DetectorResult r : rs) if (r.detectorId == 'PB-005') { found = true; break; }
        System.assert(found, 'PB-005 should fire via bundle path');
    }
}
