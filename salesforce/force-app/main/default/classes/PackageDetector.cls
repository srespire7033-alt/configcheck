/**
 * Detects which Salesforce product packages are installed in the org
 * by checking for namespace-specific SObject types in the global
 * schema. Works without Tooling API or InstalledSubscriberPackage
 * (which need elevated permissions consultants often lack).
 *
 * Signals:
 *   CPQ            → SBQQ__QuoteLine__c exists
 *   CPQ + Billing  → SBCF__BillingSchedule__c exists (implies CPQ too)
 *   Revenue Cloud  → ProductSellingModel exists (standard object, not
 *                    namespaced; ships with Subscription Management /
 *                    Revenue Cloud)
 */
public with sharing class PackageDetector {

    public class PackageInfo {
        @AuraEnabled public Boolean cpq;
        @AuraEnabled public Boolean cpqBilling;
        @AuraEnabled public Boolean revenueCloud;
        /** The recommended product type for new scans, given what's installed. */
        @AuraEnabled public String recommendedProductType;
        /** Human-readable list, e.g. ["CPQ", "CPQ + Billing"] */
        @AuraEnabled public List<String> availableProductTypes;
    }

    /** Cached describe lookup — Schema.getGlobalDescribe is expensive,
     *  so do it once per request. */
    private static Map<String, Schema.SObjectType> globalDescribe;
    private static Map<String, Schema.SObjectType> describe() {
        if (globalDescribe == null) globalDescribe = Schema.getGlobalDescribe();
        return globalDescribe;
    }

    @AuraEnabled(cacheable=true)
    public static PackageInfo detect() {
        PackageInfo info = new PackageInfo();
        info.cpq = describe().containsKey('SBQQ__QuoteLine__c');
        info.cpqBilling = describe().containsKey('SBCF__BillingSchedule__c');
        info.revenueCloud = describe().containsKey('ProductSellingModel');

        info.availableProductTypes = new List<String>();
        if (info.cpq) info.availableProductTypes.add('CPQ');
        if (info.cpq && info.cpqBilling) info.availableProductTypes.add('CPQ+Billing');
        if (info.revenueCloud) info.availableProductTypes.add('ARM');

        // Recommended: prefer the most-feature-complete bundle present.
        // CPQ+Billing > ARM > CPQ. (CPQ+Billing implies the consultant
        // wants to audit the full quote-to-cash; ARM is a separate
        // product line; CPQ alone is the basic case.)
        if (info.cpqBilling) info.recommendedProductType = 'CPQ+Billing';
        else if (info.revenueCloud) info.recommendedProductType = 'ARM';
        else if (info.cpq) info.recommendedProductType = 'CPQ';
        else info.recommendedProductType = 'CPQ'; // safe default for empty orgs

        return info;
    }
}
