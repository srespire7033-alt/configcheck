/**
 * Phase 22a-5 — 5 checks on SBQQ__QuoteTemplate__c.
 *
 *   QT-001 — No default template at all (warning, aggregated)
 *   QT-002 — Non-Deployed templates exist (info, aggregated)
 *   QT-003 — Template has no sections (warning, per-record)
 *   QT-004 — Multiple defaults (warning, aggregated)
 *   QT-005 — Default template is not Deployed (critical, per-record)
 */
public with sharing class QuoteTemplateChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'QT-BUNDLE'; }
    public String getLabel() { return 'Quote Template health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__QuoteTemplate__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] QT-BUNDLE: SBQQ__QuoteTemplate__c not present.');
                return results;
            }
            Boolean hasSections = SchemaUtil.hasObject('SBQQ__TemplateSection__c');
            String sectionSub = hasSections ? ', (SELECT Id FROM SBQQ__TemplateSections__r LIMIT 1) ' : ' ';
            String soql = 'SELECT Id, Name, SBQQ__Default__c, SBQQ__DeploymentStatus__c' + sectionSub +
                'FROM SBQQ__QuoteTemplate__c LIMIT 5000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] QT-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        Boolean runQT001 = DetectorCatalogController.isActive('QT-001');
        Boolean runQT002 = DetectorCatalogController.isActive('QT-002');
        Boolean runQT003 = DetectorCatalogController.isActive('QT-003');
        Boolean runQT004 = DetectorCatalogController.isActive('QT-004');
        Boolean runQT005 = DetectorCatalogController.isActive('QT-005');

        if (runQT001) results.addAll(evaluateQT001(rows));
        if (runQT002) results.addAll(evaluateQT002(rows));
        if (runQT003) results.addAll(evaluateQT003(rows));
        if (runQT004) results.addAll(evaluateQT004(rows));
        if (runQT005) results.addAll(evaluateQT005(rows));
        return results;
    }

    static Boolean isDefault(Map<String, Object> t) { return Boolean.valueOf(t.get('SBQQ__Default__c')); }
    static String status(Map<String, Object> t) {
        Object o = t.get('SBQQ__DeploymentStatus__c');
        return (o == null) ? null : String.valueOf(o);
    }
    static Integer sectionsOf(Map<String, Object> t) {
        Object o = t.get('SBQQ__TemplateSections__r');
        if (o == null) return 0;
        Object recs = ((Map<String, Object>) o).get('records');
        return (recs == null) ? 0 : ((List<Object>) recs).size();
    }
    static SourceRecord ref(Map<String, Object> t) {
        return new SourceRecord('SBQQ__QuoteTemplate__c', (Id) t.get('Id'), (String) t.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateQT001(List<Map<String, Object>> tmpls) {
        if (tmpls.isEmpty()) return new List<DetectorResult>();
        for (Map<String, Object> t : tmpls) if (isDefault(t)) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'QT-001'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = 'No default quote template set';
        dr.description = 'There are ' + tmpls.size() + ' quote template(s) but none is marked as Default. Users must manually select a template every time.';
        dr.primaryRecord = ref(tmpls[0]);
        Integer cap = Math.min(50, tmpls.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(tmpls[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateQT002(List<Map<String, Object>> tmpls) {
        List<Map<String, Object>> nonActive = new List<Map<String, Object>>();
        for (Map<String, Object> t : tmpls) {
            String st = status(t);
            if (st != null && st != 'Deployed') nonActive.add(t);
        }
        if (nonActive.isEmpty()) return new List<DetectorResult>();
        List<String> names = new List<String>();
        for (Map<String, Object> t : nonActive) names.add('"' + (String) t.get('Name') + '" (' + status(t) + ')');
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'QT-002'; dr.severity = 'Info'; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = nonActive.size() + ' non-active quote template(s)';
        dr.description = String.join(names, ', ') + (nonActive.size() == 1 ? ' is' : ' are') + ' not in Deployed status.';
        dr.primaryRecord = ref(nonActive[0]);
        Integer cap = Math.min(50, nonActive.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(nonActive[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateQT003(List<Map<String, Object>> tmpls) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> t : tmpls) {
            if (sectionsOf(t) > 0) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'QT-003'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = 'Quote template "' + (String) t.get('Name') + '" has no sections';
            dr.description = '"' + (String) t.get('Name') + '" has no template sections configured. Generated documents will be empty.';
            dr.primaryRecord = ref(t);
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateQT004(List<Map<String, Object>> tmpls) {
        List<Map<String, Object>> defaults = new List<Map<String, Object>>();
        for (Map<String, Object> t : tmpls) if (isDefault(t)) defaults.add(t);
        if (defaults.size() <= 1) return new List<DetectorResult>();
        List<String> names = new List<String>();
        for (Map<String, Object> t : defaults) names.add('"' + (String) t.get('Name') + '"');
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'QT-004'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = defaults.size() + ' templates marked as default';
        dr.description = String.join(names, ', ') + ' are all marked as Default. Only one template should be the default.';
        dr.primaryRecord = ref(defaults[0]);
        for (Integer i = 1; i < defaults.size(); i++) dr.supportingRecords.add(ref(defaults[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateQT005(List<Map<String, Object>> tmpls) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> t : tmpls) {
            if (!isDefault(t)) continue;
            String st = status(t);
            if (st == null || st == 'Deployed') continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'QT-005'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = 'Default template "' + (String) t.get('Name') + '" is ' + st;
            dr.description = '"' + (String) t.get('Name') + '" is marked as Default but its status is "' + st + '" instead of "Deployed". Users cannot generate documents.';
            dr.primaryRecord = ref(t);
            out.add(dr);
        }
        return out;
    }
}
