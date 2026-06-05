/**
 * Phase 19d — Single source of truth for attribution class labels.
 *
 * Replaces 3+ duplicate copies of CLASS_LABELS = {...} scattered
 * across ClassDTracer, ExecutiveReportController, and LWC files.
 * Reads from AttributionClass__mdt; falls back to hardcoded
 * defaults so the system degrades gracefully if mdt isn't seeded.
 */
public with sharing class AttributionClassCatalog {

    private static Map<String, AttributionClass__mdt> cache;

    private static final Map<String, String> DEFAULT_LABELS = new Map<String, String>{
        'A' => 'Process and System Disconnect',
        'B' => 'Manual Override',
        'C' => 'Conflicting Automation',
        'D' => 'Missing Governance',
        'E' => 'Poor Data Quality'
    };

    /**
     * AuraEnabled entry point for LWCs that want the full set.
     * Returns a stable List sorted by Letter ascending.
     */
    @AuraEnabled(cacheable=true)
    public static List<AttributionClass__mdt> getAll() {
        loadAll(); // populate cache
        List<AttributionClass__mdt> out = new List<AttributionClass__mdt>(cache.values());
        out.sort(new AttributionClassComparator());
        return out;
    }

    /**
     * Apex helper: returns the display label for a letter (A-E).
     * Falls back to the default English label if no mdt record exists.
     */
    public static String getLabel(String letter) {
        if (String.isBlank(letter)) return null;
        AttributionClass__mdt rec = loadAll().get(letter);
        if (rec != null && String.isNotBlank(rec.Label__c)) return rec.Label__c;
        return DEFAULT_LABELS.containsKey(letter) ? DEFAULT_LABELS.get(letter) : letter;
    }

    /** Optional description (longer text) when mdt has one. */
    public static String getDescription(String letter) {
        AttributionClass__mdt rec = loadAll().get(letter);
        return (rec != null) ? rec.Description__c : null;
    }

    private static Map<String, AttributionClass__mdt> loadAll() {
        if (cache != null) return cache;
        cache = new Map<String, AttributionClass__mdt>();
        try {
            for (AttributionClass__mdt m : [
                SELECT DeveloperName, Letter__c, Label__c, Description__c
                FROM AttributionClass__mdt
            ]) {
                if (String.isNotBlank(m.Letter__c)) cache.put(m.Letter__c, m);
            }
        } catch (Exception e) {
            // mdt not deployed yet — defaults kick in.
        }
        return cache;
    }

    public class AttributionClassComparator implements Comparator<AttributionClass__mdt> {
        public Integer compare(AttributionClass__mdt a, AttributionClass__mdt b) {
            String al = a.Letter__c == null ? 'Z' : a.Letter__c;
            String bl = b.Letter__c == null ? 'Z' : b.Letter__c;
            if (al < bl) return -1;
            if (al > bl) return 1;
            return 0;
        }
    }
}
