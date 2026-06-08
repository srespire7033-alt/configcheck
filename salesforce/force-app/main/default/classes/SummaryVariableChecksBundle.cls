/**
 * Phase 22a-2 â€” Bundle of 6 checks on SBQQ__SummaryVariable__c.
 *
 *   SV-001 â€” Orphaned (no PriceCondition / Product-rule condition refs)
 *   SV-002 â€” Missing AggregateFunction/Field/TargetObject
 *   SV-003 â€” Duplicate (same Func|Field|Target|Scope)
 *   SV-004 â€” Partial filter (FilterField/Value/Operator inconsistent)
 *   SV-005 â€” Composite missing operand
 *   SV-006 â€” Inactive variables (cleanup signal, info)
 *
 * SOQL budget: 1 main + up to 2 aggregates (SV-001 reference counts).
 */
public with sharing class SummaryVariableChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static Map<Id, Integer> testStubReferenceCounts;

    public String getDetectorId() { return 'SV-BUNDLE'; }
    public String getLabel() { return 'Summary Variable health checks'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__SummaryVariable__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] SV-BUNDLE: SBQQ__SummaryVariable__c not present.');
                return results;
            }
            String soql =
                'SELECT Id, Name, SBQQ__Active__c, ' +
                '  SBQQ__AggregateFunction__c, SBQQ__AggregateField__c, ' +
                '  SBQQ__TargetObject__c, SBQQ__Scope__c, ' +
                '  SBQQ__FilterField__c, SBQQ__FilterValue__c, SBQQ__Operator__c, ' +
                '  SBQQ__CombineWith__c, SBQQ__CompositeOperator__c ' +
                'FROM SBQQ__SummaryVariable__c LIMIT 5000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] SV-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        Boolean runSV001 = DetectorCatalogController.isActive('SV-001');
        Boolean runSV002 = DetectorCatalogController.isActive('SV-002');
        Boolean runSV003 = DetectorCatalogController.isActive('SV-003');
        Boolean runSV004 = DetectorCatalogController.isActive('SV-004');
        Boolean runSV005 = DetectorCatalogController.isActive('SV-005');
        Boolean runSV006 = DetectorCatalogController.isActive('SV-006');

        if (runSV001) results.addAll(evaluateSV001(ctx, rows));
        if (runSV002) results.addAll(evaluateSV002(rows));
        if (runSV003) results.addAll(evaluateSV003(rows));
        if (runSV004) results.addAll(evaluateSV004(rows));
        if (runSV005) results.addAll(evaluateSV005(rows));
        if (runSV006) results.addAll(evaluateSV006(rows));
        return results;
    }

    // â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    static Boolean isActive(Map<String, Object> v) {
        return Boolean.valueOf(v.get('SBQQ__Active__c'));
    }

    static String s(Map<String, Object> v, String key) {
        Object o = v.get(key);
        return (o == null) ? null : String.valueOf(o);
    }

    static SourceRecord asRef(Map<String, Object> v) {
        return new SourceRecord('SBQQ__SummaryVariable__c',
            (Id) v.get('Id'), (String) v.get('Name'));
    }

    // â”€â”€ SV-001: orphaned (no rule condition references) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluateSV001(DetectorContext ctx, List<Map<String, Object>> vars) {
        Map<Id, Integer> refCounts = (testStubReferenceCounts != null)
            ? testStubReferenceCounts
            : aggregateReferenceCounts(ctx);

        List<Map<String, Object>> orphaned = new List<Map<String, Object>>();
        for (Map<String, Object> v : vars) {
            if (!isActive(v)) continue;
            Id vId = (Id) v.get('Id');
            Integer cnt = refCounts.get(vId);
            if (cnt == null || cnt == 0) orphaned.add(v);
        }
        if (orphaned.isEmpty()) return new List<DetectorResult>();

        List<String> quoted = new List<String>();
        for (Map<String, Object> v : orphaned) quoted.add('"' + (String) v.get('Name') + '"');

        DetectorResult r = new DetectorResult();
        r.detectorId = 'SV-001';
        r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
        r.gapUsd = 0;
        r.recoverabilityScore = 0.9;
        r.title = orphaned.size() + ' summary variable(s) not used by any rule';
        r.description = String.join(quoted, ', ') +
            ' ' + (orphaned.size() == 1 ? 'is' : 'are') +
            ' active but not referenced by any price rule or product rule condition.';
        r.primaryRecord = asRef(orphaned[0]);
        for (Integer i = 1; i < orphaned.size(); i++) r.supportingRecords.add(asRef(orphaned[i]));
        return new List<DetectorResult>{ r };
    }

    @TestVisible
    static Map<Id, Integer> aggregateReferenceCounts(DetectorContext ctx) {
        Map<Id, Integer> counts = new Map<Id, Integer>();
        // Price conditions
        try {
            for (Map<String, Object> row : OrgQueryService.query(ctx,
                'SELECT SBQQ__SummaryVariable__c FROM SBQQ__PriceCondition__c ' +
                'WHERE SBQQ__SummaryVariable__c != null LIMIT 50000')) {
                Object sv = row.get('SBQQ__SummaryVariable__c');
                if (sv != null) {
                    Id k = (Id) sv;
                    counts.put(k, (counts.containsKey(k) ? counts.get(k) : 0) + 1);
                }
            }
        } catch (Exception e) { /* swallow â€” SV-001 falls back to "all orphaned" if PriceCondition not present */ }
        // Error conditions (product rules)
        try {
            for (Map<String, Object> row : OrgQueryService.query(ctx,
                'SELECT SBQQ__SummaryVariable__c FROM SBQQ__ErrorCondition__c ' +
                'WHERE SBQQ__SummaryVariable__c != null LIMIT 50000')) {
                Object sv = row.get('SBQQ__SummaryVariable__c');
                if (sv != null) {
                    Id k = (Id) sv;
                    counts.put(k, (counts.containsKey(k) ? counts.get(k) : 0) + 1);
                }
            }
        } catch (Exception e) { /* swallow */ }
        return counts;
    }

    // â”€â”€ SV-002: missing required fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluateSV002(List<Map<String, Object>> vars) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> v : vars) {
            if (!isActive(v)) continue;
            List<String> missing = new List<String>();
            if (String.isBlank(s(v, 'SBQQ__AggregateFunction__c'))) missing.add('Aggregate Function');
            if (String.isBlank(s(v, 'SBQQ__AggregateField__c'))) missing.add('Aggregate Field');
            if (String.isBlank(s(v, 'SBQQ__TargetObject__c'))) missing.add('Target Object');
            if (missing.isEmpty()) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'SV-002';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Critical');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.95;
            r.title = 'Summary variable "' + (String) v.get('Name') + '" missing ' + String.join(missing, ', ');
            r.description = '"' + (String) v.get('Name') + '" is active but missing required configuration: ' +
                String.join(missing, ', ') + '. Without these fields, the variable cannot compute a meaningful value.';
            r.primaryRecord = asRef(v);
            out.add(r);
        }
        return out;
    }

    // â”€â”€ SV-003: duplicate (same Function|Field|Target|Scope) â”€â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluateSV003(List<Map<String, Object>> vars) {
        Map<String, List<Map<String, Object>>> groups = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> v : vars) {
            if (!isActive(v)) continue;
            String fn = s(v, 'SBQQ__AggregateFunction__c');
            String fld = s(v, 'SBQQ__AggregateField__c');
            if (String.isBlank(fn) || String.isBlank(fld)) continue;
            String key = fn + '|' + fld + '|' + (s(v, 'SBQQ__TargetObject__c') == null ? '' : s(v, 'SBQQ__TargetObject__c')) +
                '|' + (s(v, 'SBQQ__Scope__c') == null ? '' : s(v, 'SBQQ__Scope__c'));
            List<Map<String, Object>> items = groups.get(key);
            if (items == null) { items = new List<Map<String, Object>>(); groups.put(key, items); }
            items.add(v);
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (String key : groups.keySet()) {
            List<Map<String, Object>> bucket = groups.get(key);
            if (bucket.size() < 2) continue;
            String[] parts = key.split('\\|');
            DetectorResult r = new DetectorResult();
            r.detectorId = 'SV-003';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.85;
            r.title = bucket.size() + ' duplicate summary variables computing ' + parts[0] + '(' + parts[1] + ')';
            List<String> names = new List<String>();
            for (Map<String, Object> v : bucket) names.add('"' + (String) v.get('Name') + '"');
            r.description = String.join(names, ', ') + ' all compute ' + parts[0] + ' of "' + parts[1] +
                '" on ' + (String.isBlank(parts[2]) ? 'unknown object' : parts[2]) +
                '. This is redundant â€” the same result is calculated multiple times.';
            r.primaryRecord = asRef(bucket[0]);
            for (Integer i = 1; i < bucket.size(); i++) r.supportingRecords.add(asRef(bucket[i]));
            out.add(r);
        }
        return out;
    }

    // â”€â”€ SV-004: partial filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluateSV004(List<Map<String, Object>> vars) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> v : vars) {
            if (!isActive(v)) continue;
            Boolean hasFilterField = !String.isBlank(s(v, 'SBQQ__FilterField__c'));
            Boolean hasFilterValue = !String.isBlank(s(v, 'SBQQ__FilterValue__c'));
            Boolean hasOperator    = !String.isBlank(s(v, 'SBQQ__Operator__c'));
            if (!hasFilterField && !hasFilterValue) continue;
            if (hasFilterField && hasFilterValue && hasOperator) continue;
            List<String> missing = new List<String>();
            if (!hasFilterField) missing.add('Filter Field');
            if (!hasFilterValue) missing.add('Filter Value');
            if (!hasOperator) missing.add('Operator');
            DetectorResult r = new DetectorResult();
            r.detectorId = 'SV-004';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = 'Summary variable "' + (String) v.get('Name') + '" has incomplete filter';
            r.description = '"' + (String) v.get('Name') + '" has a partial filter configured but is missing: ' +
                String.join(missing, ', ') + '. The filter may not work as intended.';
            r.primaryRecord = asRef(v);
            out.add(r);
        }
        return out;
    }

    // â”€â”€ SV-005: composite missing operand â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluateSV005(List<Map<String, Object>> vars) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> v : vars) {
            if (!isActive(v)) continue;
            Boolean hasCombine = !String.isBlank(s(v, 'SBQQ__CombineWith__c'));
            Boolean hasOp = !String.isBlank(s(v, 'SBQQ__CompositeOperator__c'));
            if (hasCombine == hasOp) continue;
            String missing = hasCombine ? 'Composite Operator' : 'Combine With (second variable)';
            DetectorResult r = new DetectorResult();
            r.detectorId = 'SV-005';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Critical');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.95;
            r.title = 'Composite variable "' + (String) v.get('Name') + '" missing ' + missing;
            r.description = '"' + (String) v.get('Name') +
                '" is configured as a composite variable but is missing: ' + missing +
                '. The composite calculation cannot produce a valid result.';
            r.primaryRecord = asRef(v);
            out.add(r);
        }
        return out;
    }

    // â”€â”€ SV-006: inactive cleanup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @TestVisible
    static List<DetectorResult> evaluateSV006(List<Map<String, Object>> vars) {
        List<Map<String, Object>> inactives = new List<Map<String, Object>>();
        for (Map<String, Object> v : vars) {
            if (!isActive(v)) inactives.add(v);
        }
        if (inactives.isEmpty()) return new List<DetectorResult>();
        Integer n = inactives.size();
        List<String> nameSample = new List<String>();
        Integer sampleCap = Math.min(5, n);
        for (Integer i = 0; i < sampleCap; i++) nameSample.add('"' + (String) inactives[i].get('Name') + '"');
        DetectorResult r = new DetectorResult();
        r.detectorId = 'SV-006';
        r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Info');
        r.gapUsd = 0;
        r.recoverabilityScore = 1.0;
        r.title = n + ' inactive summary variable(s)';
        r.description = n + ' summary variable(s) are deactivated: ' + String.join(nameSample, ', ') +
            (n > 5 ? ' and ' + (n - 5) + ' more.' : '.');
        r.primaryRecord = asRef(inactives[0]);
        Integer recCap = Math.min(10, n);
        for (Integer i = 1; i < recCap; i++) r.supportingRecords.add(asRef(inactives[i]));
        return new List<DetectorResult>{ r };
    }
}
