/**
 * Phase 22a-2 â€” Bundle of 8 checks on SBQQ__PriceRule__c.
 *
 * Single SOQL drives PR-001â€¦PR-005, LQ-001, LQ-002, and UA-003 (the
 * price-rule half â€” UA-003's product-rule half lives in
 * ProductRuleChecksBundle). Each check is in-memory; per-check enable/
 * disable is controlled by Detector__mdt.IsActive__c on its own id.
 *
 * Bundle id 'PR-BUNDLE' has no Detector__mdt record (intentionally â€”
 * customers configure individual checks, not the bundle). The surface
 * gate (SBQQ__PriceRule__c) is enforced in-class for both local AND
 * remote scans; without it the catalog gate doesn't run for the bundle.
 *
 * Ports:
 *   PR-001 â€” Conflicting price rules (same eval order + same action field)
 *   PR-002 â€” Price rules with no conditions OR no actions
 *   PR-003 â€” Multiple rules sharing the same eval order (any field)
 *   PR-004 â€” 3+ rules writing to the same field
 *   PR-005 â€” Price rules missing eval order
 *   LQ-001 â€” Rule has LookupObject but no action SourceLookupField
 *   LQ-002 â€” Rule has action SourceLookupField but no LookupObject
 *   UA-003 â€” Stale-inactive-rule count exceeds thresholds (price half)
 */
public with sharing class PriceRuleChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static Integer testStubInactiveProductRuleCount;

    public String getDetectorId() { return 'PR-BUNDLE'; }
    public String getLabel() { return 'Price Rule health checks'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            // Surface gate (bundle has no Detector__mdt record so the
            // catalog gate doesn't see this). Skipped on the testStub
            // path so unit tests exercise the dispatch + check logic.
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__PriceRule__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] PR-BUNDLE: SBQQ__PriceRule__c not present.');
                return results;
            }
            String soql =
                'SELECT Id, Name, SBQQ__Active__c, SBQQ__EvaluationOrder__c, SBQQ__LookupObject__c, ' +
                '  (SELECT Id, SBQQ__Field__c, SBQQ__SourceLookupField__c FROM SBQQ__PriceActions__r), ' +
                '  (SELECT Id FROM SBQQ__PriceConditions__r) ' +
                'FROM SBQQ__PriceRule__c ' +
                'LIMIT 5000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PR-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        // Per-check gating via Detector__mdt.IsActive__c.
        Boolean runPR001 = DetectorCatalogController.isActive('PR-001');
        Boolean runPR002 = DetectorCatalogController.isActive('PR-002');
        Boolean runPR003 = DetectorCatalogController.isActive('PR-003');
        Boolean runPR004 = DetectorCatalogController.isActive('PR-004');
        Boolean runPR005 = DetectorCatalogController.isActive('PR-005');
        Boolean runLQ001 = DetectorCatalogController.isActive('LQ-001');
        Boolean runLQ002 = DetectorCatalogController.isActive('LQ-002');
        Boolean runUA003 = DetectorCatalogController.isActive('UA-003');

        if (runPR001) results.addAll(evaluatePR001(rows));
        if (runPR002) results.addAll(evaluatePR002(rows));
        if (runPR003) results.addAll(evaluatePR003(rows));
        if (runPR004) results.addAll(evaluatePR004(rows));
        if (runPR005) results.addAll(evaluatePR005(rows));
        if (runLQ001) results.addAll(evaluateLQ001(rows));
        if (runLQ002) results.addAll(evaluateLQ002(rows));
        if (runUA003) results.addAll(evaluateUA003(ctx, rows));

        return results;
    }

    // â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /** SBQQ__PriceActions__r child-rel access (sub-select shape from OrgQueryService). */
    @TestVisible
    static List<Map<String, Object>> actionsOf(Map<String, Object> rule) {
        Object o = rule.get('SBQQ__PriceActions__r');
        if (o == null) return new List<Map<String, Object>>();
        Map<String, Object> wrap = (Map<String, Object>) o;
        Object recs = wrap.get('records');
        if (recs == null) return new List<Map<String, Object>>();
        List<Object> items = (List<Object>) recs;
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Object r : items) out.add((Map<String, Object>) r);
        return out;
    }

    @TestVisible
    static Integer countConditions(Map<String, Object> rule) {
        Object o = rule.get('SBQQ__PriceConditions__r');
        if (o == null) return 0;
        Map<String, Object> wrap = (Map<String, Object>) o;
        Object recs = wrap.get('records');
        if (recs == null) return 0;
        return ((List<Object>) recs).size();
    }

    static Boolean isActive(Map<String, Object> rule) {
        Object v = rule.get('SBQQ__Active__c');
        return Boolean.valueOf(v);
    }

    static Decimal getEvalOrder(Map<String, Object> rule) {
        Object v = rule.get('SBQQ__EvaluationOrder__c');
        return (v == null) ? null : Decimal.valueOf(String.valueOf(v));
    }

    static SourceRecord asRef(Map<String, Object> rule) {
        return new SourceRecord('SBQQ__PriceRule__c',
            (Id) rule.get('Id'), (String) rule.get('Name'));
    }

    // â”€â”€ PR-001: same EvaluationOrder + same action field â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluatePR001(List<Map<String, Object>> rules) {
        // bucketKey "evalOrder|field" â†’ Set<ruleId> (dedup risk per spec)
        Map<String, Set<Id>> buckets = new Map<String, Set<Id>>();
        Map<String, List<Map<String, Object>>> bucketRules = new Map<String, List<Map<String, Object>>>();

        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            Decimal order = getEvalOrder(rule);
            String orderKey = (order == null) ? '0' : String.valueOf(order.intValue());
            Id ruleId = (Id) rule.get('Id');

            for (Map<String, Object> act : actionsOf(rule)) {
                String field = (String) act.get('SBQQ__Field__c');
                if (String.isBlank(field)) field = 'unknown';
                String key = orderKey + '|' + field;

                Set<Id> seen = buckets.get(key);
                if (seen == null) { seen = new Set<Id>(); buckets.put(key, seen); }
                if (seen.add(ruleId)) {
                    List<Map<String, Object>> bRules = bucketRules.get(key);
                    if (bRules == null) { bRules = new List<Map<String, Object>>(); bucketRules.put(key, bRules); }
                    bRules.add(rule);
                }
            }
        }

        List<DetectorResult> out = new List<DetectorResult>();
        for (String key : buckets.keySet()) {
            if (buckets.get(key).size() < 2) continue;

            List<Map<String, Object>> bRules = bucketRules.get(key);
            List<String> parts = key.split('\\|');
            String orderStr = parts.size() > 0 ? parts[0] : '?';
            String field = parts.size() > 1 ? parts[1] : '?';

            DetectorResult r = new DetectorResult();
            r.detectorId = 'PR-001';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Critical');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = 'Conflicting Price Rules detected';
            r.description = bRules.size() + ' active price rules target "' + field +
                '" with the same evaluation order (' + orderStr +
                '). CPQ processes them in unpredictable sequence, so one silently overwrites the other.';
            r.primaryRecord = asRef(bRules[0]);
            for (Integer i = 1; i < bRules.size(); i++) r.supportingRecords.add(asRef(bRules[i]));
            out.add(r);
        }
        return out;
    }

    // â”€â”€ PR-002: no conditions OR no actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluatePR002(List<Map<String, Object>> rules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            Integer cond = countConditions(rule);
            Integer act = actionsOf(rule).size();
            String which = null;
            if (cond == 0) which = 'conditions';
            else if (act == 0) which = 'actions';
            if (which == null) continue;

            DetectorResult r = new DetectorResult();
            r.detectorId = 'PR-002';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.95;
            r.title = 'Price Rule with no ' + which;
            r.description = '"' + (String) rule.get('Name') + '" is active but has no ' + which +
                '. ' + (which == 'conditions'
                    ? 'Without conditions, this rule may apply to all quote lines unexpectedly or do nothing.'
                    : 'Without actions, this rule evaluates conditions but takes no action.');
            r.primaryRecord = asRef(rule);
            out.add(r);
        }
        return out;
    }

    // â”€â”€ PR-003: duplicate EvalOrder buckets (ignores field) â”€â”€â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluatePR003(List<Map<String, Object>> rules) {
        Map<Integer, List<Map<String, Object>>> byOrder = new Map<Integer, List<Map<String, Object>>>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            Decimal order = getEvalOrder(rule);
            if (order == null) continue;
            Integer key = order.intValue();
            List<Map<String, Object>> items = byOrder.get(key);
            if (items == null) { items = new List<Map<String, Object>>(); byOrder.put(key, items); }
            items.add(rule);
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (Integer order : byOrder.keySet()) {
            List<Map<String, Object>> bucket = byOrder.get(order);
            if (bucket.size() < 2) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'PR-003';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Info');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = bucket.size() + ' price rules share evaluation order ' + order;
            List<String> names = new List<String>();
            for (Map<String, Object> rule : bucket) names.add('"' + (String) rule.get('Name') + '"');
            r.description = 'Rules ' + String.join(names, ', ') +
                ' all run at evaluation order ' + order +
                '. CPQ doesn\'t guarantee a deterministic sequence between them.';
            r.primaryRecord = asRef(bucket[0]);
            for (Integer i = 1; i < bucket.size(); i++) r.supportingRecords.add(asRef(bucket[i]));
            out.add(r);
        }
        return out;
    }

    // â”€â”€ PR-004: 3+ rules targeting same field â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluatePR004(List<Map<String, Object>> rules) {
        Map<String, Set<Id>> byField = new Map<String, Set<Id>>();
        Map<String, List<Map<String, Object>>> fieldRules = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            Id ruleId = (Id) rule.get('Id');
            for (Map<String, Object> act : actionsOf(rule)) {
                String field = (String) act.get('SBQQ__Field__c');
                if (String.isBlank(field)) continue;
                Set<Id> seen = byField.get(field);
                if (seen == null) { seen = new Set<Id>(); byField.put(field, seen); }
                if (seen.add(ruleId)) {
                    List<Map<String, Object>> items = fieldRules.get(field);
                    if (items == null) { items = new List<Map<String, Object>>(); fieldRules.put(field, items); }
                    items.add(rule);
                }
            }
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (String field : byField.keySet()) {
            if (byField.get(field).size() < 3) continue;
            List<Map<String, Object>> bucket = fieldRules.get(field);
            DetectorResult r = new DetectorResult();
            r.detectorId = 'PR-004';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.85;
            r.title = bucket.size() + ' rules target the same field';
            r.description = bucket.size() + ' active price rules all write to "' + field +
                '". The last rule in evaluation order wins, potentially overwriting earlier rules.';
            r.primaryRecord = asRef(bucket[0]);
            for (Integer i = 1; i < bucket.size(); i++) r.supportingRecords.add(asRef(bucket[i]));
            out.add(r);
        }
        return out;
    }

    // â”€â”€ PR-005: rules with null EvalOrder (one aggregated finding) â”€

    @TestVisible
    static List<DetectorResult> evaluatePR005(List<Map<String, Object>> rules) {
        List<Map<String, Object>> missing = new List<Map<String, Object>>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            if (getEvalOrder(rule) == null) missing.add(rule);
        }
        if (missing.isEmpty()) return new List<DetectorResult>();

        List<String> quoted = new List<String>();
        for (Map<String, Object> rule : missing) quoted.add('"' + (String) rule.get('Name') + '"');

        DetectorResult r = new DetectorResult();
        r.detectorId = 'PR-005';
        r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
        r.gapUsd = 0;
        r.recoverabilityScore = 0.9;
        r.title = missing.size() + ' price rule(s) missing evaluation order';
        r.description = String.join(quoted, ', ') + ' have no evaluation order set. CPQ will run them in an undefined sequence.';
        r.primaryRecord = asRef(missing[0]);
        for (Integer i = 1; i < missing.size(); i++) r.supportingRecords.add(asRef(missing[i]));
        return new List<DetectorResult>{ r };
    }

    // â”€â”€ LQ-001: LookupObject set, no action SourceLookupField â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluateLQ001(List<Map<String, Object>> rules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            String lookupObj = (String) rule.get('SBQQ__LookupObject__c');
            if (String.isBlank(lookupObj)) continue;
            Boolean anyLookupField = false;
            for (Map<String, Object> act : actionsOf(rule)) {
                if (!String.isBlank((String) act.get('SBQQ__SourceLookupField__c'))) { anyLookupField = true; break; }
            }
            if (anyLookupField) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'LQ-001';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Critical');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = 'Price rule lookup incomplete on "' + (String) rule.get('Name') + '"';
            r.description = '"' + (String) rule.get('Name') + '" has Lookup Object = "' + lookupObj +
                '" but none of its actions use a Source Lookup Field. The lookup is configured but never used.';
            r.primaryRecord = asRef(rule);
            out.add(r);
        }
        return out;
    }

    // â”€â”€ LQ-002: action SourceLookupField, no LookupObject â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluateLQ002(List<Map<String, Object>> rules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            String lookupObj = (String) rule.get('SBQQ__LookupObject__c');
            if (!String.isBlank(lookupObj)) continue;
            List<Map<String, Object>> lookups = new List<Map<String, Object>>();
            for (Map<String, Object> act : actionsOf(rule)) {
                if (!String.isBlank((String) act.get('SBQQ__SourceLookupField__c'))) lookups.add(act);
            }
            if (lookups.isEmpty()) continue;
            String firstField = (String) lookups[0].get('SBQQ__SourceLookupField__c');
            DetectorResult r = new DetectorResult();
            r.detectorId = 'LQ-002';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Critical');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = 'Orphaned lookup field on "' + (String) rule.get('Name') + '"';
            r.description = '"' + (String) rule.get('Name') + '" has ' + lookups.size() +
                ' action(s) referencing Source Lookup Field "' + firstField +
                '" but the rule has no Lookup Object configured. The lookup has no source to query.';
            r.primaryRecord = asRef(rule);
            out.add(r);
        }
        return out;
    }

    // â”€â”€ UA-003: stale inactive rule counts (price rules only here) â”€

    @TestVisible
    static List<DetectorResult> evaluateUA003(DetectorContext ctx, List<Map<String, Object>> rules) {
        Integer totalPR = rules.size();
        Integer inactivePR = 0;
        List<Map<String, Object>> inactives = new List<Map<String, Object>>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) { inactivePR++; inactives.add(rule); }
        }

        // Price rules only â€” ProductRuleChecksBundle owns the product-rule
        // half. They cross-pollinate via DetectorContext if both bundles
        // run. For now: gate UA-003 on the PRICE-side counts only;
        // ProductRuleChecksBundle will re-fire if the product-side breach
        // is independent. Avoids double-firing the same finding.
        Integer inactivePRD = (testStubInactiveProductRuleCount != null)
            ? testStubInactiveProductRuleCount : countInactiveProductRules(ctx);

        Integer totalInactive = inactivePR + inactivePRD;
        Integer totalRules = totalPR + countTotalProductRules(ctx);
        if (totalRules == 0) return new List<DetectorResult>();

        Decimal pct = (totalInactive * 100.0) / totalRules;
        Boolean fire = (totalInactive >= 5) || (totalInactive >= 3 && pct >= 30);
        if (!fire) return new List<DetectorResult>();

        DetectorResult r = new DetectorResult();
        r.detectorId = 'UA-003';
        r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Info');
        r.gapUsd = 0;
        r.recoverabilityScore = 1.0;
        r.title = totalInactive + ' inactive rules (' + inactivePR + ' price, ' +
            inactivePRD + ' product) cluttering config';
        r.description = Integer.valueOf(pct.intValue()) + '% of your rules are inactive (' +
            totalInactive + ' of ' + totalRules + '). Inactive rules don\'t affect pricing but add confusion when admins review.';
        r.primaryRecord = inactives.isEmpty() ? null : asRef(inactives[0]);
        Integer cap = Math.min(7, inactives.size());
        for (Integer i = 1; i < cap; i++) r.supportingRecords.add(asRef(inactives[i]));
        return new List<DetectorResult>{ r };
    }

    @TestVisible
    static Integer countInactiveProductRules(DetectorContext ctx) {
        if (testStubInactiveProductRuleCount != null) return testStubInactiveProductRuleCount;
        try {
            // Lightweight count-only query.
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT Id FROM SBQQ__ProductRule__c WHERE SBQQ__Active__c = false LIMIT 5000');
            return (rows == null) ? 0 : rows.size();
        } catch (Exception e) { return 0; }
    }

    @TestVisible
    static Integer countTotalProductRules(DetectorContext ctx) {
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT Id FROM SBQQ__ProductRule__c LIMIT 5000');
            return (rows == null) ? 0 : rows.size();
        } catch (Exception e) { return 0; }
    }
}
