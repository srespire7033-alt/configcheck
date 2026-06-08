/**
 * Phase 22b-2 — 5 checks on blng__GLRule__c + blng__GLTreatment__c.
 *
 *   GL-001 — GL treatments with no GL accounts (critical, agg)
 *   GL-002 — GL rules with no treatments (critical, agg)
 *   GL-003 — Inactive treatments on active rules (warning, agg)
 *   GL-004 — Treatments with only one side mapped (warning, agg)
 *   GL-005 — Inactive GL rules cleanup (info, agg)
 */
public with sharing class GlRuleChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRules;
    @TestVisible static List<Map<String, Object>> testStubTreatments;

    public String getDetectorId() { return 'GL-BUNDLE'; }
    public String getLabel() { return 'GL Rule health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ+Billing', 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> rules;
        List<Map<String, Object>> treatments;
        if (testStubRules != null || testStubTreatments != null) {
            rules = (testStubRules != null) ? testStubRules : new List<Map<String, Object>>();
            treatments = (testStubTreatments != null) ? testStubTreatments : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('blng__GLRule__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] GL-BUNDLE: blng__GLRule__c not present.');
                return results;
            }
            try {
                rules = OrgQueryService.query(ctx,
                    'SELECT Id, Name, blng__Active__c FROM blng__GLRule__c LIMIT 5000');
                treatments = OrgQueryService.query(ctx,
                    'SELECT Id, Name, blng__Active__c, blng__GLRule__c, ' +
                    '  blng__CreditGLAccount__c, blng__DebitGLAccount__c ' +
                    'FROM blng__GLTreatment__c LIMIT 5000');
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] GL-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        if (DetectorCatalogController.isActive('GL-001')) results.addAll(evaluateGL001(treatments));
        if (DetectorCatalogController.isActive('GL-002')) results.addAll(evaluateGL002(rules, treatments));
        if (DetectorCatalogController.isActive('GL-003')) results.addAll(evaluateGL003(rules, treatments));
        if (DetectorCatalogController.isActive('GL-004')) results.addAll(evaluateGL004(treatments));
        if (DetectorCatalogController.isActive('GL-005')) results.addAll(evaluateGL005(rules));
        return results;
    }

    static Boolean isActive(Map<String, Object> m) { return Boolean.valueOf(m.get('blng__Active__c')); }
    static SourceRecord trtRef(Map<String, Object> t) {
        return new SourceRecord('blng__GLTreatment__c', (Id) t.get('Id'), (String) t.get('Name'));
    }
    static SourceRecord ruleRef(Map<String, Object> r) {
        return new SourceRecord('blng__GLRule__c', (Id) r.get('Id'), (String) r.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateGL001(List<Map<String, Object>> treatments) {
        // Phase 24c — per-record emission (Vercel parity).
        List<DetectorResult> results = new List<DetectorResult>();
        String sev = DetectorCatalogController.getSeverity('GL-001', 'Critical');
        for (Map<String, Object> t : treatments) {
            if (!isActive(t)) continue;
            if (t.get('blng__CreditGLAccount__c') != null || t.get('blng__DebitGLAccount__c') != null) continue;
            SourceRecord sr = trtRef(t);
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'GL-001'; dr.severity = sev; dr.gapUsd = 0; dr.recoverabilityScore = 0.85;
            dr.title = 'GL treatment "' + sr.name + '" has no GL accounts mapped';
            dr.description = 'Active GL treatment has neither credit nor debit GL accounts. Journal entries can\'t post.';
            dr.primaryRecord = sr;
            results.add(dr);
        }
        return results;
    }

    @TestVisible
    static List<DetectorResult> evaluateGL002(List<Map<String, Object>> rules, List<Map<String, Object>> treatments) {
        Set<Id> rulesWithTreatments = new Set<Id>();
        for (Map<String, Object> t : treatments) {
            Object rid = t.get('blng__GLRule__c');
            if (rid != null) rulesWithTreatments.add((Id) rid);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            if (rulesWithTreatments.contains((Id) r.get('Id'))) continue;
            bad.add(ruleRef(r));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('GL-002', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'GL-002'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.85;
            dr.title = '"' + dsr.name + '" — ' + ('GL rules with no treatments');
            dr.description = bad.size() + ' active GL rule(s) have no GL treatments configured.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateGL003(List<Map<String, Object>> rules, List<Map<String, Object>> treatments) {
        Set<Id> activeRuleIds = new Set<Id>();
        for (Map<String, Object> r : rules) if (isActive(r)) activeRuleIds.add((Id) r.get('Id'));
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> t : treatments) {
            if (isActive(t)) continue;
            Object rid = t.get('blng__GLRule__c');
            if (rid == null || !activeRuleIds.contains((Id) rid)) continue;
            bad.add(trtRef(t));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('GL-003', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'GL-003'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + ('Inactive GL treatments on active GL rules');
            dr.description = bad.size() + ' inactive GL treatment(s) exist under active GL rules. Certain transaction types may not post.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateGL004(List<Map<String, Object>> treatments) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> t : treatments) {
            if (!isActive(t)) continue;
            Boolean hasC = t.get('blng__CreditGLAccount__c') != null;
            Boolean hasD = t.get('blng__DebitGLAccount__c') != null;
            if (hasC == hasD) continue; // both or neither — not one-sided
            bad.add(trtRef(t));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('GL-004', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'GL-004'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + ('GL treatments with only one account mapped');
            dr.description = bad.size() + ' active GL treatment(s) have only credit OR debit mapped, not both.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateGL005(List<Map<String, Object>> rules) {
        List<Map<String, Object>> inactives = new List<Map<String, Object>>();
        for (Map<String, Object> r : rules) if (!isActive(r)) inactives.add(r);
        if (inactives.isEmpty()) return new List<DetectorResult>();
        List<String> sample = new List<String>();
        Integer sampleCap = Math.min(5, inactives.size());
        for (Integer i = 0; i < sampleCap; i++) sample.add('"' + (String) inactives[i].get('Name') + '"');
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'GL-005'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = inactives.size() + ' inactive GL rule(s)';
        dr.description = inactives.size() + ' GL rule(s) are inactive: ' + String.join(sample, ', ') +
            (inactives.size() > 5 ? ' and ' + (inactives.size() - 5) + ' more.' : '.');
        dr.primaryRecord = ruleRef(inactives[0]);
        Integer cap = Math.min(10, inactives.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ruleRef(inactives[i]));
        return new List<DetectorResult>{ dr };
    }
}
