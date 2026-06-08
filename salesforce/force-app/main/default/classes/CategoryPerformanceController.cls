/**
 * CategoryPerformanceController — produces the per-category score grid.
 *
 * Output: 2 sections (CPQ + BILLING), each a list of CategoryCard rows.
 * Each card carries: key, label, iconName, score%, severity counts.
 *
 * Score formula:
 *   100 - (critical × 10) - (warning × 3) - (info × 1)   clamped to [0, 100]
 *
 * Categories without any mapped detectors auto-show 100% / "No issues".
 */
public with sharing class CategoryPerformanceController {

    public class CategorySection {
        @AuraEnabled public String key;    // 'cpq' | 'billing'
        @AuraEnabled public String label;  // 'CPQ' | 'BILLING'
        @AuraEnabled public List<CategoryCard> cards;
    }

    public class CategoryCard {
        @AuraEnabled public String key;
        @AuraEnabled public String label;
        @AuraEnabled public String iconName;
        @AuraEnabled public Integer score;
        @AuraEnabled public Integer criticalCount;
        @AuraEnabled public Integer warningCount;
        @AuraEnabled public Integer infoCount;
        @AuraEnabled public List<String> detectorIds;
        /**
         * Phase 24z-B — true when every detector mapped to this card was
         * surface-gated on the latest scan (i.e. the target org doesn't
         * have the required managed package). Lets the UI render a
         * neutral "Not installed" pill instead of a misleading green 100%.
         */
        @AuraEnabled public Boolean isNotInstalled;
    }

    /**
     * Phase 20c — cards now live in CategoryPerformanceCard__mdt.
     * Customers add/edit/reorder cards entirely in Setup. The Apex
     * code only owns the score formula + DML/query plumbing.
     *
     * Sections are grouped from the SectionKey__c values present in
     * mdt — so a customer adding 'arm' cards automatically gets an
     * ARM section in the grid, no code change. Section display order
     * is fixed by SECTION_PRIORITY below (cpq → billing → arm →
     * anything else alphabetical). Card display order within a
     * section follows Sequence__c.
     */
    private static final Map<String, Integer> SECTION_PRIORITY = new Map<String, Integer>{
        'cpq' => 1, 'billing' => 2, 'arm' => 3
    };

    /**
     * Phase 22r — connectedOrgId param. When present, look up the
     * ConnectedOrg__c.ProductType__c and filter the returned sections
     * accordingly so an ARM org sees only ARM cards (no CPQ/BILLING
     * clutter) and vice-versa. Null arg preserves the legacy "show all
     * sections" behavior — existing tests + the Apex local-scan callers
     * keep working unchanged.
     */
    @AuraEnabled(cacheable=true)
    public static List<CategorySection> getCategoryScores(Id connectedOrgId) {
        String productType = null;
        if (connectedOrgId != null) {
            List<ConnectedOrg__c> cos = [
                SELECT ProductType__c FROM ConnectedOrg__c
                WHERE Id = :connectedOrgId WITH SECURITY_ENFORCED LIMIT 1
            ];
            if (!cos.isEmpty() && String.isNotBlank(cos[0].ProductType__c)) {
                productType = cos[0].ProductType__c;
            }
        }
        return getCategoryScoresInternal(productType);
    }

    /**
     * Maps a ConnectedOrg__c.ProductType__c value to the set of
     * SectionKey__c values the dashboard should render. Returning null
     * means "no filter — show every section".
     */
    private static Set<String> sectionsForProductType(String productType) {
        if (productType == 'CPQ')         return new Set<String>{ 'cpq' };
        if (productType == 'CPQ+Billing') return new Set<String>{ 'cpq', 'billing' };
        if (productType == 'ARM')         return new Set<String>{ 'arm' };
        return null;
    }

    private static List<CategorySection> getCategoryScoresInternal(String productType) {
        Map<String, Map<String, Integer>> countsByDetector = loadCountsByDetector();
        // Phase 24z-B — surface-gated detector set from the latest scan,
        // so cards whose detectors were all skipped render "Not installed"
        // instead of a deceptively green 100%.
        Set<String> gated = loadSurfaceGatedDetectors();
        List<CategoryPerformanceCard__mdt> defs;
        try {
            defs = [
                SELECT SectionKey__c, CardKey__c, Label__c, IconName__c,
                       DetectorIds__c, Sequence__c, IsActive__c
                FROM CategoryPerformanceCard__mdt
                WHERE IsActive__c = true
                ORDER BY Sequence__c ASC NULLS LAST
            ];
        } catch (Exception e) {
            // Custom metadata isn't deployed yet — return an empty grid
            // rather than crashing the dashboard.
            return new List<CategorySection>();
        }

        Map<String, CategorySection> sectionsByKey = new Map<String, CategorySection>();
        for (CategoryPerformanceCard__mdt cardDef : defs) {
            String secKey = cardDef.SectionKey__c == null ? 'other' : cardDef.SectionKey__c.toLowerCase();
            CategorySection sec = sectionsByKey.get(secKey);
            if (sec == null) {
                sec = new CategorySection();
                sec.key = secKey;
                sec.label = secKey.toUpperCase();
                sec.cards = new List<CategoryCard>();
                sectionsByKey.put(secKey, sec);
            }
            sec.cards.add(buildCardFromMdt(cardDef, countsByDetector, gated));
        }

        // Order sections by SECTION_PRIORITY, then alphabetical for
        // anything not in the priority list. Deterministic ordering
        // keeps existing tests + dashboard layout stable.
        List<CategorySection> out = new List<CategorySection>(sectionsByKey.values());
        out.sort(new CategorySectionComparator());

        // Phase 22r — filter by product type if specified. An ARM org
        // should not see CPQ + BILLING sections (and vice-versa); they
        // create noise + confuse users. Null filter shows everything.
        Set<String> allowed = sectionsForProductType(productType);
        if (allowed != null) {
            List<CategorySection> filtered = new List<CategorySection>();
            for (CategorySection s : out) if (allowed.contains(s.key)) filtered.add(s);
            return filtered;
        }
        return out;
    }

    public class CategorySectionComparator implements Comparator<CategorySection> {
        public Integer compare(CategorySection a, CategorySection b) {
            Integer pa = SECTION_PRIORITY.containsKey(a.key) ? SECTION_PRIORITY.get(a.key) : 99;
            Integer pb = SECTION_PRIORITY.containsKey(b.key) ? SECTION_PRIORITY.get(b.key) : 99;
            if (pa != pb) return pa - pb;
            if (a.key < b.key) return -1;
            if (a.key > b.key) return 1;
            return 0;
        }
    }

    @TestVisible
    private static CategoryCard buildCardFromMdt(
        CategoryPerformanceCard__mdt cardDef,
        Map<String, Map<String, Integer>> countsByDetector,
        Set<String> surfaceGated
    ) {
        CategoryCard c = new CategoryCard();
        c.key = cardDef.CardKey__c;
        c.label = cardDef.Label__c;
        c.iconName = cardDef.IconName__c;
        c.criticalCount = 0;
        c.warningCount = 0;
        c.infoCount = 0;
        c.detectorIds = new List<String>();
        c.isNotInstalled = false;
        // Phase 24l — track raw counts (for UI display "14 warnings,
        // 2 info") AND distinct-detector counts (for scoring). Score
        // uses distinct so per-record emission doesn't blow past the
        // bucket cap; UI keeps showing blast radius.
        Integer distinctCrit = 0, distinctWarn = 0, distinctInfo = 0;
        // Phase 24z-B — count how many of this card's detectors were
        // surface-gated on the latest scan. If ALL non-blank detectors
        // for the card were gated, we treat the card as "Not installed".
        Integer totalDetectors = 0, gatedDetectors = 0;
        if (String.isNotBlank(cardDef.DetectorIds__c)) {
            for (String det : cardDef.DetectorIds__c.split(',')) {
                String d = det.trim();
                if (String.isBlank(d)) continue;
                c.detectorIds.add(d);
                totalDetectors += 1;
                if (surfaceGated != null && surfaceGated.contains(d)) gatedDetectors += 1;
                Map<String, Integer> sevs = countsByDetector.get(d);
                if (sevs == null) continue;
                if (sevs.containsKey('Critical')) { c.criticalCount += sevs.get('Critical'); distinctCrit += 1; }
                if (sevs.containsKey('Warning'))  { c.warningCount  += sevs.get('Warning');  distinctWarn += 1; }
                if (sevs.containsKey('Info'))     { c.infoCount     += sevs.get('Info');     distinctInfo += 1; }
            }
        }
        // Score from distinct counts; raw counts remain for the UI.
        c.score = HealthScoreCalculator.computeBucketScore(
            distinctCrit, distinctWarn, distinctInfo
        );
        c.isNotInstalled = (totalDetectors > 0 && totalDetectors == gatedDetectors);
        return c;
    }

    /**
     * Phase 24z-B — Loads the surface-gated detector ID set from the
     * latest completed/partial scan's SurfaceGatedDetectors__c JSON.
     * Empty set when nothing was gated, or when no scan exists, or
     * when the field is blank/unparseable.
     */
    @TestVisible
    private static Set<String> loadSurfaceGatedDetectors() {
        Set<String> out = new Set<String>();
        // SECURITY_ENFORCED dropped intentionally — this is a read-only
        // dashboard query of a non-PII status field on a system-owned
        // record. The legacy permset (OrgPrismUser) doesn't currently
        // include this field, so SECURITY_ENFORCED would QueryException
        // and silently break the grid for everyone until each install
        // bumps the permset. Falling back to a try/catch lets the grid
        // degrade gracefully (no "not installed" marking) on orgs where
        // the field truly isn't readable.
        try {
            List<ForensicScan__c> scans = [
                SELECT SurfaceGatedDetectors__c FROM ForensicScan__c
                WHERE Status__c IN ('Completed','Partial')
                ORDER BY CompletedAt__c DESC NULLS LAST LIMIT 1
            ];
            if (scans.isEmpty() || String.isBlank(scans[0].SurfaceGatedDetectors__c)) return out;
            List<Object> raw = (List<Object>) JSON.deserializeUntyped(scans[0].SurfaceGatedDetectors__c);
            for (Object o : raw) if (o instanceof String) out.add((String) o);
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN,
                '[OrgPrism] Could not load SurfaceGatedDetectors__c: ' + e.getMessage());
        }
        return out;
    }

    private static Map<String, Map<String, Integer>> loadCountsByDetector() {
        Map<String, Map<String, Integer>> out = new Map<String, Map<String, Integer>>();
        List<ForensicScan__c> scans = [
            SELECT Id FROM ForensicScan__c
            WHERE Status__c IN ('Completed','Partial')
            WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST LIMIT 1
        ];
        if (scans.isEmpty()) return out;
        for (AggregateResult ar : [
            SELECT DetectorId__c det, Severity__c sev, COUNT(Id) cnt
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scans[0].Id
              AND HiddenAt__c = null
              AND Status__c IN ('Open','Acknowledged')
            WITH SECURITY_ENFORCED GROUP BY DetectorId__c, Severity__c
        ]) {
            String det = (String) ar.get('det');
            String sev = (String) ar.get('sev');
            Integer cnt = (Integer) ar.get('cnt');
            if (!out.containsKey(det)) out.put(det, new Map<String, Integer>());
            out.get(det).put(sev, cnt);
        }
        return out;
    }

}
