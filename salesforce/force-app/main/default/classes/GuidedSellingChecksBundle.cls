/**
 * Phase 22a-5 — 4 checks on SBQQ__GuidedSellingProcess__c.
 *
 *   GS-001 — Active process with 0 inputs (critical)
 *   GS-002 — Active process with 0 outputs (critical)
 *   GS-003 — Inactive processes cleanup (info, aggregated)
 *   GS-004 — Active with many inputs but few outputs (warning)
 */
public with sharing class GuidedSellingChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubProcesses;
    @TestVisible static Map<Id, Integer> testStubInputCounts;
    @TestVisible static Map<Id, Integer> testStubOutputCounts;

    public String getDetectorId() { return 'GS-BUNDLE'; }
    public String getLabel() { return 'Guided Selling health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> processes;
        Map<Id, Integer> inputCounts;
        Map<Id, Integer> outputCounts;

        if (testStubProcesses != null || testStubInputCounts != null || testStubOutputCounts != null) {
            processes = (testStubProcesses != null) ? testStubProcesses : new List<Map<String, Object>>();
            inputCounts = (testStubInputCounts != null) ? testStubInputCounts : new Map<Id, Integer>();
            outputCounts = (testStubOutputCounts != null) ? testStubOutputCounts : new Map<Id, Integer>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__GuidedSellingProcess__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] GS-BUNDLE: SBQQ__GuidedSellingProcess__c not present.');
                return results;
            }
            try {
                processes = OrgQueryService.query(ctx,
                    'SELECT Id, Name, SBQQ__Active__c FROM SBQQ__GuidedSellingProcess__c LIMIT 1000');
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] GS-BUNDLE: ' + e.getMessage());
                return results;
            }
            inputCounts = countChildren(ctx, 'SBQQ__GuidedSellingInput__c');
            outputCounts = countChildren(ctx, 'SBQQ__GuidedSellingOutput__c');
        }

        Boolean runGS001 = DetectorCatalogController.isActive('GS-001');
        Boolean runGS002 = DetectorCatalogController.isActive('GS-002');
        Boolean runGS003 = DetectorCatalogController.isActive('GS-003');
        Boolean runGS004 = DetectorCatalogController.isActive('GS-004');

        if (runGS001) results.addAll(evaluateGS001(processes, inputCounts));
        if (runGS002) results.addAll(evaluateGS002(processes, outputCounts));
        if (runGS003) results.addAll(evaluateGS003(processes));
        if (runGS004) results.addAll(evaluateGS004(processes, inputCounts, outputCounts));
        return results;
    }

    @TestVisible
    static Map<Id, Integer> countChildren(DetectorContext ctx, String objApi) {
        Map<Id, Integer> out = new Map<Id, Integer>();
        if (!SchemaUtil.hasObject(objApi)) return out;
        try {
            for (Map<String, Object> row : OrgQueryService.query(ctx,
                'SELECT SBQQ__GuidedSellingProcess__c FROM ' + objApi + ' LIMIT 50000')) {
                Object pid = row.get('SBQQ__GuidedSellingProcess__c');
                if (pid != null) {
                    Id k = (Id) pid;
                    out.put(k, (out.containsKey(k) ? out.get(k) : 0) + 1);
                }
            }
        } catch (Exception e) { /* skip silently */ }
        return out;
    }

    static Boolean isActive(Map<String, Object> p) { return Boolean.valueOf(p.get('SBQQ__Active__c')); }
    static SourceRecord ref(Map<String, Object> p) {
        return new SourceRecord('SBQQ__GuidedSellingProcess__c', (Id) p.get('Id'), (String) p.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateGS001(List<Map<String, Object>> procs, Map<Id, Integer> inputCounts) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> p : procs) {
            if (!isActive(p)) continue;
            Integer c = inputCounts.containsKey((Id) p.get('Id')) ? inputCounts.get((Id) p.get('Id')) : 0;
            if (c > 0) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'GS-001'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = 'Guided selling "' + (String) p.get('Name') + '" has no input questions';
            dr.description = '"' + (String) p.get('Name') + '" is active but has no inputs. The wizard will show an empty page.';
            dr.primaryRecord = ref(p);
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateGS002(List<Map<String, Object>> procs, Map<Id, Integer> outputCounts) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> p : procs) {
            if (!isActive(p)) continue;
            Integer c = outputCounts.containsKey((Id) p.get('Id')) ? outputCounts.get((Id) p.get('Id')) : 0;
            if (c > 0) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'GS-002'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = 'Guided selling "' + (String) p.get('Name') + '" has no product outputs';
            dr.description = '"' + (String) p.get('Name') + '" is active but has no outputs. Users go through the wizard and get no recommendations.';
            dr.primaryRecord = ref(p);
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateGS003(List<Map<String, Object>> procs) {
        List<Map<String, Object>> inactives = new List<Map<String, Object>>();
        for (Map<String, Object> p : procs) if (!isActive(p)) inactives.add(p);
        if (inactives.isEmpty()) return new List<DetectorResult>();
        List<String> names = new List<String>();
        for (Map<String, Object> p : inactives) names.add('"' + (String) p.get('Name') + '"');
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'GS-003'; dr.severity = 'Info'; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = inactives.size() + ' inactive guided selling process(es)';
        dr.description = String.join(names, ', ') + (inactives.size() == 1 ? ' is' : ' are') + ' not active.';
        dr.primaryRecord = ref(inactives[0]);
        Integer cap = Math.min(50, inactives.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(inactives[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateGS004(List<Map<String, Object>> procs, Map<Id, Integer> inputCounts, Map<Id, Integer> outputCounts) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> p : procs) {
            if (!isActive(p)) continue;
            Integer ic = inputCounts.containsKey((Id) p.get('Id')) ? inputCounts.get((Id) p.get('Id')) : 0;
            Integer oc = outputCounts.containsKey((Id) p.get('Id')) ? outputCounts.get((Id) p.get('Id')) : 0;
            if (!(ic >= 5 && oc > 0 && oc <= 1)) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'GS-004'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = 'Guided selling "' + (String) p.get('Name') + '" has ' + ic + ' inputs but only ' + oc + ' output';
            dr.description = '"' + (String) p.get('Name') + '" asks ' + ic + ' questions but only maps to ' + oc + ' product output(s).';
            dr.primaryRecord = ref(p);
            out.add(dr);
        }
        return out;
    }
}
