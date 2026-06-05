/**
 * Schema portability helper.
 *
 * OrgPrism's detectors query CPQ-namespace fields/objects. Different CPQ
 * managed-package versions ship slightly different schemas (e.g.
 * SBQQ__EndDate__c on SBQQ__DiscountSchedule__c exists in newer CPQ,
 * doesn't in older ones). Without guards, the SOQL throws and the
 * detector silently skips — fine, but opaque.
 *
 * This helper lets a detector check up-front:
 *   if (!SchemaUtil.hasObject('SBQQ__ApprovalRule__c')) return ...;
 *   if (!SchemaUtil.hasField('SBQQ__QuoteLine__c', 'SBQQ__Required__c'))
 *       return ...;
 *
 * Describes are cached per-transaction (Apex caches the global describe
 * itself, but hasField does a 2nd describe per object — the per-object
 * cache below avoids paying that twice for the same object in one scan).
 *
 * IMPORTANT: This checks the HOST org's schema. For REMOTE scans where
 * the detector queries a different org via Named Credential, the host's
 * schema is irrelevant — the helper returns true (don't pre-skip) and
 * the existing try/catch is the only safety net there. Detectors should
 * pass ctx.isRemote() and skip the guard when true.
 */
public with sharing class SchemaUtil {

    @TestVisible
    private static Map<String, Schema.DescribeSObjectResult> describeCache =
        new Map<String, Schema.DescribeSObjectResult>();

    /** True if the SObject exists and the running user can read it. */
    public static Boolean hasObject(String objApiName) {
        if (String.isBlank(objApiName)) return false;
        Schema.SObjectType t = Schema.getGlobalDescribe().get(objApiName);
        if (t == null) return false;
        try {
            return t.getDescribe().isAccessible();
        } catch (Exception e) {
            return false;
        }
    }

    /** True if the field exists on the object and the running user can read it. */
    public static Boolean hasField(String objApiName, String fieldApiName) {
        if (String.isBlank(objApiName) || String.isBlank(fieldApiName)) return false;

        Schema.DescribeSObjectResult d = describeCache.get(objApiName);
        if (d == null) {
            Schema.SObjectType t = Schema.getGlobalDescribe().get(objApiName);
            if (t == null) return false;
            try {
                d = t.getDescribe();
                describeCache.put(objApiName, d);
            } catch (Exception e) {
                return false;
            }
        }
        Schema.SObjectField f = d.fields.getMap().get(fieldApiName);
        if (f == null) return false;
        try {
            return f.getDescribe().isAccessible();
        } catch (Exception e) {
            return false;
        }
    }
}
