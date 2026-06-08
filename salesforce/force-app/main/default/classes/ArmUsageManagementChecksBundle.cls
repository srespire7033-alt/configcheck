/** Phase 22c-3 — Usage management: ARM-040..044. */
public with sharing class ArmUsageManagementChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubUomClasses;
    @TestVisible static List<Map<String, Object>> testStubResources;
    @TestVisible static List<Map<String, Object>> testStubGrants;

    public String getDetectorId() { return 'ARM-USAGE-BUNDLE'; }
    public String getLabel() { return 'ARM Usage Management checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> uomClasses, resources, grants;
        Boolean usingStubs = (testStubUomClasses != null || testStubResources != null || testStubGrants != null);
        if (usingStubs) {
            uomClasses = testStubUomClasses != null ? testStubUomClasses : new List<Map<String, Object>>();
            resources  = testStubResources  != null ? testStubResources  : new List<Map<String, Object>>();
            grants     = testStubGrants     != null ? testStubGrants     : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('UnitOfMeasureClass')
                && !SchemaUtil.hasObject('UsageResource') && !SchemaUtil.hasObject('ProductUsageGrant')) return results;
            // Phase 22i — remote scans can't rely on host-org hasObject;
            // try the query and let queryWithFallback degrade cleanly when
            // the object isn't present on the target.
            uomClasses = (ctx.isRemote() || SchemaUtil.hasObject('UnitOfMeasureClass'))
                ? OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Name, IsActive, DefaultUomId FROM UnitOfMeasureClass LIMIT 5000', null)
                : new List<Map<String, Object>>();
            resources = (ctx.isRemote() || SchemaUtil.hasObject('UsageResource'))
                ? OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Name, Status, UnitOfMeasureClassId FROM UsageResource LIMIT 5000', null)
                : new List<Map<String, Object>>();
            grants = (ctx.isRemote() || SchemaUtil.hasObject('ProductUsageGrant'))
                ? OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Name, Status, EffectiveStartDate, EffectiveEndDate FROM ProductUsageGrant LIMIT 10000', null)
                : new List<Map<String, Object>>();
        }
        if (DetectorCatalogController.isActive('ARM-040')) results.addAll(evaluateARM040(uomClasses));
        if (DetectorCatalogController.isActive('ARM-041')) results.addAll(evaluateARM041(resources));
        if (DetectorCatalogController.isActive('ARM-042')) results.addAll(evaluateARM042(grants));
        if (DetectorCatalogController.isActive('ARM-043')) results.addAll(evaluateARM043(grants));
        if (DetectorCatalogController.isActive('ARM-044')) results.addAll(evaluateARM044(resources));
        return results;
    }

    static Date parseD(Object o) {
        if (o == null) return null;
        if (o instanceof Date) return (Date) o;
        String s = String.valueOf(o);
        if (s.length() >= 10) s = s.substring(0, 10);
        try { return Date.valueOf(s); } catch (Exception e) { return null; }
    }

    @TestVisible
    static List<DetectorResult> evaluateARM040(List<Map<String, Object>> uomClasses) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> u : uomClasses) {
            Object active = u.get('IsActive');
            if (active != null && !Boolean.valueOf(active)) continue;
            if (u.get('DefaultUomId') != null) continue;
            bad.add(new SourceRecord('UnitOfMeasureClass', (Id) u.get('Id'), String.valueOf(u.get('Name'))));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-040', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-040'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' UoM class(es) without default unit');
            dr.description = 'Without a default UoM, usage records may not convert correctly.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM041(List<Map<String, Object>> resources) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : resources) {
            if (String.valueOf(r.get('Status')) == 'Active') continue;
            bad.add(new SourceRecord('UsageResource', (Id) r.get('Id'),
                String.valueOf(r.get('Name')) + ' (' + String.valueOf(r.get('Status')) + ')'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-041', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-041'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' usage resource(s) not Active');
            dr.description = 'Inactive resources cannot accept usage events.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM042(List<Map<String, Object>> grants) {
        Date td = Date.today();
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> g : grants) {
            if (String.valueOf(g.get('Status')) != 'Active') continue;
            Date ed = parseD(g.get('EffectiveEndDate'));
            if (ed == null || !(ed < td)) continue;
            bad.add(new SourceRecord('ProductUsageGrant', (Id) g.get('Id'),
                String.valueOf(g.get('Name')) + ' (ended ' + ed + ')'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-042', 'Info');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-042'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
            dr.title = '"' + dsr.name + '" — ' + (' expired usage grant(s) still active');
            dr.description = 'Deactivate expired grants to avoid silent overage.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM043(List<Map<String, Object>> grants) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> g : grants) {
            Date sd = parseD(g.get('EffectiveStartDate'));
            Date ed = parseD(g.get('EffectiveEndDate'));
            if (sd == null || ed == null) continue;
            if (!(sd > ed)) continue;
            bad.add(new SourceRecord('ProductUsageGrant', (Id) g.get('Id'), String.valueOf(g.get('Name'))));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-043', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-043'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = '"' + dsr.name + '" — ' + (' usage grant(s) with reversed dates');
            dr.description = 'EffectiveStartDate is after EffectiveEndDate.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM044(List<Map<String, Object>> resources) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : resources) {
            if (String.valueOf(r.get('Status')) != 'Active') continue;
            if (r.get('UnitOfMeasureClassId') != null) continue;
            bad.add(new SourceRecord('UsageResource', (Id) r.get('Id'), String.valueOf(r.get('Name'))));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-044', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-044'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' active usage resource(s) missing UoM class');
            dr.description = 'Usage resources need a UnitOfMeasureClass to normalize meter readings.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }
}
