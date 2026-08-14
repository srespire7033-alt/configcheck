/**
 * Phase 20b — Display metadata for the parent category cards on the
 * OrgPrism dashboard. Replaces the hardcoded CATEGORY_META map that
 * lived in riskCategoryCard.js (and similar one-off literals in
 * pricingDisciplineCard / revenueLeakageView).
 *
 * One source of truth: Category__mdt. Customers edit the title,
 * subtitle, icon, accent color, and summary mode entirely in Setup;
 * the dashboard reflects the changes immediately.
 *
 * The Apex-side fallback returns the original english labels when
 * Category__mdt isn't seeded yet — keeps the system degrading
 * gracefully in fresh org provisioning.
 */
public with sharing class CategoryDisplayController {

    private static Map<String, CategoryDto> cache;

    /** AuraEnabled entry — LWCs @wire this. */
    @AuraEnabled(cacheable=true)
    public static List<CategoryDto> getAll() {
        loadAll();
        List<CategoryDto> out = new List<CategoryDto>(cache.values());
        out.sort(new CategoryDtoComparator());
        return out;
    }

    /**
     * Convenience: fetch one record by key. Returns null if neither
     * mdt nor the fallback has the key. The LWC falls back to its own
     * defaults in that case.
     */
    @AuraEnabled(cacheable=true)
    public static CategoryDto getByKey(String categoryKey) {
        if (String.isBlank(categoryKey)) return null;
        loadAll();
        return cache.get(categoryKey);
    }

    public class CategoryDto {
        @AuraEnabled public String categoryKey;
        @AuraEnabled public String title;
        @AuraEnabled public String subtitle;
        @AuraEnabled public String iconName;
        @AuraEnabled public String accent;
        @AuraEnabled public String summaryMode;
        @AuraEnabled public Integer sequence1;
    }

    private static void loadAll() {
        if (cache != null) return;
        cache = new Map<String, CategoryDto>();
        try {
            for (Category__mdt m : [
                SELECT CategoryKey__c, Title__c, Subtitle__c, IconName__c,
                       Accent__c, SummaryMode__c, Sequence__c, IsActive__c
                FROM Category__mdt
                WHERE IsActive__c = true
            ]) {
                if (String.isBlank(m.CategoryKey__c)) continue;
                CategoryDto d = new CategoryDto();
                d.categoryKey = m.CategoryKey__c;
                d.title = m.Title__c;
                d.subtitle = m.Subtitle__c;
                d.iconName = m.IconName__c;
                d.accent = m.Accent__c;
                d.summaryMode = m.SummaryMode__c;
                d.sequence1 = m.Sequence__c == null ? 99 : Integer.valueOf(m.Sequence__c);
                cache.put(m.CategoryKey__c, d);
            }
        } catch (Exception e) {
            // mdt not deployed yet → cache stays empty; fallback below
            // covers the four known categories so the dashboard still renders.
        }
        // Seed fallbacks for any expected categories not present in mdt.
        seedFallback('revenue_leakage', 'Revenue Leakage',
            'Configuration drift letting revenue walk out the door.',
            'utility:currency_input', 'emerald', 'arr', 1);
        seedFallback('governance', 'Governance Risk',
            'Process and audit findings — the dollar amount is not the story; the missing audit trail is.',
            'utility:shield', 'amber', 'count', 2);
        seedFallback('pipeline', 'Pipeline Risk',
            'Revenue actively walking out the door — not lost yet, but it will be without action.',
            'utility:trending', 'sky', 'arr', 3);
        seedFallback('pricing', 'Pricing Discipline',
            'Discounts and pricing controls.',
            'utility:money', 'violet', 'count', 4);
        seedFallback('performance', 'Performance & Scalability',
            'Governor-limit, flow, and async load risks — config that runs but strains at scale.',
            'utility:speed', 'rose', 'count', 5);
    }

    private static void seedFallback(String key, String title, String subtitle,
                                     String icon, String accent, String mode, Integer seq) {
        if (cache.containsKey(key)) return;
        CategoryDto d = new CategoryDto();
        d.categoryKey = key; d.title = title; d.subtitle = subtitle;
        d.iconName = icon; d.accent = accent; d.summaryMode = mode; d.sequence1 = seq;
        cache.put(key, d);
    }

    public class CategoryDtoComparator implements Comparator<CategoryDto> {
        public Integer compare(CategoryDto a, CategoryDto b) {
            Integer sa = a.sequence1 == null ? 99 : a.sequence1;
            Integer sb = b.sequence1 == null ? 99 : b.sequence1;
            return sa - sb;
        }
    }
}
