/**
 * Phase 22a-6 — 6 IA checks (cross-rule integrity).
 *
 *   IA-001 — Dependency chains: writer/reader pairs (warn, critical ≥5)
 *   IA-002 — Overlapping rule scope: ≥4 rules write same field (warn, critical ≥6)
 *   IA-003 — Discount schedules + price rules both modify same field (warn)
 *   IA-004 — Contracted prices pointing at inactive products (warn)
 *   IA-005 — Circular rule dependencies: A↔B (critical)
 *   IA-006 — High config complexity (≥20 rules+vars) (info)
 *
 * Re-queries SBQQ__PriceRule__c with child conditions+actions to stay
 * self-contained (no cross-bundle cache dependency).
 */
public with sharing class ImpactAnalysisChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRules;
    @TestVisible static Integer testStubDsCount;
    @TestVisible static List<Map<String, Object>> testStubContractedPrices;
    @TestVisible static Integer testStubActivePRD;
    @TestVisible static Integer testStubActiveSV;

    public String getDetectorId() { return 'IA-BUNDLE'; }
    public String getLabel() { return 'Impact Analysis health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        Boolean usingStubs = (testStubRules != null || testStubDsCount != null
            || testStubContractedPrices != null || testStubActivePRD != null || testStubActiveSV != null);
        if (!usingStubs && !ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__PriceRule__c')) {
            System.debug(LoggingLevel.INFO, '[OrgPrism Skip] IA-BUNDLE: SBQQ__PriceRule__c not present.');
            return results;
        }

        List<Map<String, Object>> rules;
        if (testStubRules != null) {
            rules = testStubRules;
        } else {
            try {
                rules = OrgQueryService.query(ctx,
                    'SELECT Id, Name, SBQQ__Active__c, SBQQ__EvaluationOrder__c, ' +
                    '  (SELECT Id, SBQQ__Field__c FROM SBQQ__PriceConditions__r), ' +
                    '  (SELECT Id, SBQQ__Field__c FROM SBQQ__PriceActions__r) ' +
                    'FROM SBQQ__PriceRule__c LIMIT 5000');
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] IA-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        Integer dsCount = (testStubDsCount != null) ? testStubDsCount : countObj(ctx, 'SBQQ__DiscountSchedule__c');
        List<Map<String, Object>> cps = (testStubContractedPrices != null) ? testStubContractedPrices : queryContractedPrices(ctx);
        Integer activePRD = (testStubActivePRD != null) ? testStubActivePRD : countActive(ctx, 'SBQQ__ProductRule__c');
        Integer activeSV = (testStubActiveSV != null) ? testStubActiveSV : countActive(ctx, 'SBQQ__SummaryVariable__c');

        if (DetectorCatalogController.isActive('IA-001')) results.addAll(evaluateIA001(rules));
        if (DetectorCatalogController.isActive('IA-002')) results.addAll(evaluateIA002(rules));
        if (DetectorCatalogController.isActive('IA-003')) results.addAll(evaluateIA003(rules, dsCount));
        if (DetectorCatalogController.isActive('IA-004')) results.addAll(evaluateIA004(cps));
        if (DetectorCatalogController.isActive('IA-005')) results.addAll(evaluateIA005(rules));
        if (DetectorCatalogController.isActive('IA-006')) results.addAll(evaluateIA006(rules, activePRD, activeSV));
        return results;
    }

    static Integer countObj(DetectorContext ctx, String obj) {
        try { return OrgQueryService.query(ctx, 'SELECT Id FROM ' + obj + ' LIMIT 5000').size(); }
        catch (Exception e) { return 0; }
    }
    static Integer countActive(DetectorContext ctx, String obj) {
        try { return OrgQueryService.query(ctx, 'SELECT Id FROM ' + obj + ' WHERE SBQQ__Active__c = true LIMIT 5000').size(); }
        catch (Exception e) { return 0; }
    }
    static List<Map<String, Object>> queryContractedPrices(DetectorContext ctx) {
        try {
            return OrgQueryService.query(ctx,
                'SELECT Id, SBQQ__Product__c, SBQQ__Product__r.IsActive, SBQQ__Product__r.Name ' +
                'FROM SBQQ__ContractedPrice__c WHERE SBQQ__Product__c != null LIMIT 5000');
        } catch (Exception e) { return new List<Map<String, Object>>(); }
    }

    static Boolean isActiveRule(Map<String, Object> r) { return Boolean.valueOf(r.get('SBQQ__Active__c')); }
    static List<String> fieldsFromChild(Map<String, Object> rule, String childKey) {
        List<String> out = new List<String>();
        Object o = rule.get(childKey);
        if (o == null) return out;
        Object recs = ((Map<String, Object>) o).get('records');
        if (recs == null) return out;
        for (Object rec : (List<Object>) recs) {
            Object f = ((Map<String, Object>) rec).get('SBQQ__Field__c');
            if (f != null) out.add(String.valueOf(f));
        }
        return out;
    }
    static SourceRecord ruleRef(Map<String, Object> r) {
        return new SourceRecord('SBQQ__PriceRule__c', (Id) r.get('Id'), (String) r.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateIA001(List<Map<String, Object>> rules) {
        // Build writes map: ruleId -> Set<field written>; reads map: field -> List<rule>
        Map<Id, Set<String>> writesByRule = new Map<Id, Set<String>>();
        Map<String, List<Map<String, Object>>> readersByField = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> r : rules) {
            if (!isActiveRule(r)) continue;
            Id rid = (Id) r.get('Id');
            Set<String> w = new Set<String>(fieldsFromChild(r, 'SBQQ__PriceActions__r'));
            writesByRule.put(rid, w);
            for (String f : fieldsFromChild(r, 'SBQQ__PriceConditions__r')) {
                if (!readersByField.containsKey(f)) readersByField.put(f, new List<Map<String, Object>>());
                readersByField.get(f).add(r);
            }
        }
        // For each writer/reader pair where A.writes ∩ B.reads ≠ ∅ and A != B → chain
        Map<String, List<SourceRecord>> chains = new Map<String, List<SourceRecord>>();
        for (Id writerId : writesByRule.keySet()) {
            Set<String> writtenFields = writesByRule.get(writerId);
            Map<String, Object> writerRule = ruleById(rules, writerId);
            for (String f : writtenFields) {
                List<Map<String, Object>> readers = readersByField.get(f);
                if (readers == null) continue;
                for (Map<String, Object> rd : readers) {
                    Id readerId = (Id) rd.get('Id');
                    if (readerId == writerId) continue;
                    String key = writerId + '|' + readerId + '|' + f;
                    if (chains.containsKey(key)) continue;
                    chains.put(key, new List<SourceRecord>{ ruleRef(writerRule), ruleRef(rd) });
                }
            }
        }
        if (chains.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'IA-001'; dr.severity = (chains.size() >= 5) ? 'Critical' : 'Warning';
        dr.gapUsd = 0; dr.recoverabilityScore = 0.7;
        dr.title = chains.size() + ' price rule dependency chain(s) detected';
        dr.description = chains.size() + ' writer→reader dependencies found among active price rules. Changing evaluation order may break pricing.';
        // Use first chain's writer as primary
        for (List<SourceRecord> pair : chains.values()) {
            dr.primaryRecord = pair[0];
            dr.supportingRecords.add(pair[1]);
            break;
        }
        return new List<DetectorResult>{ dr };
    }

    static Map<String, Object> ruleById(List<Map<String, Object>> rules, Id rid) {
        for (Map<String, Object> r : rules) if ((Id) r.get('Id') == rid) return r;
        return null;
    }

    @TestVisible
    static List<DetectorResult> evaluateIA002(List<Map<String, Object>> rules) {
        Map<String, List<Map<String, Object>>> byField = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> r : rules) {
            if (!isActiveRule(r)) continue;
            Set<String> seen = new Set<String>();
            for (String f : fieldsFromChild(r, 'SBQQ__PriceActions__r')) {
                if (!seen.add(f)) continue; // dedupe per rule
                if (!byField.containsKey(f)) byField.put(f, new List<Map<String, Object>>());
                byField.get(f).add(r);
            }
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (String f : byField.keySet()) {
            List<Map<String, Object>> bucket = byField.get(f);
            if (bucket.size() < 4) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'IA-002'; dr.severity = (bucket.size() >= 6) ? 'Critical' : 'Warning';
            dr.gapUsd = 0; dr.recoverabilityScore = 0.75;
            dr.title = bucket.size() + ' rules compete for ' + f;
            dr.description = bucket.size() + ' active price rules write to ' + f +
                '. Final value depends on evaluation order.';
            dr.primaryRecord = ruleRef(bucket[0]);
            for (Integer i = 1; i < bucket.size(); i++) dr.supportingRecords.add(ruleRef(bucket[i]));
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateIA003(List<Map<String, Object>> rules, Integer dsCount) {
        if (dsCount == 0) return new List<DetectorResult>();
        Set<String> pricingFields = new Set<String>{ 'SBQQ__Discount__c', 'SBQQ__UnitPrice__c', 'SBQQ__NetPrice__c' };
        Set<String> overlap = new Set<String>();
        for (Map<String, Object> r : rules) {
            if (!isActiveRule(r)) continue;
            for (String f : fieldsFromChild(r, 'SBQQ__PriceActions__r')) {
                if (pricingFields.contains(f)) overlap.add(f);
            }
        }
        if (overlap.isEmpty()) return new List<DetectorResult>();
        List<String> sorted = new List<String>(overlap);
        sorted.sort();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'IA-003'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.8;
        dr.title = 'Discount schedules and price rules both modify ' + String.join(sorted, ', ');
        dr.description = dsCount + ' discount schedule(s) exist, and active price rules also target ' +
            String.join(sorted, ', ') + '. Calculator evaluation sequence determines precedence.';
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateIA004(List<Map<String, Object>> cps) {
        List<Map<String, Object>> bad = new List<Map<String, Object>>();
        for (Map<String, Object> cp : cps) {
            Object prodObj = cp.get('SBQQ__Product__r');
            if (prodObj == null || !(prodObj instanceof Map<String, Object>)) continue;
            Object active = ((Map<String, Object>) prodObj).get('IsActive');
            if (active == null) continue;
            if (Boolean.valueOf(active) == false) bad.add(cp);
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'IA-004'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' contracted price(s) linked to inactive products';
        dr.description = bad.size() + ' contracted price(s) attached to inactive products. These prices will never apply.';
        Integer cap = Math.min(10, bad.size());
        SourceRecord first = new SourceRecord('SBQQ__ContractedPrice__c', (Id) bad[0].get('Id'),
            (String) ((Map<String, Object>) bad[0].get('SBQQ__Product__r')).get('Name'));
        dr.primaryRecord = first;
        for (Integer i = 1; i < cap; i++) {
            dr.supportingRecords.add(new SourceRecord('SBQQ__ContractedPrice__c', (Id) bad[i].get('Id'),
                (String) ((Map<String, Object>) bad[i].get('SBQQ__Product__r')).get('Name')));
        }
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateIA005(List<Map<String, Object>> rules) {
        // For each rule, compute reads + writes sets
        List<Map<String, Object>> active = new List<Map<String, Object>>();
        Map<Id, Set<String>> readsBy = new Map<Id, Set<String>>();
        Map<Id, Set<String>> writesBy = new Map<Id, Set<String>>();
        for (Map<String, Object> r : rules) {
            if (!isActiveRule(r)) continue;
            active.add(r);
            Id rid = (Id) r.get('Id');
            readsBy.put(rid, new Set<String>(fieldsFromChild(r, 'SBQQ__PriceConditions__r')));
            writesBy.put(rid, new Set<String>(fieldsFromChild(r, 'SBQQ__PriceActions__r')));
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (Integer i = 0; i < active.size(); i++) {
            Id ai = (Id) active[i].get('Id');
            for (Integer j = i + 1; j < active.size(); j++) {
                Id bi = (Id) active[j].get('Id');
                if (!hasOverlap(writesBy.get(ai), readsBy.get(bi))) continue;
                if (!hasOverlap(writesBy.get(bi), readsBy.get(ai))) continue;
                DetectorResult dr = new DetectorResult();
                dr.detectorId = 'IA-005'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.7;
                dr.title = 'Circular dependency: "' + (String) active[i].get('Name') + '" ↔ "' + (String) active[j].get('Name') + '"';
                dr.description = '"' + (String) active[i].get('Name') + '" and "' + (String) active[j].get('Name') +
                    '" have a circular dependency — each writes a field the other reads.';
                dr.primaryRecord = ruleRef(active[i]);
                dr.supportingRecords.add(ruleRef(active[j]));
                out.add(dr);
            }
        }
        return out;
    }

    static Boolean hasOverlap(Set<String> a, Set<String> b) {
        if (a == null || b == null) return false;
        for (String s : a) if (b.contains(s)) return true;
        return false;
    }

    @TestVisible
    static List<DetectorResult> evaluateIA006(List<Map<String, Object>> rules, Integer activePRD, Integer activeSV) {
        Integer activePR = 0;
        for (Map<String, Object> r : rules) if (isActiveRule(r)) activePR++;
        Integer total = activePR + activePRD + activeSV;
        if (total < 20) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'IA-006'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 0.8;
        dr.title = 'High complexity: ' + total + ' active rules and variables';
        dr.description = activePR + ' active price rules, ' + activePRD + ' active product rules, ' +
            activeSV + ' active summary variables (' + total + ' total).';
        return new List<DetectorResult>{ dr };
    }
}
