/**
 * Phase 24q — Per-org detector severity / on-off overrides.
 *
 * The catalog (Detector__mdt / CustomDetector__mdt) ships one severity
 * per detector for every org. That breaks down when customers integrate
 * external systems: TR-001 (no tax rule) shouldn't fire Critical for an
 * org that uses Avalara, PBC-001 (no billing rule) shouldn't fire at
 * all for an org that doesn't use Salesforce Billing. This service lets
 * an admin record a per-(org, detector) override that the scanner
 * honors at persist time.
 *
 * Lookup: a Map<DetectorId, override> per connectedOrgId, per-tx cached.
 * Mutation: applyOverrides(results, orgId) rewrites severity in-place
 *           or drops the result entirely for "Not Applicable" overrides.
 * Default:  no override row → catalog default. Inactive override row
 *           (IsActive__c=false) → catalog default.
 *
 * Caller pattern (ForensicScanService.persistFindings):
 *   List<DetectorResult> filtered = DetectorOverrideService.applyOverrides(
 *       allResults, ctx.connectedOrgId);
 *   for (DetectorResult r : filtered) findings.add(toFindingRecord(...));
 */
public with sharing class DetectorOverrideService {

    /** Cache keyed by connectedOrgId; value is detectorId → severity. */
    private static Map<Id, Map<String, String>> cache = new Map<Id, Map<String, String>>();

    /**
     * Returns map of detectorId → severity-override (Critical | Warning |
     * Info | Not Applicable) for the given org. Empty map when org is
     * null OR DetectorOverride__c is not deployed. Per-tx cached.
     */
    public static Map<String, String> loadOverridesFor(Id connectedOrgId) {
        if (connectedOrgId == null) return new Map<String, String>();
        if (cache.containsKey(connectedOrgId)) return cache.get(connectedOrgId);
        Map<String, String> out = new Map<String, String>();
        try {
            for (DetectorOverride__c o : [
                SELECT DetectorId__c, SeverityOverride__c
                FROM DetectorOverride__c
                WHERE ConnectedOrg__c = :connectedOrgId
                  AND IsActive__c = true
                  AND DetectorId__c != null
                WITH SECURITY_ENFORCED
            ]) {
                out.put(o.DetectorId__c, o.SeverityOverride__c);
            }
        } catch (Exception e) {
            // Object not deployed yet — return empty, scan continues.
            System.debug(LoggingLevel.INFO,
                'DetectorOverride__c unavailable: ' + e.getMessage());
        }
        cache.put(connectedOrgId, out);
        return out;
    }

    /**
     * Filter + rewrite DetectorResults for an org. Caller passes the
     * raw evaluator output; this returns the persistable subset with
     * severities adjusted per the override table.
     *
     * Local scans (connectedOrgId == null) pass through unchanged.
     */
    public static List<DetectorResult> applyOverrides(
        List<DetectorResult> results, Id connectedOrgId
    ) {
        if (results == null || results.isEmpty()) return results;
        if (connectedOrgId == null) return results;
        Map<String, String> overrides = loadOverridesFor(connectedOrgId);
        if (overrides.isEmpty()) return results;

        List<DetectorResult> kept = new List<DetectorResult>();
        for (DetectorResult r : results) {
            if (r == null) continue;
            String ov = overrides.get(r.detectorId);
            if (ov == null) {
                kept.add(r);
                continue;
            }
            if (ov == 'Not Applicable') {
                // Skip — admin marked detector irrelevant for this org.
                continue;
            }
            // Severity override — rewrite in place. The DetectorResult
            // is a transient DTO so mutation is safe.
            r.severity = ov;
            kept.add(r);
        }
        return kept;
    }

    @TestVisible
    private static void primeCacheForTest(Id orgId, Map<String, String> primed) {
        cache.put(orgId, primed);
    }

    @TestVisible
    private static void clearCacheForTest() {
        cache.clear();
    }
}
