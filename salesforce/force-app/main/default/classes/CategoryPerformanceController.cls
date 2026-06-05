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

    @AuraEnabled(cacheable=true)
    public static List<CategorySection> getCategoryScores() {
        Map<String, Map<String, Integer>> countsByDetector = loadCountsByDetector();
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
            sec.cards.add(buildCardFromMdt(cardDef, countsByDetector));
        }

        // Order sections by SECTION_PRIORITY, then alphabetical for
        // anything not in the priority list. Deterministic ordering
        // keeps existing tests + dashboard layout stable.
        List<CategorySection> out = new List<CategorySection>(sectionsByKey.values());
        out.sort(new CategorySectionComparator());
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
        Map<String, Map<String, Integer>> countsByDetector
    ) {
        CategoryCard c = new CategoryCard();
        c.key = cardDef.CardKey__c;
        c.label = cardDef.Label__c;
        c.iconName = cardDef.IconName__c;
        c.criticalCount = 0;
        c.warningCount = 0;
        c.infoCount = 0;
        c.detectorIds = new List<String>();
        if (String.isNotBlank(cardDef.DetectorIds__c)) {
            for (String det : cardDef.DetectorIds__c.split(',')) {
                String d = det.trim();
                if (String.isBlank(d)) continue;
                c.detectorIds.add(d);
                Map<String, Integer> sevs = countsByDetector.get(d);
                if (sevs == null) continue;
                if (sevs.containsKey('Critical')) c.criticalCount += sevs.get('Critical');
                if (sevs.containsKey('Warning'))  c.warningCount  += sevs.get('Warning');
                if (sevs.containsKey('Info'))     c.infoCount     += sevs.get('Info');
            }
        }
        // Phase 22f — Delegate to HealthScoreCalculator.computeBucketScore so
        // pillar scores (per-category aggregate) and card-grid scores (per
        // CategoryPerformanceCard__mdt grouping) share one mdt-tunable formula.
        // Defaults to Vercel bucket weights 15/5/1; the previous hardcoded
        // 10/3/1 formula went away because admins couldn't tune it.
        c.score = HealthScoreCalculator.computeBucketScore(
            c.criticalCount, c.warningCount, c.infoCount
        );
        return c;
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
