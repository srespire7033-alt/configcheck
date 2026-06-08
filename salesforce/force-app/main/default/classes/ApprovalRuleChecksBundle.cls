/**
 * Phase 22a-5 — 5 checks on SBQQ__ApprovalRule__c.
 *
 *   AR-001 — Active rule with no Approver and no ApproverField (critical)
 *   AR-002 — Active rule with no conditions (warning)
 *   AR-003 — Duplicate EvaluationOrder (warning)
 *   AR-004 — Has conditions but missing ConditionsMet (warning)
 *   AR-005 — Inactive rules cleanup (info, aggregated)
 */
public with sharing class ApprovalRuleChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'AR-BUNDLE'; }
    public String getLabel() { return 'Approval Rule health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__ApprovalRule__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] AR-BUNDLE: SBQQ__ApprovalRule__c not present.');
                return results;
            }
            String soql =
                'SELECT Id, Name, SBQQ__Active__c, SBQQ__EvaluationOrder__c, ' +
                '  SBQQ__Approver__c, SBQQ__ApproverField__c, SBQQ__ConditionsMet__c, ' +
                '  (SELECT Id FROM SBQQ__ApprovalConditions__r LIMIT 100) ' +
                'FROM SBQQ__ApprovalRule__c LIMIT 5000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] AR-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        Boolean runAR001 = DetectorCatalogController.isActive('AR-001');
        Boolean runAR002 = DetectorCatalogController.isActive('AR-002');
        Boolean runAR003 = DetectorCatalogController.isActive('AR-003');
        Boolean runAR004 = DetectorCatalogController.isActive('AR-004');
        Boolean runAR005 = DetectorCatalogController.isActive('AR-005');

        // AR-001 migrated to CustomDetector__mdt (Phase 24f pilot).
        // if (runAR001) results.addAll(evaluateAR001(rows));
        if (runAR002) results.addAll(evaluateAR002(rows));
        if (runAR003) results.addAll(evaluateAR003(rows));
        if (runAR004) results.addAll(evaluateAR004(rows));
        if (runAR005) results.addAll(evaluateAR005(rows));
        return results;
    }

    static Boolean isActive(Map<String, Object> r) { return Boolean.valueOf(r.get('SBQQ__Active__c')); }
    static Integer conditionCountOf(Map<String, Object> r) {
        Object o = r.get('SBQQ__ApprovalConditions__r');
        if (o == null) return 0;
        Object recs = ((Map<String, Object>) o).get('records');
        return (recs == null) ? 0 : ((List<Object>) recs).size();
    }
    static SourceRecord ref(Map<String, Object> r) {
        return new SourceRecord('SBQQ__ApprovalRule__c', (Id) r.get('Id'), (String) r.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateAR001(List<Map<String, Object>> rules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            if (r.get('SBQQ__Approver__c') != null) continue;
            Object af = r.get('SBQQ__ApproverField__c');
            if (af != null && !String.isBlank(String.valueOf(af))) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'AR-001'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = 'Approval rule "' + (String) r.get('Name') + '" has no approver';
            dr.description = '"' + (String) r.get('Name') + '" is active but has neither Approver nor Approver Field. Quotes hitting this rule will have no one to approve them.';
            dr.primaryRecord = ref(r);
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateAR002(List<Map<String, Object>> rules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            if (conditionCountOf(r) > 0) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'AR-002'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = 'Approval rule "' + (String) r.get('Name') + '" has no conditions';
            dr.description = '"' + (String) r.get('Name') + '" is active but has no conditions. Every quote may trigger this rule regardless of criteria.';
            dr.primaryRecord = ref(r);
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateAR003(List<Map<String, Object>> rules) {
        Map<Integer, List<Map<String, Object>>> byOrder = new Map<Integer, List<Map<String, Object>>>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            Object o = r.get('SBQQ__EvaluationOrder__c');
            if (o == null) continue;
            Integer evalOrder = Decimal.valueOf(String.valueOf(o)).intValue();
            if (!byOrder.containsKey(evalOrder)) byOrder.put(evalOrder, new List<Map<String, Object>>());
            byOrder.get(evalOrder).add(r);
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (Integer evalOrder : byOrder.keySet()) {
            List<Map<String, Object>> bucket = byOrder.get(evalOrder);
            if (bucket.size() < 2) continue;
            List<String> names = new List<String>();
            for (Map<String, Object> r : bucket) names.add('"' + (String) r.get('Name') + '"');
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'AR-003'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = bucket.size() + ' approval rules share evaluation order ' + evalOrder;
            dr.description = 'Rules ' + String.join(names, ', ') + ' all have evaluation order ' + evalOrder + '. Execution sequence is unpredictable.';
            dr.primaryRecord = ref(bucket[0]);
            for (Integer i = 1; i < bucket.size(); i++) dr.supportingRecords.add(ref(bucket[i]));
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateAR004(List<Map<String, Object>> rules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            Integer condCount = conditionCountOf(r);
            if (condCount == 0) continue;
            Object cm = r.get('SBQQ__ConditionsMet__c');
            if (cm != null && !String.isBlank(String.valueOf(cm))) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'AR-004'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = 'Approval rule "' + (String) r.get('Name') + '" missing Conditions Met logic';
            dr.description = '"' + (String) r.get('Name') + '" has ' + condCount + ' condition(s) but Conditions Met is not set ("All" or "Any").';
            dr.primaryRecord = ref(r);
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateAR005(List<Map<String, Object>> rules) {
        List<Map<String, Object>> inactives = new List<Map<String, Object>>();
        for (Map<String, Object> r : rules) if (!isActive(r)) inactives.add(r);
        if (inactives.isEmpty()) return new List<DetectorResult>();
        List<String> sample = new List<String>();
        Integer sampleCap = Math.min(5, inactives.size());
        for (Integer i = 0; i < sampleCap; i++) sample.add('"' + (String) inactives[i].get('Name') + '"');
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'AR-005'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = inactives.size() + ' inactive approval rule(s)';
        dr.description = inactives.size() + ' approval rule(s) are deactivated: ' + String.join(sample, ', ') +
            (inactives.size() > 5 ? ' and ' + (inactives.size() - 5) + ' more.' : '.');
        dr.primaryRecord = ref(inactives[0]);
        Integer cap = Math.min(10, inactives.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(inactives[i]));
        return new List<DetectorResult>{ dr };
    }
}
