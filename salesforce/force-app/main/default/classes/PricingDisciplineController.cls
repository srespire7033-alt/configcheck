/**
 * PricingDisciplineController — org-level pricing-health signals.
 *
 * Aggregates SBQQ__QuoteLine__c records from the last 12 months and emits:
 *   - avgDiscount, medianDiscount, % discounted beyond max
 *   - override% (SBQQ__PricingMethod__c = 'Manual')
 *   - letter grade (A-F) + narrative
 *   - top offenders by product
 *
 * Grade formula mirrors src/lib/forensics/pricing-discipline-grade.ts.
 * Max-allowed-discount default: 25% (when no DiscountSchedule on line).
 *
 * Defensive: if SBQQ__QuoteLine__c isn't installed in the org, returns a
 * "no CPQ" placeholder DTO so the LWC can hide itself cleanly.
 */
public with sharing class PricingDisciplineController {

    private static final Decimal DEFAULT_MAX_DISCOUNT_PCT = 25;

    public class DisciplineDto {
        @AuraEnabled public Boolean cpqInstalled;
        @AuraEnabled public Integer quoteLineCount;
        @AuraEnabled public Decimal avgDiscount;
        @AuraEnabled public Decimal medianDiscount;
        @AuraEnabled public Decimal maxAllowedDiscount;
        @AuraEnabled public Integer beyondLimitCount;
        @AuraEnabled public Decimal beyondLimitPct;
        @AuraEnabled public Integer overrideCount;
        @AuraEnabled public Decimal overridePct;
        @AuraEnabled public String grade;
        @AuraEnabled public String narrative;
        @AuraEnabled public String overrideRiskLabel; // 'Low' | 'Medium' | 'High'
        @AuraEnabled public String overrideRiskCopy;  // 'calculated price is honored' / etc.
        @AuraEnabled public List<TopOffender> topDiscountOffenders;
        @AuraEnabled public List<TopOffender> topOverrideOffenders;
    }

    public class TopOffender {
        @AuraEnabled public String productId;
        @AuraEnabled public String productName;
        @AuraEnabled public Integer lineCount;
        @AuraEnabled public Decimal avgDiscount;
        @AuraEnabled public Integer overrideCount;
    }

    /**
     * Phase 22u — connectedOrgId param. Same scoping bug class as 22m/22r/
     * 22s/22t: dashboards on different Connected Orgs all showed identical
     * pricing discipline numbers because the controller queried the HOST
     * org (techtorch) instead of the target. Null arg preserves host-
     * local behavior; non-null routes through OrgQueryService.query so
     * callouts hit the target via Named Credential.
     *
     * cacheable=false because callouts are disallowed in cacheable
     * methods. LWC must call imperatively (matches 22t.1 pattern).
     */
    @AuraEnabled
    public static DisciplineDto getDiscipline(Id connectedOrgId) {
        if (connectedOrgId == null) return computeLocal();
        return computeRemote(connectedOrgId);
    }

    /** Legacy zero-arg signature kept for tests + non-remote contexts. */
    @AuraEnabled(cacheable=true)
    public static DisciplineDto getDisciplineLocal() {
        return computeLocal();
    }

    private static DisciplineDto computeLocal() {
        DisciplineDto dto = freshDto();
        Map<String, Schema.SObjectType> g = Schema.getGlobalDescribe();
        if (!g.containsKey('SBQQ__QuoteLine__c')) return dto;
        dto.cpqInstalled = true;

        try {
            Datetime since = System.now().addDays(-365);
            List<SObject> lines = Database.query(
                'SELECT Id, SBQQ__Discount__c, SBQQ__PricingMethod__c, SBQQ__Product__c, ' +
                'SBQQ__Product__r.Name ' +
                'FROM SBQQ__QuoteLine__c ' +
                'WHERE CreatedDate >= :since ' +
                'LIMIT 5000'
            );
            List<Map<String, Object>> rows = new List<Map<String, Object>>();
            for (SObject s : lines) {
                Map<String, Object> r = new Map<String, Object>{
                    'discount' => s.get('SBQQ__Discount__c'),
                    'pricingMethod' => s.get('SBQQ__PricingMethod__c'),
                    'productId' => s.get('SBQQ__Product__c'),
                    'productName' => null
                };
                SObject prod = s.getSObject('SBQQ__Product__r');
                if (prod != null) r.put('productName', prod.get('Name'));
                rows.add(r);
            }
            populateDtoFromRows(dto, rows);
        } catch (Exception e) {
            dto.cpqInstalled = true;
            dto.narrative = 'Could not compute pricing discipline: ' + e.getMessage();
        }
        return dto;
    }

    private static DisciplineDto computeRemote(Id connectedOrgId) {
        DisciplineDto dto = freshDto();
        List<ConnectedOrg__c> cos = [
            SELECT NamedCredentialName__c, ProductType__c FROM ConnectedOrg__c
            WHERE Id = :connectedOrgId WITH SECURITY_ENFORCED LIMIT 1
        ];
        if (cos.isEmpty()) return computeLocal();
        // ARM orgs don't have SBQQ__QuoteLine__c — pricing discipline is a
        // CPQ-only signal. Return the "no CPQ" state so the LWC renders
        // the empty-state copy instead of a misleading 0%/0% grade A.
        if (cos[0].ProductType__c == 'ARM') return dto;

        DetectorContext ctx = new DetectorContext(
            null, 'USD', cos[0].ProductType__c,
            connectedOrgId, cos[0].NamedCredentialName__c
        );
        try {
            // Single remote SOQL pulls quote-line discount + override data;
            // queryWithFallback so an org without SBQQ__QuoteLine__c falls
            // back to the "no CPQ installed" empty-state cleanly.
            List<Map<String, Object>> remoteRows = OrgQueryService.queryWithFallback(ctx,
                'SELECT Id, SBQQ__Discount__c, SBQQ__PricingMethod__c, SBQQ__Product__c, ' +
                'SBQQ__Product__r.Name FROM SBQQ__QuoteLine__c ' +
                'WHERE CreatedDate = LAST_N_DAYS:365 LIMIT 5000',
                null);
            if (remoteRows == null) return dto;
            dto.cpqInstalled = true;
            // Re-shape REST nested relationship into the flat key map
            // computeLocal builds, so populateDtoFromRows works unchanged.
            List<Map<String, Object>> rows = new List<Map<String, Object>>();
            for (Map<String, Object> raw : remoteRows) {
                Map<String, Object> r = new Map<String, Object>{
                    'discount' => raw.get('SBQQ__Discount__c'),
                    'pricingMethod' => raw.get('SBQQ__PricingMethod__c'),
                    'productId' => raw.get('SBQQ__Product__c'),
                    'productName' => null
                };
                Object prodRel = raw.get('SBQQ__Product__r');
                if (prodRel instanceof Map<String, Object>) {
                    r.put('productName', ((Map<String, Object>) prodRel).get('Name'));
                }
                rows.add(r);
            }
            populateDtoFromRows(dto, rows);
        } catch (Exception e) {
            dto.narrative = 'Could not compute pricing discipline: ' + e.getMessage();
        }
        return dto;
    }

    private static DisciplineDto freshDto() {
        DisciplineDto dto = new DisciplineDto();
        dto.cpqInstalled = false;
        dto.quoteLineCount = 0;
        dto.avgDiscount = 0;
        dto.medianDiscount = 0;
        dto.maxAllowedDiscount = DEFAULT_MAX_DISCOUNT_PCT;
        dto.beyondLimitCount = 0;
        dto.beyondLimitPct = 0;
        dto.overrideCount = 0;
        dto.overridePct = 0;
        dto.grade = 'A';
        dto.narrative = '';
        dto.topDiscountOffenders = new List<TopOffender>();
        dto.topOverrideOffenders = new List<TopOffender>();
        return dto;
    }

    // ─── helpers ───

    /** Aggregation core, extracted so it's testable without SBQQ types.
     *  Each row map has keys: discount (Decimal), pricingMethod (String),
     *  productId (Id), productName (String). */
    @TestVisible
    private static void populateDtoFromRows(DisciplineDto dto, List<Map<String, Object>> rows) {
        dto.quoteLineCount = rows.size();
        if (rows.isEmpty()) return;
        List<Decimal> discounts = new List<Decimal>();
        Decimal totalDiscount = 0;
        Integer beyondLimit = 0;
        Integer overrideCnt = 0;
        Map<Id, TopOffender> byProduct = new Map<Id, TopOffender>();
        for (Map<String, Object> r : rows) {
            Decimal d = (Decimal) r.get('discount');
            if (d == null) d = 0;
            discounts.add(d);
            totalDiscount += d;
            if (d > DEFAULT_MAX_DISCOUNT_PCT) beyondLimit += 1;
            String pm = (String) r.get('pricingMethod');
            Boolean isOverride = (pm == 'Manual');
            if (isOverride) overrideCnt += 1;
            Id prodId = (Id) r.get('productId');
            if (prodId != null) {
                TopOffender o = byProduct.get(prodId);
                if (o == null) {
                    o = new TopOffender();
                    o.productId = prodId;
                    o.productName = (String) r.get('productName');
                    if (o.productName == null) o.productName = 'Unknown';
                    o.lineCount = 0; o.avgDiscount = 0; o.overrideCount = 0;
                    byProduct.put(prodId, o);
                }
                o.lineCount += 1;
                o.avgDiscount += d;
                if (isOverride) o.overrideCount += 1;
            }
        }
        Integer n = rows.size();
        dto.avgDiscount = (totalDiscount / Decimal.valueOf(n)).setScale(1, System.RoundingMode.HALF_UP);
        dto.medianDiscount = computeMedian(discounts).setScale(1, System.RoundingMode.HALF_UP);
        dto.beyondLimitCount = beyondLimit;
        dto.beyondLimitPct = (Decimal.valueOf(beyondLimit) / Decimal.valueOf(n) * 100).setScale(1, System.RoundingMode.HALF_UP);
        dto.overrideCount = overrideCnt;
        dto.overridePct = (Decimal.valueOf(overrideCnt) / Decimal.valueOf(n) * 100).setScale(1, System.RoundingMode.HALF_UP);
        dto.grade = letterGrade(dto.avgDiscount, dto.overridePct);
        dto.narrative = narrative(dto.grade, dto.avgDiscount, dto.overridePct);
        if (dto.overridePct < 5)       { dto.overrideRiskLabel = 'Low';    dto.overrideRiskCopy = 'calculated price is honored'; }
        else if (dto.overridePct < 15) { dto.overrideRiskLabel = 'Medium'; dto.overrideRiskCopy = 'manual overrides growing — review trends'; }
        else                           { dto.overrideRiskLabel = 'High';   dto.overrideRiskCopy = 'frequent overrides bypassing CPQ — tighten controls'; }
        // Top offenders
        List<TopOffender> productList = byProduct.values();
        for (TopOffender o : productList) {
            if (o.lineCount > 0) o.avgDiscount = (o.avgDiscount / Decimal.valueOf(o.lineCount)).setScale(1, System.RoundingMode.HALF_UP);
        }
        List<TopOffender> disc = new List<TopOffender>();
        for (TopOffender o : productList) {
            if (o.lineCount >= 2 && o.avgDiscount > 0) disc.add(o);
        }
        disc.sort(new TopOffenderAvgComparator());
        dto.topDiscountOffenders = sliceTop(disc, 5);
        List<TopOffender> ovr = new List<TopOffender>();
        for (TopOffender o : productList) {
            if (o.overrideCount > 0) ovr.add(o);
        }
        ovr.sort(new TopOffenderOverrideComparator());
        dto.topOverrideOffenders = sliceTop(ovr, 5);
    }

    @TestVisible
    private static Decimal computeMedian(List<Decimal> values) {
        if (values.isEmpty()) return 0;
        values.sort();
        Integer n = values.size();
        if (Math.mod(n, 2) == 1) return values[n / 2];
        return (values[n / 2 - 1] + values[n / 2]) / 2;
    }

    /**
     * Phase 19d — read grade thresholds from PricingGradeRule__mdt.
     * Falls back to the original hardcoded thresholds when the mdt
     * records aren't deployed yet (defensive — keeps tests + e2e
     * working in any org state).
     */
    @TestVisible
    private static String letterGrade(Decimal avgDiscount, Decimal overridePct) {
        List<PricingGradeRule__mdt> rules;
        try {
            rules = [
                SELECT GradeLetter__c, MaxAvgDiscountPct__c, MaxOverridePct__c
                FROM PricingGradeRule__mdt
                ORDER BY Sequence__c ASC NULLS LAST
            ];
        } catch (Exception e) {
            rules = null;
        }
        if (rules != null && !rules.isEmpty()) {
            for (PricingGradeRule__mdt r : rules) {
                Decimal maxDisc = r.MaxAvgDiscountPct__c == null ? 0 : r.MaxAvgDiscountPct__c;
                Decimal maxOvr  = r.MaxOverridePct__c == null ? 0 : r.MaxOverridePct__c;
                if (avgDiscount < maxDisc && overridePct < maxOvr) {
                    return r.GradeLetter__c == null ? 'F' : r.GradeLetter__c;
                }
            }
            // Last rule (F) carries effectively-infinite thresholds; if
            // somehow nothing matched, surface F as the safe default.
            return rules[rules.size() - 1].GradeLetter__c == null
                ? 'F' : rules[rules.size() - 1].GradeLetter__c;
        }
        // Fallback to hardcoded thresholds when mdt isn't seeded.
        if (avgDiscount < 15 && overridePct < 10) return 'A';
        if (avgDiscount < 25 && overridePct < 20) return 'B';
        if (avgDiscount < 35 && overridePct < 35) return 'C';
        if (avgDiscount < 50 && overridePct < 50) return 'D';
        return 'F';
    }

    @TestVisible
    private static String narrative(String grade, Decimal avgDiscount, Decimal overridePct) {
        String a = avgDiscount.setScale(1, System.RoundingMode.HALF_UP).format();
        String o = overridePct.setScale(1, System.RoundingMode.HALF_UP).format();
        if (grade == 'A') return 'Pricing discipline is strong — avg discount ' + a + '%, manual overrides on just ' + o + '% of lines.';
        if (grade == 'B') return 'Pricing discipline is healthy. Avg discount ' + a + '%; ' + o + '% of lines carry a manual override.';
        if (grade == 'C') return 'Discount creep starting. Avg ' + a + '% discount and ' + o + '% override rate suggest approval rules may need tightening.';
        if (grade == 'D') return 'Discount discipline is weakening — ' + a + '% avg discount, ' + o + '% override rate. Reps are leaving negotiating room on the table.';
        return 'Pricing controls are not working. Avg discount ' + a + '% with ' + o + '% of lines manually overridden. Approval routing requires immediate review.';
    }

    @TestVisible
    private static List<TopOffender> sliceTop(List<TopOffender> src, Integer n) {
        List<TopOffender> out = new List<TopOffender>();
        Integer endIdx = Math.min(n, src.size());
        for (Integer i = 0; i < endIdx; i++) out.add(src[i]);
        return out;
    }

    public class TopOffenderAvgComparator implements Comparator<TopOffender> {
        public Integer compare(TopOffender a, TopOffender b) {
            if (b.avgDiscount > a.avgDiscount) return 1;
            if (b.avgDiscount < a.avgDiscount) return -1;
            return 0;
        }
    }
    public class TopOffenderOverrideComparator implements Comparator<TopOffender> {
        public Integer compare(TopOffender a, TopOffender b) {
            return b.overrideCount - a.overrideCount;
        }
    }
}
