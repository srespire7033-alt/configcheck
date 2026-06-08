/**
 * Phase 22a-5 — 4 checks on SBQQ__CustomScript__c (QCP).
 *
 *   QCP-001 — Empty Code (critical)
 *   QCP-002 — Missing TranspiledCode (warning, gated on field presence)
 *   QCP-003 — Performance: nested loops / size / console statements (warning)
 *   QCP-004 — Multiple QCP scripts present (info, aggregated)
 *
 * Heap note: SBQQ__Code__c is Long Text up to 32KB. Bundle truncates
 * per-row scan to 32KB to avoid runaway heap if data is unexpected.
 */
public with sharing class CustomScriptChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    static final Pattern PAT_FOR = Pattern.compile('(?i)\\bfor\\s*\\(');
    static final Pattern PAT_WHILE = Pattern.compile('(?i)\\bwhile\\s*\\(');
    static final Pattern PAT_CONSOLE = Pattern.compile('(?i)console\\.(log|debug|info|warn|error)');

    public String getDetectorId() { return 'QCP-BUNDLE'; }
    public String getLabel() { return 'Custom Script (QCP) health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__CustomScript__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] QCP-BUNDLE: SBQQ__CustomScript__c not present.');
                return results;
            }
            Boolean hasTrans = SchemaUtil.hasField('SBQQ__CustomScript__c', 'SBQQ__TranspiledCode__c');
            Boolean hasType = SchemaUtil.hasField('SBQQ__CustomScript__c', 'SBQQ__Type__c');
            String soql = 'SELECT Id, Name, SBQQ__Code__c'
                + (hasTrans ? ', SBQQ__TranspiledCode__c' : '')
                + (hasType ? ', SBQQ__Type__c' : '')
                + ' FROM SBQQ__CustomScript__c LIMIT 1000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] QCP-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        Boolean runQCP001 = DetectorCatalogController.isActive('QCP-001');
        Boolean runQCP002 = DetectorCatalogController.isActive('QCP-002');
        Boolean runQCP003 = DetectorCatalogController.isActive('QCP-003');
        Boolean runQCP004 = DetectorCatalogController.isActive('QCP-004');

        if (runQCP001) results.addAll(evaluateQCP001(rows));
        if (runQCP002) results.addAll(evaluateQCP002(rows));
        if (runQCP003) results.addAll(evaluateQCP003(rows));
        if (runQCP004) results.addAll(evaluateQCP004(rows));
        return results;
    }

    static SourceRecord ref(Map<String, Object> s) {
        return new SourceRecord('SBQQ__CustomScript__c', (Id) s.get('Id'), (String) s.get('Name'));
    }
    static String code(Map<String, Object> s) {
        Object o = s.get('SBQQ__Code__c');
        return (o == null) ? null : String.valueOf(o);
    }

    @TestVisible
    static List<DetectorResult> evaluateQCP001(List<Map<String, Object>> scripts) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> s : scripts) {
            if (!String.isBlank(code(s))) continue;
            String type = s.containsKey('SBQQ__Type__c') ? String.valueOf(s.get('SBQQ__Type__c')) : 'Unknown';
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'QCP-001'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
            dr.title = 'Custom script "' + (String) s.get('Name') + '" has no code';
            dr.description = '"' + (String) s.get('Name') + '" (Type: ' + (type == null ? 'Unknown' : type) + ') exists but contains no code.';
            dr.primaryRecord = ref(s);
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateQCP002(List<Map<String, Object>> scripts) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> s : scripts) {
            if (!s.containsKey('SBQQ__TranspiledCode__c')) continue; // field absent
            if (String.isBlank(code(s))) continue;
            Object t = s.get('SBQQ__TranspiledCode__c');
            if (t != null && !String.isBlank(String.valueOf(t))) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'QCP-002'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = 'Custom script "' + (String) s.get('Name') + '" missing transpiled code';
            dr.description = '"' + (String) s.get('Name') + '" has source code but no transpiled version. CPQ may not be able to execute it.';
            dr.primaryRecord = ref(s);
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateQCP003(List<Map<String, Object>> scripts) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> s : scripts) {
            String c = code(s);
            if (String.isBlank(c)) continue;
            if (c.length() > 32000) c = c.substring(0, 32000); // heap guard
            Integer forCount = countMatches(PAT_FOR, c);
            Integer whileCount = countMatches(PAT_WHILE, c);
            Integer loops = forCount + whileCount;
            Integer lines = c.split('\n').size();
            Integer consoles = countMatches(PAT_CONSOLE, c);
            List<String> warnings = new List<String>();
            if (loops >= 3) warnings.add(loops + ' loops detected — potential nested loop performance issue');
            if (lines > 500) warnings.add(lines + ' lines of code — large QCP may slow quote calculation');
            if (consoles > 5) warnings.add(consoles + ' console statements — debug code left in production');
            if (warnings.isEmpty()) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'QCP-003'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.85;
            dr.title = 'Performance concerns in "' + (String) s.get('Name') + '"';
            dr.description = '"' + (String) s.get('Name') + '" has potential performance issues: ' + String.join(warnings, '; ') + '.';
            dr.primaryRecord = ref(s);
            out.add(dr);
        }
        return out;
    }

    static Integer countMatches(Pattern p, String s) {
        Matcher m = p.matcher(s);
        Integer n = 0;
        while (m.find()) n++;
        return n;
    }

    @TestVisible
    static List<DetectorResult> evaluateQCP004(List<Map<String, Object>> scripts) {
        List<Map<String, Object>> qcps = new List<Map<String, Object>>();
        for (Map<String, Object> s : scripts) {
            if (!s.containsKey('SBQQ__Type__c')) continue;
            if (String.valueOf(s.get('SBQQ__Type__c')) == 'Quote Calculator Plugin') qcps.add(s);
        }
        if (qcps.size() <= 1) return new List<DetectorResult>();
        List<String> names = new List<String>();
        for (Map<String, Object> s : qcps) names.add('"' + (String) s.get('Name') + '"');
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'QCP-004'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = qcps.size() + ' Quote Calculator Plugin scripts found';
        dr.description = 'There are ' + qcps.size() + ' QCP script records: ' + String.join(names, ', ') +
            '. CPQ only uses one active QCP — multiple records create confusion about which code is running.';
        dr.primaryRecord = ref(qcps[0]);
        for (Integer i = 1; i < qcps.size(); i++) dr.supportingRecords.add(ref(qcps[i]));
        return new List<DetectorResult>{ dr };
    }
}
