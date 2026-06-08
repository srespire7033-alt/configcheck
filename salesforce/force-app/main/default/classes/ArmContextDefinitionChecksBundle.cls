/** Phase 22c-3 — ContextDefinition checks: ARM-009, ARM-030. */
public with sharing class ArmContextDefinitionChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubDefs;

    public String getDetectorId() { return 'ARM-CTX-BUNDLE'; }
    public String getLabel() { return 'ARM Context Definition checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> defs;
        if (testStubDefs != null) {
            defs = testStubDefs;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('ContextDefinition')) return results;
            try {
                defs = OrgQueryService.query(ctx,
                    'SELECT Id, DeveloperName, IsActive FROM ContextDefinition LIMIT 1000');
            } catch (Exception e) { return results; }
        }
        // ARM-009 migrated to CustomDetector__mdt (Phase 24i).
        // if (DetectorCatalogController.isActive('ARM-009')) results.addAll(evaluateARM009(defs));
        if (DetectorCatalogController.isActive('ARM-030')) results.addAll(evaluateARM030(defs));
        return results;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM009(List<Map<String, Object>> defs) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> d : defs) {
            if (Boolean.valueOf(d.get('IsActive'))) continue;
            bad.add(new SourceRecord('ContextDefinition', (Id) d.get('Id'), String.valueOf(d.get('DeveloperName'))));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-009', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-009'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
            dr.title = '"' + dsr.name + '" — ' + (' inactive context definition(s)');
            dr.description = 'Context Service definitions are inactive — features depending on them will not resolve.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM030(List<Map<String, Object>> defs) {
        if (defs.isEmpty()) return new List<DetectorResult>();
        for (Map<String, Object> d : defs) if (Boolean.valueOf(d.get('IsActive'))) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-030'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = 'No active context definitions';
        dr.description = defs.size() + ' definition(s) exist but none are active.';
        dr.primaryRecord = new SourceRecord('ContextDefinition', (Id) defs[0].get('Id'),
            String.valueOf(defs[0].get('DeveloperName')));
        return new List<DetectorResult>{ dr };
    }
}
