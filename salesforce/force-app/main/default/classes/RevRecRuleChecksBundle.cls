/**
 * Phase 22b-2 — 4 checks on blng__RevenueRecognitionRule__c (+Product2).
 *
 *   RR-001 — Active products → inactive rev rec rule (critical)
 *   RR-002 — Rev rec rules without schedule creation config (warning)
 *   RR-003 — Rev rec rules with schedule creation = 'No' (warning)
 *   RR-004 — Orphaned rev rec rules (info)
 */
public with sharing class RevRecRuleChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRules;
    @TestVisible static List<Map<String, Object>> testStubProducts;

    public String getDetectorId() { return 'RR-BUNDLE'; }
    public String getLabel() { return 'Revenue Recognition Rule health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ+Billing', 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> rules;
        List<Map<String, Object>> products;
        if (testStubRules != null || testStubProducts != null) {
            rules = (testStubRules != null) ? testStubRules : new List<Map<String, Object>>();
            products = (testStubProducts != null) ? testStubProducts : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('blng__RevenueRecognitionRule__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] RR-BUNDLE: blng__RevenueRecognitionRule__c not present.');
                return results;
            }
            try {
                rules = OrgQueryService.query(ctx,
                    'SELECT Id, Name, blng__Active__c, blng__CreateRevenueSchedule__c ' +
                    'FROM blng__RevenueRecognitionRule__c LIMIT 5000');
                products = OrgQueryService.query(ctx,
                    'SELECT Id, Name, IsActive, blng__RevenueRecognitionRule__c ' +
                    'FROM Product2 WHERE IsActive = true AND blng__RevenueRecognitionRule__c != null LIMIT 5000');
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] RR-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        if (DetectorCatalogController.isActive('RR-001')) results.addAll(evaluateRR001(rules, products));
        // RR-002 migrated to CustomDetector__mdt (Phase 24h).
        // if (DetectorCatalogController.isActive('RR-002')) results.addAll(evaluateRR002(rules));
        if (DetectorCatalogController.isActive('RR-003')) results.addAll(evaluateRR003(rules));
        if (DetectorCatalogController.isActive('RR-004')) results.addAll(evaluateRR004(rules, products));
        return results;
    }

    static Boolean isActive(Map<String, Object> r) { return Boolean.valueOf(r.get('blng__Active__c')); }
    static SourceRecord ruleRef(Map<String, Object> r) {
        return new SourceRecord('blng__RevenueRecognitionRule__c', (Id) r.get('Id'), (String) r.get('Name'));
    }
    static SourceRecord prodRef(Map<String, Object> p) {
        return new SourceRecord('Product2', (Id) p.get('Id'), (String) p.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateRR001(List<Map<String, Object>> rules, List<Map<String, Object>> products) {
        Set<Id> inactiveRuleIds = new Set<Id>();
        for (Map<String, Object> r : rules) if (!isActive(r)) inactiveRuleIds.add((Id) r.get('Id'));
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            Object rid = p.get('blng__RevenueRecognitionRule__c');
            if (rid == null) continue;
            if (!inactiveRuleIds.contains((Id) rid)) continue;
            bad.add(prodRef(p));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('RR-001', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'RR-001'; dr.severity = dsev; dr.gapUsd = bad.size() * 10000; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + ('Inactive revenue recognition rules assigned to active products');
            dr.description = bad.size() + ' active product(s) reference inactive revenue recognition rules. Revenue will not be recognized.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateRR002(List<Map<String, Object>> rules) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            Object v = r.get('blng__CreateRevenueSchedule__c');
            if (v != null && !String.isBlank(String.valueOf(v))) continue;
            bad.add(ruleRef(r));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('RR-002', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'RR-002'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + ('Revenue recognition rules missing schedule creation config');
            dr.description = bad.size() + ' active revenue recognition rule(s) have no Create Revenue Schedule value set.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateRR003(List<Map<String, Object>> rules) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            if (String.valueOf(r.get('blng__CreateRevenueSchedule__c')) != 'No') continue;
            bad.add(ruleRef(r));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('RR-003', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'RR-003'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + ('Revenue recognition rules with schedule creation disabled');
            dr.description = bad.size() + ' active rule(s) have revenue schedule creation set to "No".';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateRR004(List<Map<String, Object>> rules, List<Map<String, Object>> products) {
        Set<Id> usedRuleIds = new Set<Id>();
        for (Map<String, Object> p : products) {
            Object rid = p.get('blng__RevenueRecognitionRule__c');
            if (rid != null) usedRuleIds.add((Id) rid);
        }
        List<SourceRecord> orphans = new List<SourceRecord>();
        for (Map<String, Object> r : rules) {
            if (!usedRuleIds.contains((Id) r.get('Id'))) orphans.add(ruleRef(r));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('RR-004', 'Info');
        for (SourceRecord dsr : orphans) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'RR-004'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
            dr.title = '"' + dsr.name + '" — ' + ('Unused revenue recognition rules');
            dr.description = orphans.size() + ' revenue recognition rule(s) are not assigned to any product.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }
}
