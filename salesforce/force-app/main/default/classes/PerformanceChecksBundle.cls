/**
 * Phase 22a-6 — 5 PERF checks. All aggregate counts across multiple objects.
 *
 *   PERF-001 — High active price rule count (≥50, critical ≥100)
 *   PERF-002 — High active product rule count (≥30, critical ≥60)
 *   PERF-003 — High avg/max quote line count (warn or critical)
 *   PERF-004 — High active summary variable count (≥20)
 *   PERF-005 — Composite CPQ complexity score (≥50)
 */
public with sharing class PerformanceChecksBundle implements IDetector {

    @TestVisible static Integer testStubActivePR;
    @TestVisible static Integer testStubActivePRD;
    @TestVisible static Integer testStubActiveSV;
    @TestVisible static Integer testStubActiveDS;
    @TestVisible static Integer testStubProducts;
    @TestVisible static Integer testStubProductOptions;
    @TestVisible static Boolean testStubHasQcp;
    @TestVisible static Map<String, Integer> testStubQuoteLineStats; // 'avg', 'max', 'heavyCount', 'quoteCount'

    public String getDetectorId() { return 'PERF-BUNDLE'; }
    public String getLabel() { return 'CPQ Performance health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        Boolean usingStubs = (testStubActivePR != null || testStubActivePRD != null
            || testStubActiveSV != null || testStubQuoteLineStats != null);
        if (!usingStubs && !ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__PriceRule__c')) {
            System.debug(LoggingLevel.INFO, '[OrgPrism Skip] PERF-BUNDLE: SBQQ surface not present.');
            return results;
        }

        Integer activePR = (testStubActivePR != null) ? testStubActivePR : countActive(ctx, 'SBQQ__PriceRule__c');
        Integer activePRD = (testStubActivePRD != null) ? testStubActivePRD : countActive(ctx, 'SBQQ__ProductRule__c');
        Integer activeSV = (testStubActiveSV != null) ? testStubActiveSV : countActive(ctx, 'SBQQ__SummaryVariable__c');
        Integer activeDS = (testStubActiveDS != null) ? testStubActiveDS : countAll(ctx, 'SBQQ__DiscountSchedule__c');
        Integer productCount = (testStubProducts != null) ? testStubProducts : countWhere(ctx, 'Product2', 'IsActive = true');
        Integer optionCount = (testStubProductOptions != null) ? testStubProductOptions : countAll(ctx, 'SBQQ__ProductOption__c');
        Boolean hasQcp = (testStubHasQcp != null) ? testStubHasQcp : checkQcpExists(ctx);

        if (DetectorCatalogController.isActive('PERF-001')) results.addAll(evaluatePERF001(activePR));
        if (DetectorCatalogController.isActive('PERF-002')) results.addAll(evaluatePERF002(activePRD));
        if (DetectorCatalogController.isActive('PERF-003')) results.addAll(evaluatePERF003(ctx, activePR));
        if (DetectorCatalogController.isActive('PERF-004')) results.addAll(evaluatePERF004(activeSV));
        if (DetectorCatalogController.isActive('PERF-005')) results.addAll(evaluatePERF005(
            activePR, activePRD, activeSV, activeDS, productCount, optionCount, hasQcp));
        return results;
    }

    @TestVisible
    static Integer countActive(DetectorContext ctx, String obj) {
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT Id FROM ' + obj + ' WHERE SBQQ__Active__c = true LIMIT 5000');
            return rows.size();
        } catch (Exception e) { return 0; }
    }
    @TestVisible
    static Integer countAll(DetectorContext ctx, String obj) {
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx, 'SELECT Id FROM ' + obj + ' LIMIT 5000');
            return rows.size();
        } catch (Exception e) { return 0; }
    }
    @TestVisible
    static Integer countWhere(DetectorContext ctx, String obj, String whereClause) {
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT Id FROM ' + obj + ' WHERE ' + whereClause + ' LIMIT 5000');
            return rows.size();
        } catch (Exception e) { return 0; }
    }
    @TestVisible
    static Boolean checkQcpExists(DetectorContext ctx) {
        if (!SchemaUtil.hasObject('SBQQ__CustomScript__c')) return false;
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT Id FROM SBQQ__CustomScript__c WHERE SBQQ__Type__c = \'Quote Calculator Plugin\' LIMIT 1');
            return !rows.isEmpty();
        } catch (Exception e) { return false; }
    }

    @TestVisible
    static List<DetectorResult> evaluatePERF001(Integer n) {
        if (n < 50) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'PERF-001'; dr.severity = (n >= 100) ? 'Critical' : 'Warning';
        dr.gapUsd = 0; dr.recoverabilityScore = 0.7;
        dr.title = n + ' active price rules — performance risk';
        dr.description = 'Org has ' + n + ' active price rules. Estimated added time: ~' +
            Integer.valueOf(n * 0.15) + 's per quote save. Salesforce recommends < 50.';
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluatePERF002(Integer n) {
        if (n < 30) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'PERF-002'; dr.severity = (n >= 60) ? 'Critical' : 'Warning';
        dr.gapUsd = 0; dr.recoverabilityScore = 0.75;
        dr.title = n + ' active product rules — configurator may be slow';
        dr.description = 'Org has ' + n + ' active product rules. Each is evaluated during config + calculation.';
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluatePERF003(DetectorContext ctx, Integer activePR) {
        Map<String, Integer> stats = (testStubQuoteLineStats != null)
            ? testStubQuoteLineStats : computeQLStats(ctx);
        Integer avgLines = stats.get('avg');
        Integer maxLines = stats.get('max');
        Integer heavyCount = stats.get('heavyCount');
        Integer quoteCount = stats.get('quoteCount');
        if (quoteCount == 0) return new List<DetectorResult>();
        if (!(maxLines > 100 || avgLines > 50)) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'PERF-003';
        dr.severity = (maxLines > 200) ? 'Critical' : 'Warning';
        dr.gapUsd = 0; dr.recoverabilityScore = 0.7;
        dr.title = 'Quotes averaging ' + avgLines + ' lines (max: ' + maxLines + ')';
        dr.description = 'Across ' + quoteCount + ' quotes the average is ' + avgLines +
            ' lines/quote with max ' + maxLines + '. ' + heavyCount + ' quote(s) > 100 lines. With ' +
            activePR + ' active rules, max-quote evaluates ~' + (maxLines * activePR) + ' rule-line combinations.';
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static Map<String, Integer> computeQLStats(DetectorContext ctx) {
        Map<String, Integer> out = new Map<String, Integer>{
            'avg' => 0, 'max' => 0, 'heavyCount' => 0, 'quoteCount' => 0
        };
        try {
            // Group by quote — limited sample to keep scan bounded.
            Map<Id, Integer> linesByQuote = new Map<Id, Integer>();
            for (Map<String, Object> row : OrgQueryService.query(ctx,
                'SELECT SBQQ__Quote__c FROM SBQQ__QuoteLine__c WHERE SBQQ__Quote__c != null LIMIT 50000')) {
                Object qid = row.get('SBQQ__Quote__c');
                if (qid != null) {
                    Id k = (Id) qid;
                    linesByQuote.put(k, (linesByQuote.containsKey(k) ? linesByQuote.get(k) : 0) + 1);
                }
            }
            if (linesByQuote.isEmpty()) return out;
            Integer total = 0, mx = 0, heavy = 0;
            for (Integer c : linesByQuote.values()) {
                total += c;
                if (c > mx) mx = c;
                if (c > 100) heavy++;
            }
            out.put('avg', total / linesByQuote.size());
            out.put('max', mx);
            out.put('heavyCount', heavy);
            out.put('quoteCount', linesByQuote.size());
        } catch (Exception e) { /* skip */ }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluatePERF004(Integer n) {
        if (n < 20) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'PERF-004'; dr.severity = (n >= 40) ? 'Warning' : 'Info';
        dr.gapUsd = 0; dr.recoverabilityScore = 0.8;
        dr.title = n + ' active summary variables';
        dr.description = 'Org has ' + n + ' active summary variables. Each performs an aggregation on every calculation.';
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluatePERF005(Integer pr, Integer prd, Integer sv, Integer ds, Integer prod, Integer po, Boolean hasQcp) {
        Decimal score = (pr * 3) + (prd * 2) + (sv * 1.5) + ds + (po * 0.5) + (hasQcp ? 20 : 0);
        if (score < 50) return new List<DetectorResult>();
        String level = (score >= 200) ? 'Very High' : (score >= 100 ? 'High' : 'Moderate');
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'PERF-005';
        dr.severity = (score >= 200) ? 'Critical' : (score >= 100 ? 'Warning' : 'Info');
        dr.gapUsd = 0; dr.recoverabilityScore = 0.7;
        dr.title = 'CPQ complexity: ' + level + ' (score: ' + Integer.valueOf(score.intValue()) + ')';
        dr.description = 'Breakdown: ' + pr + ' price rules (×3), ' + prd + ' product rules (×2), ' +
            sv + ' summary variables (×1.5), ' + ds + ' discount schedules (×1), ' +
            prod + ' products, ' + po + ' product options (×0.5)' +
            (hasQcp ? ', QCP active (+20)' : '') + '. Weighted score: ' + Integer.valueOf(score.intValue()) + '.';
        return new List<DetectorResult>{ dr };
    }
}
