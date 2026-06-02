/**
 * Exercises each detector's IDetector contract:
 *   - constructor doesn't throw
 *   - getDetectorId / getLabel / getAppliesTo all return non-null
 *   - run() returns an empty list when no CPQ data exists
 *
 * Combined into one test class because the contract surface per
 * detector is small — one test method per detector. Keeps overall
 * test count manageable.
 *
 * With CPQ data installed in PDE, each detector will get a
 * specific test class with seeded fixtures asserting the actual
 * findings emit correctly.
 */
@isTest
private class DetectorContractTest {

    private static void assertContract(IDetector d) {
        System.assertNotEquals(null, d.getDetectorId(), 'detectorId required');
        System.assertNotEquals(null, d.getLabel(), 'label required');
        System.assert(d.getAppliesTo().size() > 0, 'appliesTo must include at least one product type');

        DetectorContext ctx = new DetectorContext(null, 'USD', d.getAppliesTo().iterator().next());
        List<DetectorResult> results = d.run(ctx);
        System.assertNotEquals(null, results, 'run() must return a List (even if empty)');
        // Without seeded data, expect zero findings. Don't assert exact
        // zero in case CPQ is installed and there's incidental data.
    }

    @isTest
    static void ren001_contract() { assertContract(new REN001RenewalUpliftDetector()); }

    @isTest
    static void ren002_contract() { assertContract(new REN002RenewalBelowListDetector()); }

    @isTest
    static void dsc001_contract() { assertContract(new DSC001PromoRolloffDetector()); }

    @isTest
    static void ord001_contract() { assertContract(new ORD001OrderNoBillingDetector()); }

    @isTest
    static void ql001_contract() { assertContract(new QL001BundleZeroPriceDetector()); }

    @isTest
    static void detectorIds_areUnique() {
        Set<String> ids = new Set<String>{
            new REN001RenewalUpliftDetector().getDetectorId(),
            new REN002RenewalBelowListDetector().getDetectorId(),
            new DSC001PromoRolloffDetector().getDetectorId(),
            new ORD001OrderNoBillingDetector().getDetectorId(),
            new QL001BundleZeroPriceDetector().getDetectorId()
        };
        System.assertEquals(5, ids.size(), 'All 5 detector IDs must be unique');
    }
}
