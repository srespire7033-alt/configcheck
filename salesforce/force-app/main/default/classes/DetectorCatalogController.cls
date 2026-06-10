/**
 * Phase 19a — Detector Catalog.
 *
 * Single source of truth for everything that describes the 20 detectors
 * EXCEPT their SOQL + evaluator logic (which stays in the Apex classes).
 *
 * Used by:
 *   - Apex detector classes — read severity thresholds, recoverability,
 *     and AppliesTo product types from their Detector__mdt record
 *     instead of hardcoding constants.
 *   - LWCs (riskCategoryCard, impactEffortMatrix, pricingDisciplineView,
 *     governancePipelineView, trustScoresCard) — read labels + effort
 *     from a single getCatalog() call instead of 5 copies of
 *     DETECTOR_LABELS / DETECTOR_EFFORT maps.
 *   - Server-side controllers (ExecutiveReportController,
 *     RemediationPlanController, RevenueLeakageController) — read
 *     labels via getLabel(detectorId).
 *
 * The cache is per-transaction. Custom Metadata is immutable mid-txn,
 * so this is always safe.
 */
public with sharing class DetectorCatalogController {

    /** In-memory cache. Loaded lazily on first call; valid for the txn. */
    private static Map<String, Detector__mdt> cache;

    /**
     * @AuraEnabled cacheable entry for LWCs. Returns the full catalog
     * as a List ordered by category then label.
     */
    @AuraEnabled(cacheable=true)
    public static List<CatalogEntry> getCatalog() {
        List<CatalogEntry> out = new List<CatalogEntry>();
        for (Detector__mdt m : loadAll().values()) {
            out.add(toEntry(m));
        }
        out.sort(new CatalogEntryComparator());
        return out;
    }

    /** Look up by DetectorId — returns null if not in catalog. */
    public static Detector__mdt getRecord(String detectorId) {
        if (String.isBlank(detectorId)) return null;
        return loadAll().get(detectorId);
    }

    /** Look up just the display label, falling back to the id itself. */
    public static String getLabel(String detectorId) {
        Detector__mdt m = getRecord(detectorId);
        return (m != null && String.isNotBlank(m.Label__c)) ? m.Label__c : detectorId;
    }

    /**
     * Severity threshold helpers — replace the hardcoded
     * `(gap > 10000) ? 'Critical' : (gap > 1000 ? 'Warning' : 'Info')`
     * pattern in each detector.
     */
    public static String resolveSeverity(String detectorId, Decimal gapUsd) {
        if (gapUsd == null) gapUsd = 0;
        Detector__mdt m = getRecord(detectorId);
        Decimal crit = (m != null && m.CriticalThresholdUsd__c != null) ? m.CriticalThresholdUsd__c : 10000;
        Decimal warn = (m != null && m.WarningThresholdUsd__c != null) ? m.WarningThresholdUsd__c : 1000;
        if (gapUsd > crit) return 'Critical';
        if (gapUsd > warn) return 'Warning';
        return 'Info';
    }

    /**
     * Phase 24b — Static-severity helper for Vercel alignment.
     *
     * Returns the Detector__mdt.Severity__c value (matches Vercel's
     * authoritative spec). When the catalog doesn't define a severity
     * (mainly forensic -FOR- detectors that compute it from gapUsd),
     * returns the provided fallback so caller behavior is unchanged.
     *
     * Caller pattern:
     *   r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Critical');
     *
     * The catalog lookup is per-transaction cached so 200+ calls per
     * scan have no perf impact.
     */
    public static String getSeverity(String detectorId, String fallback) {
        Detector__mdt m = getRecord(detectorId);
        if (m != null && String.isNotBlank(m.Severity__c)) return m.Severity__c;
        return fallback;
    }

    public static Decimal getRecoverability(String detectorId, Decimal defaultScore) {
        Detector__mdt m = getRecord(detectorId);
        return (m != null && m.RecoverabilityScore__c != null) ? m.RecoverabilityScore__c : defaultScore;
    }

    /** Product-type membership check. Replaces hardcoded getAppliesTo() Sets. */
    public static Boolean appliesTo(String detectorId, String productType) {
        if (String.isBlank(productType)) return true;
        Detector__mdt m = getRecord(detectorId);
        if (m == null || String.isBlank(m.AppliesTo__c)) return true;
        for (String pt : m.AppliesTo__c.split(';')) {
            if (pt.trim() == productType) return true;
        }
        return false;
    }

    public static Boolean isActive(String detectorId) {
        Detector__mdt m = getRecord(detectorId);
        return m == null ? true : (m.IsActive__c == true);
    }

    /**
     * Phase 22a-0 — Surface gating.
     *
     * Returns the RequiredSurface__c string (e.g. "SBQQ", "blng",
     * "SBQQ;blng", or null). When non-blank, the detector should
     * only run if at least one listed object/namespace token is
     * present in the running org's schema. See surfaceAvailable().
     */
    public static String getRequiredSurface(String detectorId) {
        Detector__mdt m = getRecord(detectorId);
        return (m == null) ? null : m.RequiredSurface__c;
    }

    /**
     * Phase 22a-0 — True if the detector's required surface is present
     * in the host org's schema (or no surface is required).
     *
     * Surface tokens are SObject API names (e.g. "SBQQ__Quote__c",
     * "blng__BillingSchedule__c", "ProductSellingModel"). A token can
     * also be a namespace probe — to keep it simple we treat the
     * value as an SObject name and let SchemaUtil.hasObject decide.
     *
     * Local scans only — for remote scans the host org's schema is
     * irrelevant so this always returns true.
     */
    public static Boolean surfaceAvailable(String detectorId, Boolean isRemote) {
        // Backward-compat: no Named Credential context → preserve the
        // pre-24z behavior (always allow on remote). Callers with a
        // Named Credential should use the 3-arg overload below.
        return surfaceAvailable(detectorId, isRemote, null);
    }

    /**
     * Phase 24z — Surface gate, schema-aware on both sides.
     *
     * Before: remote scans skipped the gate entirely, so ARM-001 fired
     * against vanilla DE orgs that didn't have ProductSellingModel,
     * inflating the critical count with false positives. Now: when the
     * caller supplies the Named Credential, we probe the remote org's
     * /sobjects/ describe (once per scan, cached) and gate the detector
     * on the actual remote schema.
     *
     * Fail-open semantics: if the probe errors (auth, network, 403, etc.)
     * we let the detector run — better to surface a maybe-irrelevant
     * finding than silently hide a real one.
     */
    public static Boolean surfaceAvailable(String detectorId, Boolean isRemote, String namedCredentialName) {
        String raw = getRequiredSurface(detectorId);
        if (String.isBlank(raw)) return true;
        // Phase 24z-F — AND semantics, not OR. A detector with
        // RequiredSurface__c="Product2;ProductSellingModelOption" needs
        // BOTH objects to function (the SOQL joins/correlates across
        // them). The previous OR semantic returned true on the first
        // present token, so ARM-001 fired against orgs that had only
        // Product2 — 17 false-positive "no selling model" findings on
        // every vanilla DE scan. All multi-token detectors in the
        // catalog (verified) are AND-style; none use the list as
        // alternative-names. Single-token detectors are unaffected.
        // Legacy fail-open preserved when no Named Credential is
        // supplied on remote scans.
        if (isRemote == true && String.isBlank(namedCredentialName)) return true;
        for (String tok : raw.split(';')) {
            String t = tok.trim();
            if (String.isBlank(t)) continue;
            Boolean exists;
            if (isRemote == true) {
                exists = OrgQueryService.remoteSObjectExists(namedCredentialName, t);
            } else {
                exists = SchemaUtil.hasObject(t);
            }
            if (!exists) return false; // any missing surface → skip
        }
        return true; // all required surfaces present
    }

    // ── DTO for LWC consumption ─────────────────────────────────────

    public class CatalogEntry {
        @AuraEnabled public String detectorId;
        @AuraEnabled public String label;
        @AuraEnabled public String category;
        @AuraEnabled public String appliesTo;
        @AuraEnabled public Decimal criticalThresholdUsd;
        @AuraEnabled public Decimal warningThresholdUsd;
        @AuraEnabled public Decimal recoverabilityScore;
        @AuraEnabled public String effort;
        @AuraEnabled public Boolean isActive;
        @AuraEnabled public String longDescription;
    }

    private static CatalogEntry toEntry(Detector__mdt m) {
        CatalogEntry e = new CatalogEntry();
        e.detectorId = m.DetectorId__c;
        e.label = m.Label__c;
        e.category = m.Category__c;
        e.appliesTo = m.AppliesTo__c;
        e.criticalThresholdUsd = m.CriticalThresholdUsd__c;
        e.warningThresholdUsd = m.WarningThresholdUsd__c;
        e.recoverabilityScore = m.RecoverabilityScore__c;
        e.effort = m.Effort__c;
        e.isActive = m.IsActive__c;
        e.longDescription = m.LongDescription__c;
        return e;
    }

    /**
     * Phase 24o — Admin-facing prose for the finding triage UI.
     * Prefers CustomDetector__mdt.LongDescription__c when the detector
     * was migrated (Phase 24f-i), otherwise falls back to Detector__mdt.
     * Returns null when no description exists (no admin has written one
     * yet for that detector).
     */
    @AuraEnabled(cacheable=true)
    public static String getLongDescription(String detectorId) {
        if (String.isBlank(detectorId)) return null;
        try {
            List<CustomDetector__mdt> cd = [
                SELECT LongDescription__c FROM CustomDetector__mdt
                WHERE DetectorId__c = :detectorId LIMIT 1
            ];
            if (!cd.isEmpty() && String.isNotBlank(cd[0].LongDescription__c)) {
                return cd[0].LongDescription__c;
            }
        } catch (Exception e) {
            // CustomDetector__mdt may not be deployed yet — fall through
            // to Detector__mdt lookup.
        }
        Detector__mdt m = getRecord(detectorId);
        if (m != null && String.isNotBlank(m.LongDescription__c)) {
            return m.LongDescription__c;
        }
        return null;
    }

    public class CatalogEntryComparator implements Comparator<CatalogEntry> {
        public Integer compare(CatalogEntry a, CatalogEntry b) {
            String ac = a.category == null ? 'zzz' : a.category;
            String bc = b.category == null ? 'zzz' : b.category;
            if (ac < bc) return -1;
            if (ac > bc) return 1;
            String al = a.label == null ? a.detectorId : a.label;
            String bl = b.label == null ? b.detectorId : b.label;
            if (al < bl) return -1;
            if (al > bl) return 1;
            return 0;
        }
    }

    // ── internals ────────────────────────────────────────────────────

    @TestVisible
    private static Map<String, Detector__mdt> loadAll() {
        if (cache != null) return cache;
        cache = new Map<String, Detector__mdt>();
        for (Detector__mdt m : [
            SELECT DeveloperName, DetectorId__c, Label__c, Category__c, AppliesTo__c,
                   CriticalThresholdUsd__c, WarningThresholdUsd__c,
                   RecoverabilityScore__c, Effort__c, IsActive__c, Version__c,
                   RequiredSurface__c, Severity__c, LongDescription__c, ActionHeadline__c
            FROM Detector__mdt
        ]) {
            if (String.isNotBlank(m.DetectorId__c)) cache.put(m.DetectorId__c, m);
        }
        return cache;
    }

    @TestVisible
    private static void primeCacheForTest(Map<String, Detector__mdt> primed) {
        cache = primed;
    }
}
