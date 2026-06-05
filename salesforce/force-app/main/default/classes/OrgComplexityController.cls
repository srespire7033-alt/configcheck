/**
 * OrgComplexityController — measures actual CPQ org complexity by counting
 * key configuration objects, scoring each against industry benchmarks.
 *
 * Mirrors src/lib/analysis/engine.ts calculateComplexity():
 *   contribution = round(min(count / threshold, 2) × weight × 10)
 *   totalScore   = sum(contributions)
 *   rating       = Low ≤30, Moderate ≤60, High ≤100, Very High >100
 *
 * Defensive: uses Schema.getGlobalDescribe() so orgs without CPQ installed
 * still get a sensible response (CPQ-only factors → count = 0).
 */
public with sharing class OrgComplexityController {

    public class ComplexityDto {
        @AuraEnabled public Integer totalScore;
        @AuraEnabled public String rating; // 'Low' | 'Moderate' | 'High' | 'Very High'
        @AuraEnabled public String description;
        @AuraEnabled public List<Factor> factors;
    }

    public class Factor {
        @AuraEnabled public String label;
        @AuraEnabled public Integer count;
        @AuraEnabled public Decimal weight;
        @AuraEnabled public Integer contribution;
        @AuraEnabled public Integer benchmark;
    }

    @AuraEnabled(cacheable=true)
    public static ComplexityDto getComplexity() {
        Map<String, Schema.SObjectType> g = Schema.getGlobalDescribe();

        List<Factor> factors = new List<Factor>{
            buildFactor('Active Price Rules',         safeCount(g, 'SBQQ__PriceRule__c',
                'SELECT COUNT() FROM SBQQ__PriceRule__c WHERE SBQQ__Active__c = true'),
                3, 20, 5),
            buildFactor('Active Product Rules',       safeCount(g, 'SBQQ__ProductRule__c',
                'SELECT COUNT() FROM SBQQ__ProductRule__c WHERE SBQQ__Active__c = true'),
                2.5, 15, 5),
            buildFactor('Discount Schedules',         safeCount(g, 'SBQQ__DiscountSchedule__c',
                'SELECT COUNT() FROM SBQQ__DiscountSchedule__c'),
                1.5, 10, 5),
            buildFactor('Active Products',            safeCount(g, 'Product2',
                'SELECT COUNT() FROM Product2 WHERE IsActive = true'),
                1, 200, 50),
            buildFactor('Product Options (Bundles)',  safeCount(g, 'SBQQ__ProductOption__c',
                'SELECT COUNT() FROM SBQQ__ProductOption__c'),
                1.5, 100, 30),
            buildFactor('Approval Rules',             safeCount(g, 'SBQQ__ApprovalRule__c',
                'SELECT COUNT() FROM SBQQ__ApprovalRule__c WHERE SBQQ__Active__c = true'),
                2, 10, 3),
            buildFactor('Quote Templates',            safeCount(g, 'SBQQ__QuoteTemplate__c',
                'SELECT COUNT() FROM SBQQ__QuoteTemplate__c'),
                1, 5, 3),
            buildFactor('Contracted Prices',          safeCount(g, 'SBQQ__ContractedPrice__c',
                'SELECT COUNT() FROM SBQQ__ContractedPrice__c'),
                0.5, 50, 50)
        };

        Integer total = 0;
        for (Factor f : factors) total += f.contribution;

        ComplexityDto dto = new ComplexityDto();
        dto.totalScore = total;
        dto.factors = factors;
        if (total <= 30)       { dto.rating = 'Low';       dto.description = 'Simple configuration, easy to maintain'; }
        else if (total <= 60)  { dto.rating = 'Moderate';  dto.description = 'Standard complexity, manageable with good documentation'; }
        else if (total <= 100) { dto.rating = 'High';      dto.description = 'Complex setup, requires experienced CPQ admin'; }
        else                   { dto.rating = 'Very High'; dto.description = 'Very complex, high maintenance burden and risk'; }
        return dto;
    }

    private static Factor buildFactor(String label, Integer count, Decimal weight, Integer threshold, Integer benchmark) {
        Factor f = new Factor();
        f.label = label;
        f.count = count;
        f.weight = weight;
        f.benchmark = benchmark;
        Decimal ratio = Decimal.valueOf(count) / Decimal.valueOf(threshold);
        if (ratio > 2) ratio = 2;
        f.contribution = Integer.valueOf((ratio * weight * 10).setScale(0, System.RoundingMode.HALF_UP));
        return f;
    }

    /** Returns 0 if the object isn't present in the org (e.g. CPQ not installed). */
    private static Integer safeCount(Map<String, Schema.SObjectType> g, String objectName, String soql) {
        if (!g.containsKey(objectName.toLowerCase()) && !g.containsKey(objectName)) return 0;
        try {
            return Database.countQuery(soql);
        } catch (Exception e) {
            return 0;
        }
    }
}
