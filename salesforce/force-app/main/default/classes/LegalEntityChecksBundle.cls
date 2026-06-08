/**
 * Phase 22b-2 — 4 checks on blng__LegalEntity__c.
 *
 *   LE-001 — No legal entity defined (critical, org)
 *   LE-002 — Incomplete address (warning, agg) — null OR '' semantics
 *   LE-003 — All entities inactive (CRITICAL severity even though spec says warning)
 *   LE-004 — 3+ active entities — complexity warning (info, agg)
 */
public with sharing class LegalEntityChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'LE-BUNDLE'; }
    public String getLabel() { return 'Legal Entity health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ+Billing', 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('blng__LegalEntity__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] LE-BUNDLE: blng__LegalEntity__c not present.');
                return results;
            }
            try {
                rows = OrgQueryService.query(ctx,
                    'SELECT Id, Name, blng__Active__c, blng__Street__c, blng__City__c, blng__Country__c ' +
                    'FROM blng__LegalEntity__c LIMIT 1000');
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] LE-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        if (DetectorCatalogController.isActive('LE-001')) results.addAll(evaluateLE001(rows));
        if (DetectorCatalogController.isActive('LE-002')) results.addAll(evaluateLE002(rows));
        if (DetectorCatalogController.isActive('LE-003')) results.addAll(evaluateLE003(rows));
        if (DetectorCatalogController.isActive('LE-004')) results.addAll(evaluateLE004(rows));
        return results;
    }

    static Boolean isActive(Map<String, Object> le) { return Boolean.valueOf(le.get('blng__Active__c')); }
    static SourceRecord ref(Map<String, Object> le) {
        return new SourceRecord('blng__LegalEntity__c', (Id) le.get('Id'), (String) le.get('Name'));
    }
    static Boolean isBlankField(Map<String, Object> le, String key) {
        Object v = le.get(key);
        return v == null || String.isBlank(String.valueOf(v));
    }

    @TestVisible
    static List<DetectorResult> evaluateLE001(List<Map<String, Object>> rows) {
        if (!rows.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'LE-001'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = 'No legal entity defined';
        dr.description = 'No legal entities found in this org. Required for invoice generation and tax compliance.';
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateLE002(List<Map<String, Object>> rows) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> le : rows) {
            if (!isActive(le)) continue;
            if (!isBlankField(le, 'blng__Street__c')
                && !isBlankField(le, 'blng__City__c')
                && !isBlankField(le, 'blng__Country__c')) continue;
            bad.add(ref(le));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('LE-002', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'LE-002'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + ('Legal entities with incomplete address');
            dr.description = bad.size() + ' active legal entity(ies) missing street, city, or country.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateLE003(List<Map<String, Object>> rows) {
        if (rows.isEmpty()) return new List<DetectorResult>(); // LE-001 covers this
        for (Map<String, Object> le : rows) if (isActive(le)) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'LE-003'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = 'All legal entities are inactive';
        dr.description = 'All ' + rows.size() + ' legal entity(ies) in this org are inactive. At least one must be active.';
        dr.primaryRecord = ref(rows[0]);
        for (Integer i = 1; i < rows.size(); i++) dr.supportingRecords.add(ref(rows[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateLE004(List<Map<String, Object>> rows) {
        List<Map<String, Object>> actives = new List<Map<String, Object>>();
        for (Map<String, Object> le : rows) if (isActive(le)) actives.add(le);
        if (actives.size() < 3) return new List<DetectorResult>();
        List<String> sample = new List<String>();
        Integer sampleCap = Math.min(5, actives.size());
        for (Integer i = 0; i < sampleCap; i++) sample.add('"' + (String) actives[i].get('Name') + '"');
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'LE-004'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = actives.size() + ' active legal entities';
        dr.description = 'This org has ' + actives.size() + ' active legal entities: ' + String.join(sample, ', ') +
            (actives.size() > 5 ? ' and ' + (actives.size() - 5) + ' more.' : '.');
        dr.primaryRecord = ref(actives[0]);
        for (Integer i = 1; i < actives.size(); i++) dr.supportingRecords.add(ref(actives[i]));
        return new List<DetectorResult>{ dr };
    }
}
