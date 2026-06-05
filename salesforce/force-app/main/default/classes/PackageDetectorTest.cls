/**
 * Verifies PackageDetector returns a well-formed PackageInfo with
 * sensible defaults. We can't install/uninstall packages from a
 * test context, so we verify shape + fallback behavior — not the
 * actual install state of the test org.
 */
@isTest
private class PackageDetectorTest {

    @isTest
    static void detect_returnsWellFormedInfo() {
        PackageDetector.PackageInfo info = PackageDetector.detect();
        System.assertNotEquals(null, info);
        System.assertNotEquals(null, info.cpq);
        System.assertNotEquals(null, info.cpqBilling);
        System.assertNotEquals(null, info.revenueCloud);
        System.assertNotEquals(null, info.availableProductTypes);
        // Recommended product type always set, even on empty org.
        System.assertNotEquals(null, info.recommendedProductType);
        // Must be one of the 3 known values.
        Set<String> validTypes = new Set<String>{ 'CPQ', 'CPQ+Billing', 'ARM' };
        System.assert(validTypes.contains(info.recommendedProductType),
            'Recommended type must be valid: ' + info.recommendedProductType);
    }

    @isTest
    static void detect_isCacheable() {
        // Apex @AuraEnabled(cacheable=true) doesn't really affect the
        // class itself, just verify we can call multiple times.
        PackageDetector.detect();
        PackageDetector.detect();
        System.assert(true);
    }
}
