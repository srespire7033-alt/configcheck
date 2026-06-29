/**
 * Phase 22a-6 — 5 PERF checks. All aggregate counts across multiple objects.
 *
 *   PERF-001 — High active price rule count (≥50, critical ≥100)
 *   PERF-002 — High active product rule count (≥30, critical ≥60)
 *   PERF-003 — High avg/max quote line count (warn or critical)
 *   PERF-004 — High active summary variable count (≥20)
 *   PERF-005 — Composite CPQ complexity score (≥50)
 *   PERF-006 — ≥3 active record-triggered flows on the same object (UI-latency / dup-automation signal)
 *   PERF-007 — Async Apex queue saturated (queued backlog or recent failures)
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
    /** PERF-006 — Map<sObjectName, activeFlowCount> across record-triggered flows. */
    @TestVisible static Map<String, Integer> testStubFlowCountsByObject;
    /** PERF-007 — async Apex queue + failure metrics. Keys: queuedNow, failed24h. */
    @TestVisible static Map<String, Integer> testStubAsyncApexStats;

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
        if (DetectorCatalogController.isActive('PERF-006')) {
            Map<String, Integer> flowCounts = (testStubFlowCountsByObject != null)
                ? testStubFlowCountsByObject : fetchFlowCountsByObject(ctx);
            results.addAll(evaluatePERF006(flowCounts));
        }
        if (DetectorCatalogController.isActive('PERF-007')) {
            Map<String, Integer> stats = (testStubAsyncApexStats != null)
                ? testStubAsyncApexStats : fetchAsyncApexStats(ctx);
            results.addAll(evaluatePERF007(stats));
        }
        return results;
    }

    /** Count active record-triggered flows grouped by triggered SObject.
     *  FlowDefinitionView is a standard SOQL-queryable view on flows; available to
     *  any user with View All Data. Returns empty map on any failure. */
    static Map<String, Integer> fetchFlowCountsByObject(DetectorContext ctx) {
        Map<String, Integer> out = new Map<String, Integer>();
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT TriggerObjectOrEventLabel obj, COUNT(Id) cnt ' +
                'FROM FlowDefinitionView ' +
                'WHERE IsActive = true ' +
                '  AND TriggerType IN (\'RecordAfterSave\', \'RecordBeforeSave\') ' +
                '  AND TriggerObjectOrEventLabel != null ' +
                'GROUP BY TriggerObjectOrEventLabel');
            for (Map<String, Object> row : rows) {
                Object obj = row.get('obj');
                Object c = row.get('cnt');
                if (obj != null && c != null) out.put(String.valueOf(obj), Integer.valueOf(c));
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PERF-006 flowCounts: ' + e.getMessage());
        }
        return out;
    }

    /** Pull current async Apex queue depth + last-24h failure count. */
    static Map<String, Integer> fetchAsyncApexStats(DetectorContext ctx) {
        Map<String, Integer> out = new Map<String, Integer>{ 'queuedNow' => 0, 'failed24h' => 0 };
        try {
            List<Map<String, Object>> q = OrgQueryService.query(ctx,
                'SELECT Id FROM AsyncApexJob ' +
                'WHERE Status IN (\'Queued\', \'Preparing\', \'Processing\') ' +
                'LIMIT 2000');
            out.put('queuedNow', q.size());
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PERF-007 queued: ' + e.getMessage());
        }
        try {
            List<Map<String, Object>> f = OrgQueryService.query(ctx,
                'SELECT Id FROM AsyncApexJob ' +
                'WHERE Status = \'Failed\' AND CreatedDate = LAST_N_HOURS:24 ' +
                'LIMIT 2000');
            out.put('failed24h', f.size());
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PERF-007 failed: ' + e.getMessage());
        }
        return out;
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

    // PERF-006: ≥3 active record-triggered flows on the same SObject.
    // PP-263 signature: duplicate/redundant flows causing UI latency and
    // spinning-wheel timeouts. Three is the threshold where order-of-
    // execution interactions get hard to reason about; five+ is where
    // performance starts to bite. Per-object findings (one DR per object).
    @TestVisible
    static List<DetectorResult> evaluatePERF006(Map<String, Integer> flowCountsByObject) {
        List<DetectorResult> out = new List<DetectorResult>();
        if (flowCountsByObject == null) return out;
        for (String objName : flowCountsByObject.keySet()) {
            Integer count = flowCountsByObject.get(objName);
            if (count == null || count < 3) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'PERF-006';
            dr.severity = (count >= 5) ? 'Critical' : 'Warning';
            dr.gapUsd = 0;
            dr.recoverabilityScore = 0.7;
            dr.title = count + ' active flows on ' + objName + ' — UI latency / dup-automation risk';
            dr.description = 'Object "' + objName + '" has ' + count + ' active record-triggered ' +
                'flows. Order of execution interactions compound on every save: each flow runs ' +
                'serially, can re-trigger field updates, and the combined runtime contributes ' +
                'to UI timeouts on edit pages. Consolidate where logic overlaps; document the ' +
                'order of execution for the rest.';
            out.add(dr);
        }
        return out;
    }

    // PERF-007: Async Apex queue saturation. PP-57 / PP-264 signature:
    // payment sync queueables piling up; "entire org hitting Apex async
    // limit." Two failure modes covered:
    //   • queuedNow > 250 → standing backlog, jobs taking too long
    //   • failed24h > 100 → systematic failure pattern
    @TestVisible
    static List<DetectorResult> evaluatePERF007(Map<String, Integer> stats) {
        if (stats == null) return new List<DetectorResult>();
        Integer queued = stats.containsKey('queuedNow') ? stats.get('queuedNow') : 0;
        Integer failed = stats.containsKey('failed24h') ? stats.get('failed24h') : 0;
        Boolean queueAlert = queued != null && queued > 250;
        Boolean failureAlert = failed != null && failed > 100;
        if (!queueAlert && !failureAlert) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'PERF-007';
        Boolean critical = (queued != null && queued > 1000) || (failed != null && failed > 500);
        dr.severity = critical ? 'Critical' : 'Warning';
        dr.gapUsd = 0;
        dr.recoverabilityScore = 0.7;
        List<String> parts = new List<String>();
        if (queueAlert) parts.add(queued + ' job(s) currently queued/processing');
        if (failureAlert) parts.add(failed + ' job(s) failed in last 24 hours');
        dr.title = 'Async Apex saturation: ' + String.join(parts, '; ');
        dr.description = 'AsyncApexJob backlog or failure rate exceeds healthy thresholds (' +
            queued + ' queued, ' + failed + ' failed in 24h). Symptoms: payment sync drops, ' +
            'queueable retries lost, downstream integrations partially complete. Investigate ' +
            'long-running queueables, missing retry logic, and recent volume spikes from ' +
            'anonymous-execution callouts.';
        return new List<DetectorResult>{ dr };
    }
}
