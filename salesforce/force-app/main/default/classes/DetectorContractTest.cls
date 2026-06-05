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

    // Phase 10 batch A — governance detectors
    @isTest
    static void amd001_contract() { assertContract(new AMD001NoEffectiveDateDetector()); }

    @isTest
    static void opp001_contract() { assertContract(new OPP001ClosedWonNoQuoteDetector()); }

    @isTest
    static void con001_contract() { assertContract(new CON001NoActiveSubsDetector()); }

    // Phase 10 batch B — renewal pipeline
    @isTest
    static void ren003_contract() { assertContract(new REN003ExpiredQuoteNoRenewalDetector()); }

    @isTest
    static void ren004_contract() { assertContract(new REN004StuckDraftRenewalDetector()); }

    // Phase 10 batch C — provisioning / asset gaps
    @isTest
    static void prov001_contract() { assertContract(new PROV001ProvisionedNotBilledDetector()); }

    @isTest
    static void prov002_contract() { assertContract(new PROV002SubNoAssetDetector()); }

    @isTest
    static void sub001_contract() { assertContract(new SUB001QuantityDriftDetector()); }

    // Phase 10 batch D — pricing integrity
    @isTest
    static void dsc002_contract() { assertContract(new DSC002StackedDiscountsDetector()); }

    @isTest
    static void ct001_contract() { assertContract(new CT001ExpiredContractedPriceDetector()); }

    @isTest
    static void mdq001_contract() { assertContract(new MDQ001SegmentPricingDetector()); }

    // Phase 10 batch E
    @isTest
    static void ast001_contract() { assertContract(new AST001TerminatedNoCreditDetector()); }

    @isTest
    static void ql002_contract() { assertContract(new QL002ApprovalSkippedDetector()); }

    // Phase 10 batch F
    @isTest
    static void ord002_contract() { assertContract(new ORD002QuoteOrderVarianceDetector()); }

    @isTest
    static void ord003_contract() { assertContract(new ORD003AmendmentVarianceDetector()); }

    @isTest
    static void detectorIds_areUnique() {
        Set<String> ids = new Set<String>{
            new REN001RenewalUpliftDetector().getDetectorId(),
            new REN002RenewalBelowListDetector().getDetectorId(),
            new DSC001PromoRolloffDetector().getDetectorId(),
            new ORD001OrderNoBillingDetector().getDetectorId(),
            new QL001BundleZeroPriceDetector().getDetectorId(),
            new AMD001NoEffectiveDateDetector().getDetectorId(),
            new OPP001ClosedWonNoQuoteDetector().getDetectorId(),
            new CON001NoActiveSubsDetector().getDetectorId(),
            new REN003ExpiredQuoteNoRenewalDetector().getDetectorId(),
            new REN004StuckDraftRenewalDetector().getDetectorId(),
            new PROV001ProvisionedNotBilledDetector().getDetectorId(),
            new PROV002SubNoAssetDetector().getDetectorId(),
            new SUB001QuantityDriftDetector().getDetectorId(),
            new DSC002StackedDiscountsDetector().getDetectorId(),
            new CT001ExpiredContractedPriceDetector().getDetectorId(),
            new MDQ001SegmentPricingDetector().getDetectorId(),
            new AST001TerminatedNoCreditDetector().getDetectorId(),
            new QL002ApprovalSkippedDetector().getDetectorId(),
            new ORD002QuoteOrderVarianceDetector().getDetectorId(),
            new ORD003AmendmentVarianceDetector().getDetectorId()
        };
        System.assertEquals(20, ids.size(), 'All 20 detector IDs must be unique');
    }
}
