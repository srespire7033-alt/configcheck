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
        System.assert(byId.containsKey('PB-003'), 'PB-003 should fire');
        System.assert(byId.containsKey('PB-004'), 'PB-004 should fire');
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
        // Phase 24f: PB-002 moved to CustomDetector__mdt (per-record, no cap).
        // PB-003 still uses the summary path with the 25-ref cap, so we
        // exercise the same supporting-records behavior via PB-003.
        List<Map<String, Object>> ps = new List<Map<String, Object>>();
        for (Integer i = 0; i < 30; i++) ps.add(product('P' + i, null, 'desc', 'F'));
        ProductHygieneChecksBundle.testStubProducts = ps;
        ProductHygieneChecksBundle.testStubPbeProducts = new List<Map<String, Object>>();
        ProductHygieneChecksBundle.testStubUsedProducts = new List<Map<String, Object>>();
        ProductHygieneChecksBundle.testStubSbqqPresent = false;

        List<DetectorResult> rs = new ProductHygieneChecksBundle().run(ctx());
        DetectorResult pb003 = null;
        for (DetectorResult r : rs) if (r.detectorId == 'PB-003') pb003 = r;
        System.assertNotEquals(null, pb003);
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
    }
}
