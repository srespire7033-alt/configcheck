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

    /**
     * Phase 22t — connectedOrgId param. Same scoping bug class as 22m / 22r
     * / 22s: a CPQ-org dashboard and an ARM-org dashboard were showing
     * identical complexity numbers because getComplexity() always
     * counted the HOST org (techtorch) instead of the target org. Null
     * arg preserves the legacy host-local behavior for non-remote
     * contexts (CustomDetector + sandbox demos).
     *
     * When connectedOrgId is set, the method makes ~8 HTTP callouts to
     * the target via Named Credential. cacheable=false because callouts
     * are disallowed in cacheable methods. The LWC's @wire still caches
     * the result client-side for the lifetime of the connectedOrgId
     * binding, so repeated dashboard renders don't refetch.
     */
    @AuraEnabled
    public static ComplexityDto getComplexity(Id connectedOrgId) {
        if (connectedOrgId == null) return computeLocal();
        List<ConnectedOrg__c> cos = [
            SELECT NamedCredentialName__c, ProductType__c FROM ConnectedOrg__c
            WHERE Id = :connectedOrgId WITH SECURITY_ENFORCED LIMIT 1
        ];
        if (cos.isEmpty()) return computeLocal();
        DetectorContext ctx = new DetectorContext(
            null, 'USD', cos[0].ProductType__c,
            connectedOrgId, cos[0].NamedCredentialName__c
        );
        List<Factor> factors = (cos[0].ProductType__c == 'ARM')
            ? armFactors(ctx) : cpqFactors(ctx);
        return finalizeDto(factors);
    }

    /** Legacy zero-arg signature kept for tests + non-remote contexts. */
    @AuraEnabled(cacheable=true)
    public static ComplexityDto getComplexityLocal() {
        return computeLocal();
    }

    private static ComplexityDto computeLocal() {
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
        return finalizeDto(factors);
    }

    /** CPQ-flavored factors against a remote target via Named Credential. */
    private static List<Factor> cpqFactors(DetectorContext ctx) {
        return new List<Factor>{
            buildFactor('Active Price Rules',
                remoteCount(ctx, 'SBQQ__PriceRule__c', 'SBQQ__Active__c = true'),         3,   20, 5),
            buildFactor('Active Product Rules',
                remoteCount(ctx, 'SBQQ__ProductRule__c', 'SBQQ__Active__c = true'),       2.5, 15, 5),
            buildFactor('Discount Schedules',
                remoteCount(ctx, 'SBQQ__DiscountSchedule__c', null),                      1.5, 10, 5),
            buildFactor('Active Products',
                remoteCount(ctx, 'Product2', 'IsActive = true'),                          1,  200, 50),
            buildFactor('Product Options (Bundles)',
                remoteCount(ctx, 'SBQQ__ProductOption__c', null),                         1.5, 100, 30),
            buildFactor('Approval Rules',
                remoteCount(ctx, 'SBQQ__ApprovalRule__c', 'SBQQ__Active__c = true'),      2,   10, 3),
            buildFactor('Quote Templates',
                remoteCount(ctx, 'SBQQ__QuoteTemplate__c', null),                         1,    5, 3),
            buildFactor('Contracted Prices',
                remoteCount(ctx, 'SBQQ__ContractedPrice__c', null),                       0.5, 50, 50)
        };
    }

    /** ARM-flavored factors. Counts the RC Advanced surface area an
     *  admin actually owns: products, selling models, components,
     *  rate cards, decision tables, fulfillment scenarios, attribute
     *  defs, context defs. */
    private static List<Factor> armFactors(DetectorContext ctx) {
        return new List<Factor>{
            buildFactor('Active Products',
                remoteCount(ctx, 'Product2', 'IsActive = true'),                          1,  200, 50),
            buildFactor('Selling Model Options',
                remoteCount(ctx, 'ProductSellingModelOption', null),                      2,   30, 10),
            buildFactor('Bundle Components',
                remoteCount(ctx, 'ProductRelatedComponent', null),                        1.5, 50, 20),
            buildFactor('Rate Cards',
                remoteCount(ctx, 'RateCard', null),                                       2,   10, 3),
            buildFactor('Decision Tables',
                remoteCount(ctx, 'DecisionTable', null),                                  2,   10, 3),
            buildFactor('Fulfillment Scenarios',
                remoteCount(ctx, 'ProductFulfillmentScenario', null),                     2.5,  8, 3),
            buildFactor('Attribute Definitions',
                remoteCount(ctx, 'AttributeDefinition', null),                            1.5, 25, 10),
            buildFactor('Context Definitions',
                remoteCount(ctx, 'ContextDefinition', null),                              1,   10, 3)
        };
    }

    private static Integer remoteCount(DetectorContext ctx, String objName, String whereClause) {
        String soql = 'SELECT COUNT(Id) c FROM ' + objName +
            (String.isBlank(whereClause) ? '' : ' WHERE ' + whereClause);
        // queryWithFallback returns [] when the target lacks the object
        // (older RC releases, non-installed CPQ). Treat absent surface
        // as count=0 so the factor contributes nothing rather than crashing
        // the whole card.
        List<Map<String, Object>> rows;
        try {
            rows = OrgQueryService.queryWithFallback(ctx, soql, null);
        } catch (Exception e) {
            return 0;
        }
        if (rows == null || rows.isEmpty()) return 0;
        Object v = rows[0].get('c');
        if (v == null) v = rows[0].get('expr0'); // REST API alt alias
        return (v == null) ? 0 : Integer.valueOf(String.valueOf(v));
    }

    private static ComplexityDto finalizeDto(List<Factor> factors) {
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
