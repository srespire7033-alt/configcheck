/**
 * Phase 22c-1 — ARM product-qualification checks (3).
 *
 *   ARM-110 — Expired qualification still marked qualified (critical)
 *   ARM-111 — Reversed effective dates (critical)
 *   ARM-112 — Qualification references inactive product (warning)
 */
public with sharing class ArmQualificationChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubQuals;
    @TestVisible static List<Map<String, Object>> testStubProducts;

    public String getDetectorId() { return 'ARM-QUAL-BUNDLE'; }
    public String getLabel() { return 'ARM Product Qualification checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> quals;
        List<Map<String, Object>> products;
        Boolean usingStubs = (testStubQuals != null || testStubProducts != null);
        if (usingStubs) {
            quals    = testStubQuals    != null ? testStubQuals    : new List<Map<String, Object>>();
            products = testStubProducts != null ? testStubProducts : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('ProductQualification')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] ARM-QUAL-BUNDLE: ProductQualification missing.');
                return results;
            }
            try {
                quals = OrgQueryService.query(ctx,
                    'SELECT Id, Name, ProductId, RootProductId, IsQualified, EffectiveFromDate, EffectiveToDate ' +
                    'FROM ProductQualification LIMIT 10000');
                products = OrgQueryService.query(ctx,
                    'SELECT Id, IsActive FROM Product2 LIMIT 10000');
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] ARM-QUAL-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        if (DetectorCatalogController.isActive('ARM-110')) results.addAll(evaluateARM110(quals));
        if (DetectorCatalogController.isActive('ARM-111')) results.addAll(evaluateARM111(quals));
        if (DetectorCatalogController.isActive('ARM-112')) results.addAll(evaluateARM112(quals, products));
        return results;
    }

    static Date parseD(Object o) {
        if (o == null) return null;
        if (o instanceof Date) return (Date) o;
        String s = String.valueOf(o);
        if (s.length() >= 10) s = s.substring(0, 10);
        try { return Date.valueOf(s); } catch (Exception e) { return null; }
    }
    static SourceRecord qRef(Map<String, Object> q) {
        return new SourceRecord('ProductQualification', (Id) q.get('Id'),
            q.get('Name') == null ? 'Qualification' : (String) q.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateARM110(List<Map<String, Object>> quals) {
        Date td = Date.today();
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> q : quals) {
            if (!Boolean.valueOf(q.get('IsQualified'))) continue;
            Date ed = parseD(q.get('EffectiveToDate'));
            if (ed == null || !(ed < td)) continue;
            bad.add(qRef(q));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-110', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-110'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' expired qualification(s) still marked qualified');
            dr.description = 'Product qualifications past their end date should be re-evaluated.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM111(List<Map<String, Object>> quals) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> q : quals) {
            Date fd = parseD(q.get('EffectiveFromDate'));
            Date ed = parseD(q.get('EffectiveToDate'));
            if (fd == null || ed == null) continue;
            if (!(ed < fd)) continue;
            bad.add(qRef(q));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-111', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-111'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = '"' + dsr.name + '" — ' + (' qualification(s) with reversed effective dates');
            dr.description = 'EffectiveToDate is before EffectiveFromDate — data entry error.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM112(List<Map<String, Object>> quals, List<Map<String, Object>> products) {
        Set<Id> inactives = new Set<Id>();
        for (Map<String, Object> p : products) if (!Boolean.valueOf(p.get('IsActive'))) inactives.add((Id) p.get('Id'));
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> q : quals) {
            Object pid = q.get('ProductId'); Object rid = q.get('RootProductId');
            Boolean hit = (pid != null && inactives.contains((Id) pid))
                       || (rid != null && inactives.contains((Id) rid));
            if (!hit) continue;
            bad.add(qRef(q));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-112', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-112'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' qualification(s) reference inactive product(s)');
            dr.description = 'Either the product or root product on the qualification is deactivated.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }
}
