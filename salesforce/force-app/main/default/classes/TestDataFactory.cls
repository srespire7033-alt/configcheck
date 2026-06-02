/**
 * Shared test data builders. Tests for detectors that depend on CPQ
 * objects (SBQQ__) skip data insertion when the namespace isn't
 * installed — instead they just assert the detector returns an
 * empty list (no data, no findings).
 *
 * In a real CPQ-installed test org, tests can insert real records and
 * assert specific findings emit. Until then, these tests prove the
 * framework + detector classes COMPILE and run without throwing.
 */
@isTest
public class TestDataFactory {

    /** A bare-minimum test scan record. */
    public static ForensicScan__c makeScan(String productType) {
        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Running',
            ProductType__c = productType,
            StartedAt__c = System.now()
        );
        insert s;
        return s;
    }

    /** A test finding tied to a scan. */
    public static ForensicFinding__c makeFinding(Id scanId, String detectorId) {
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c = scanId,
            DetectorId__c = detectorId,
            Severity__c = 'Warning',
            EntitledUsd__c = 1000,
            RealizedUsd__c = 500,
            GapUsd__c = 500,
            RecoverabilityScore__c = 0.8,
            Title__c = 'Test finding for ' + detectorId,
            Status__c = 'Open',
            DetectedAt__c = System.now()
        );
        insert f;
        return f;
    }

    /** True if the SBQQ__ (CPQ) namespace is installed. */
    public static Boolean isCpqInstalled() {
        return Schema.getGlobalDescribe().containsKey('SBQQ__QuoteLine__c');
    }
}
