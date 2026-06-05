/**
 * Exercises each detector's evaluateRow() pure-logic method using
 * synthetic Map inputs. Lets us cover the full calculation path
 * without CPQ being installed in the org.
 *
 * Tests cover: severity tiers (Critical/Warning/Info), null skips,
 * gap-below-threshold skips, full DetectorResult shape.
 */
@isTest
private class DetectorEvaluateTest {

    // ─────────────────────────────────────────────────────────────
    // REN-001 — Renewal Uplift Suppressed
    // ─────────────────────────────────────────────────────────────

    private static Map<String, Object> ren001Row(Decimal netPrice, Decimal originalPrice, Decimal upliftPct) {
        return new Map<String, Object>{
            'lineId' => UserInfo.getUserId(),
            'lineName' => 'QL-001',
            'netPrice' => netPrice,
            'listPrice' => 10000,
            'originalPrice' => originalPrice,
            'upliftPct' => upliftPct,
            'quoteName' => 'Q-001',
            'accountName' => 'Acme',
            'subscriptionId' => UserInfo.getUserId(),
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void ren001_emitsCriticalAboveTenK() {
        DetectorResult r = REN001RenewalUpliftDetector.evaluateRow(ren001Row(50000, 100000, 20));
        System.assertNotEquals(null, r);
        System.assertEquals('Critical', r.severity);
        System.assertEquals('REN-001', r.detectorId);
        System.assertEquals(120000, r.entitledUsd);
        System.assertEquals(70000, r.gapUsd);
        System.assertEquals(0.85, r.recoverabilityScore);
        System.assertNotEquals(null, r.primaryRecord);
    }
    @isTest static void ren001_warningTier() {
        DetectorResult r = REN001RenewalUpliftDetector.evaluateRow(ren001Row(48000, 50000, 10));
        System.assertNotEquals(null, r);
        System.assertEquals('Warning', r.severity);
    }
    @isTest static void ren001_infoTier() {
        DetectorResult r = REN001RenewalUpliftDetector.evaluateRow(ren001Row(9500, 10000, 5));
        System.assertNotEquals(null, r);
        System.assertEquals('Info', r.severity);
    }
    @isTest static void ren001_skipsNullNetPrice() {
        System.assertEquals(null, REN001RenewalUpliftDetector.evaluateRow(ren001Row(null, 10000, 5)));
    }
    @isTest static void ren001_skipsZeroOriginalPrice() {
        System.assertEquals(null, REN001RenewalUpliftDetector.evaluateRow(ren001Row(8000, 0, 5)));
    }
    @isTest static void ren001_skipsNullOriginalPrice() {
        System.assertEquals(null, REN001RenewalUpliftDetector.evaluateRow(ren001Row(8000, null, 5)));
    }
    @isTest static void ren001_skipsGapBelowThreshold() {
        // entitled = 10500, net = 10499.5, gap = 0.5 → skip
        System.assertEquals(null, REN001RenewalUpliftDetector.evaluateRow(ren001Row(10499.5, 10000, 5)));
    }
    @isTest static void ren001_handlesNullUpliftPct() {
        // upliftPct null → treated as 0 → entitled == originalPrice, no gap → skip
        System.assertEquals(null, REN001RenewalUpliftDetector.evaluateRow(ren001Row(10000, 10000, null)));
    }
    @isTest static void ren001_runReturnsEmptyWithoutCpq() {
        REN001RenewalUpliftDetector d = new REN001RenewalUpliftDetector();
        System.assertEquals(0, d.run(new DetectorContext(null, 'USD', 'CPQ')).size());
        System.assertEquals('REN-001', d.getDetectorId());
        System.assertEquals('Renewal Uplift Suppressed', d.getLabel());
        System.assert(d.getAppliesTo().contains('CPQ'));
    }

    // ─────────────────────────────────────────────────────────────
    // REN-002 — Renewal Below Current List Price
    // ─────────────────────────────────────────────────────────────

    private static Map<String, Object> ren002Row(Decimal netPrice, Decimal listPrice) {
        return new Map<String, Object>{
            'lineId' => UserInfo.getUserId(),
            'lineName' => 'QL-002',
            'netPrice' => netPrice,
            'listPrice' => listPrice,
            'quoteName' => 'Q-002',
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void ren002_criticalTier() {
        DetectorResult r = REN002RenewalBelowListDetector.evaluateRow(ren002Row(40000, 60000));
        System.assertNotEquals(null, r);
        System.assertEquals('Critical', r.severity);
        System.assertEquals(20000, r.gapUsd);
    }
    @isTest static void ren002_warningTier() {
        DetectorResult r = REN002RenewalBelowListDetector.evaluateRow(ren002Row(8000, 10000));
        System.assertEquals('Warning', r.severity);
    }
    @isTest static void ren002_infoTier() {
        DetectorResult r = REN002RenewalBelowListDetector.evaluateRow(ren002Row(950, 1000));
        System.assertEquals('Info', r.severity);
    }
    @isTest static void ren002_skipsNulls() {
        System.assertEquals(null, REN002RenewalBelowListDetector.evaluateRow(ren002Row(null, 1000)));
        System.assertEquals(null, REN002RenewalBelowListDetector.evaluateRow(ren002Row(1000, null)));
    }
    @isTest static void ren002_skipsGapBelowThreshold() {
        System.assertEquals(null, REN002RenewalBelowListDetector.evaluateRow(ren002Row(999.5, 1000)));
    }
    @isTest static void ren002_runReturnsEmptyWithoutCpq() {
        REN002RenewalBelowListDetector d = new REN002RenewalBelowListDetector();
        System.assertEquals(0, d.run(new DetectorContext(null, 'USD', 'CPQ')).size());
        System.assertEquals('REN-002', d.getDetectorId());
        System.assertEquals('Renewal Below Current List Price', d.getLabel());
    }

    // ─────────────────────────────────────────────────────────────
    // DSC-FOR-001 — Promo Discount Roll-off Failure
    // ─────────────────────────────────────────────────────────────

    private static Map<String, Object> dsc001Row(Decimal discount, Decimal listPrice, Decimal qty) {
        return new Map<String, Object>{
            'lineId' => UserInfo.getUserId(),
            'lineName' => 'QL-DSC',
            'discount' => discount,
            'listPrice' => listPrice,
            'netPrice' => (listPrice != null && discount != null) ? listPrice * (1 - discount/100) : null,
            'qty' => qty,
            'quoteName' => 'Q-DSC',
            'scheduleName' => 'Holiday-2024',
            'scheduleEndDate' => Date.newInstance(2024, 12, 31),
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void dsc001_criticalTier() {
        DetectorResult r = DSC001PromoRolloffDetector.evaluateRow(dsc001Row(25, 50000, 1));
        System.assertNotEquals(null, r);
        System.assertEquals('Critical', r.severity);
        System.assertNotEquals(null, r.metadata.get('scheduleName'));
    }
    @isTest static void dsc001_warningTier() {
        DetectorResult r = DSC001PromoRolloffDetector.evaluateRow(dsc001Row(15, 10000, 1));
        System.assertEquals('Warning', r.severity);
    }
    @isTest static void dsc001_infoTier() {
        DetectorResult r = DSC001PromoRolloffDetector.evaluateRow(dsc001Row(5, 1000, 1));
        System.assertEquals('Info', r.severity);
    }
    @isTest static void dsc001_skipsAllNulls() {
        System.assertEquals(null, DSC001PromoRolloffDetector.evaluateRow(dsc001Row(null, 100, 1)));
        System.assertEquals(null, DSC001PromoRolloffDetector.evaluateRow(dsc001Row(10, null, 1)));
        System.assertEquals(null, DSC001PromoRolloffDetector.evaluateRow(dsc001Row(10, 100, null)));
    }
    @isTest static void dsc001_skipsTinyOverDiscount() {
        // 100 list × 1% × 1 = $1 — skip
        System.assertEquals(null, DSC001PromoRolloffDetector.evaluateRow(dsc001Row(1, 100, 1)));
    }
    @isTest static void dsc001_handlesNullNetPrice() {
        Map<String, Object> row = dsc001Row(10, 1000, 1);
        row.put('netPrice', null);
        DetectorResult r = DSC001PromoRolloffDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
        System.assertEquals(0, r.realizedUsd);
    }
    @isTest static void dsc001_runReturnsEmptyWithoutCpq() {
        DSC001PromoRolloffDetector d = new DSC001PromoRolloffDetector();
        System.assertEquals(0, d.run(new DetectorContext(null, 'USD', 'CPQ')).size());
        System.assertEquals('DSC-FOR-001', d.getDetectorId());
    }

    // ─────────────────────────────────────────────────────────────
    // QL-FOR-001 — Bundle Required Option at $0
    // ─────────────────────────────────────────────────────────────

    private static Map<String, Object> ql001Row(Decimal listPrice, Decimal qty) {
        return new Map<String, Object>{
            'lineId' => UserInfo.getUserId(),
            'lineName' => 'QL-BUNDLE',
            'listPrice' => listPrice,
            'qty' => qty,
            'quoteName' => 'Q-BUNDLE',
            'productName' => 'Premium-Addon',
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void ql001_criticalTier() {
        DetectorResult r = QL001BundleZeroPriceDetector.evaluateRow(ql001Row(5000, 10));
        System.assertNotEquals(null, r);
        System.assertEquals('Critical', r.severity);
        System.assertEquals(50000, r.entitledUsd);
        System.assertEquals(0, r.realizedUsd);
        System.assertEquals(50000, r.gapUsd);
    }
    @isTest static void ql001_warningTier() {
        DetectorResult r = QL001BundleZeroPriceDetector.evaluateRow(ql001Row(2000, 1));
        System.assertEquals('Warning', r.severity);
    }
    @isTest static void ql001_infoTier() {
        DetectorResult r = QL001BundleZeroPriceDetector.evaluateRow(ql001Row(500, 1));
        System.assertEquals('Info', r.severity);
    }
    @isTest static void ql001_skipsNulls() {
        System.assertEquals(null, QL001BundleZeroPriceDetector.evaluateRow(ql001Row(null, 1)));
        System.assertEquals(null, QL001BundleZeroPriceDetector.evaluateRow(ql001Row(1000, null)));
    }
    @isTest static void ql001_skipsTinyExpected() {
        System.assertEquals(null, QL001BundleZeroPriceDetector.evaluateRow(ql001Row(0.5, 1)));
    }
    @isTest static void ql001_runReturnsEmptyWithoutCpq() {
        QL001BundleZeroPriceDetector d = new QL001BundleZeroPriceDetector();
        System.assertEquals(0, d.run(new DetectorContext(null, 'USD', 'CPQ')).size());
        System.assertEquals('QL-FOR-001', d.getDetectorId());
    }

    // ─────────────────────────────────────────────────────────────
    // ORD-FOR-001 — Order Activated, No Billing Schedule
    // ─────────────────────────────────────────────────────────────

    private static Map<String, Object> ord001Row(Decimal totalAmount) {
        return new Map<String, Object>{
            'orderId' => UserInfo.getUserId(),
            'orderNumber' => 'O-001',
            'totalAmount' => totalAmount,
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void ord001_criticalTier() {
        DetectorResult r = ORD001OrderNoBillingDetector.evaluateRow(ord001Row(100000));
        System.assertNotEquals(null, r);
        System.assertEquals('Critical', r.severity);
        System.assertEquals(100000, r.entitledUsd);
        System.assertEquals(0, r.realizedUsd);
        System.assertEquals(0.95, r.recoverabilityScore);
    }
    @isTest static void ord001_warningTier() {
        DetectorResult r = ORD001OrderNoBillingDetector.evaluateRow(ord001Row(10000));
        System.assertEquals('Warning', r.severity);
    }
    @isTest static void ord001_infoTier() {
        DetectorResult r = ORD001OrderNoBillingDetector.evaluateRow(ord001Row(1000));
        System.assertEquals('Info', r.severity);
    }
    @isTest static void ord001_skipsNull() {
        System.assertEquals(null, ORD001OrderNoBillingDetector.evaluateRow(ord001Row(null)));
    }
    @isTest static void ord001_skipsZero() {
        System.assertEquals(null, ORD001OrderNoBillingDetector.evaluateRow(ord001Row(0)));
    }
    @isTest static void ord001_runReturnsEmptyWithoutNamespace() {
        ORD001OrderNoBillingDetector d = new ORD001OrderNoBillingDetector();
        System.assertEquals(0, d.run(new DetectorContext(null, 'USD', 'CPQ+Billing')).size());
        System.assertEquals('ORD-FOR-001', d.getDetectorId());
        System.assert(d.getAppliesTo().contains('CPQ+Billing'));
    }

    // ─────────────────────────────────────────────────────────────
    // Stub-injection path tests — exercise run() loop body
    // ─────────────────────────────────────────────────────────────

    @isTest static void ren002_runWithStubRows_emitsFindings() {
        REN002RenewalBelowListDetector.testStubRows = new List<Map<String, Object>>{
            ren002Row(8000, 10000),    // emits
            ren002Row(null, 1000),     // skipped
            ren002Row(999.5, 1000)     // skipped
        };
        REN002RenewalBelowListDetector d = new REN002RenewalBelowListDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        System.assertEquals(1, r.size());
        REN002RenewalBelowListDetector.testStubRows = null;
    }

    @isTest static void dsc001_runWithStubRows_emitsFindings() {
        DSC001PromoRolloffDetector.testStubRows = new List<Map<String, Object>>{
            dsc001Row(15, 10000, 1),     // emits
            dsc001Row(null, 100, 1),     // skipped
            dsc001Row(1, 100, 1)         // skipped (tiny)
        };
        DSC001PromoRolloffDetector d = new DSC001PromoRolloffDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        System.assertEquals(1, r.size());
        DSC001PromoRolloffDetector.testStubRows = null;
    }

    @isTest static void ql001_runWithStubRows_emitsFindings() {
        QL001BundleZeroPriceDetector.testStubRows = new List<Map<String, Object>>{
            ql001Row(2000, 1),    // emits
            ql001Row(null, 1),    // skipped
            ql001Row(0.5, 1)      // skipped (tiny)
        };
        QL001BundleZeroPriceDetector d = new QL001BundleZeroPriceDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        System.assertEquals(1, r.size());
        QL001BundleZeroPriceDetector.testStubRows = null;
    }

    @isTest static void ord001_runWithStubRows_emitsFindings() {
        ORD001OrderNoBillingDetector.testStubRows = new List<Map<String, Object>>{
            ord001Row(100000),  // emits Critical
            ord001Row(null),    // skipped
            ord001Row(0)        // skipped
        };
        ORD001OrderNoBillingDetector d = new ORD001OrderNoBillingDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ+Billing'));
        System.assertEquals(1, r.size());
        System.assertEquals('Critical', r[0].severity);
        ORD001OrderNoBillingDetector.testStubRows = null;
    }

    // ─────────────────────────────────────────────────────────────
    // Phase 9: SObject-stub paths removed. Detectors are now Map-only
    // (host org doesn't need CPQ installed). The unwrap() helpers
    // handle null/empty/non-Map relationship values gracefully —
    // these tests exercise that defensive path with empty input.
    // ─────────────────────────────────────────────────────────────

    @isTest static void ren001_unwrap_handlesEmptyMap() {
        Map<String, Object> out = REN001RenewalUpliftDetector.unwrap(new Map<String, Object>());
        System.assertEquals(null, REN001RenewalUpliftDetector.evaluateRow(out),
            'Empty raw row should produce no finding');
    }
    @isTest static void ren001_unwrap_handlesNullInput() {
        Map<String, Object> out = REN001RenewalUpliftDetector.unwrap(null);
        System.assertNotEquals(null, out, 'Null input → empty map, not null');
    }

    @isTest static void ren002_unwrap_handlesEmptyMap() {
        Map<String, Object> out = REN002RenewalBelowListDetector.unwrap(new Map<String, Object>());
        System.assertEquals(null, REN002RenewalBelowListDetector.evaluateRow(out));
    }

    @isTest static void dsc001_unwrap_handlesEmptyMap() {
        Map<String, Object> out = DSC001PromoRolloffDetector.unwrap(new Map<String, Object>());
        System.assertEquals(null, DSC001PromoRolloffDetector.evaluateRow(out));
    }

    @isTest static void ql001_unwrap_handlesEmptyMap() {
        Map<String, Object> out = QL001BundleZeroPriceDetector.unwrap(new Map<String, Object>());
        System.assertEquals(null, QL001BundleZeroPriceDetector.evaluateRow(out));
    }

    @isTest static void ord001_evaluateRow_handlesNullAmount() {
        // ORD001 has no unwrap helper — the map is built inline in run().
        // Pass a row without totalAmount; evaluateRow returns null.
        Map<String, Object> row = new Map<String, Object>{ 'orderId' => null, 'orderNumber' => 'X' };
        System.assertEquals(null, ORD001OrderNoBillingDetector.evaluateRow(row));
    }

    /**
     * Drive ORD001's full order-iteration path via testStubOrders.
     * Bypasses the SOQL but exercises the orderIds extraction, billing
     * lookup (try/catch handles missing SBCF__ namespace), and the
     * per-order evaluateRow loop. Without this test the coverage drops
     * below 75% because testStubRows short-circuits at the top.
     */
    @isTest static void ord001_runWithStubOrders_drivesFullLoop() {
        Id syntheticId = '801000000000001AAA';
        Map<String, Object> ord1 = new Map<String, Object>{
            'Id' => syntheticId,
            'OrderNumber' => 'O-001',
            'TotalAmount' => 100000
        };
        CurrencyContext.addToTestMap(ord1, 'USD');
        Map<String, Object> ord2 = new Map<String, Object>{
            // No Id → loop should skip the billing-lookup short-circuit
            'OrderNumber' => 'O-002',
            'TotalAmount' => 5000
        };
        CurrencyContext.addToTestMap(ord2, 'USD');
        ORD001OrderNoBillingDetector.testStubOrders = new List<Map<String, Object>>{ ord1, ord2 };
        ORD001OrderNoBillingDetector d = new ORD001OrderNoBillingDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ+Billing'));
        Test.stopTest();
        ORD001OrderNoBillingDetector.testStubOrders = null;
        // Both stub orders have totalAmount > 0 and aren't in the billing
        // set (the lookup runs but SBCF__ namespace isn't installed →
        // empty result). Both produce findings.
        System.assertEquals(2, r.size(), 'Both stub orders should emit findings');
    }

    // OrgPrismTestDataFactory coverage
    @isTest static void factory_buildsScansAndFindings() {
        ForensicScan__c scan = OrgPrismTestDataFactory.makeScan('CPQ');
        System.assertNotEquals(null, scan.Id);
        System.assertEquals('Running', scan.Status__c);
        ForensicFinding__c f = OrgPrismTestDataFactory.makeFinding(scan.Id, 'REN-001');
        System.assertEquals(scan.Id, f.ForensicScan__c);
        System.assertEquals('REN-001', f.DetectorId__c);
        Boolean cpq = OrgPrismTestDataFactory.isCpqInstalled();
        System.assertEquals(false, cpq, 'CPQ not installed in this test org');
    }
}
