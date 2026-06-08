/**
 * Phase 22c-1 — ARM ramp-segment checks (3).
 *
 *   ARM-120 — Ramp segment without selling model (critical, non-FreeTrial)
 *   ARM-121 — FreeTrial ramp without TrialDuration/DurationType (critical)
 *   ARM-122 — Overlapping custom ramp segments on same product (warning)
 */
public with sharing class ArmRampChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRamps;

    public String getDetectorId() { return 'ARM-RAMP-BUNDLE'; }
    public String getLabel() { return 'ARM Ramp Segment checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> ramps;
        if (testStubRamps != null) {
            ramps = testStubRamps;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('ProductRampSegment')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] ARM-RAMP-BUNDLE: ProductRampSegment missing.');
                return results;
            }
            try {
                ramps = OrgQueryService.query(ctx,
                    'SELECT Id, Name, ProductId, ProductSellingModelId, SegmentType, TrialDuration, DurationType ' +
                    'FROM ProductRampSegment LIMIT 10000');
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] ARM-RAMP-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        // ARM-120 migrated to CustomDetector__mdt (Phase 24i).
        // if (DetectorCatalogController.isActive('ARM-120')) results.addAll(evaluateARM120(ramps));
        // ARM-121 migrated to CustomDetector__mdt (Phase 24i).
        // if (DetectorCatalogController.isActive('ARM-121')) results.addAll(evaluateARM121(ramps));
        if (DetectorCatalogController.isActive('ARM-122')) results.addAll(evaluateARM122(ramps));
        return results;
    }

    static SourceRecord rampRef(Map<String, Object> r) {
        return new SourceRecord('ProductRampSegment', (Id) r.get('Id'),
            r.get('Name') == null ? 'Ramp segment' : (String) r.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateARM120(List<Map<String, Object>> ramps) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : ramps) {
            if (r.get('ProductSellingModelId') != null) continue;
            Object st = r.get('SegmentType');
            if (st == null || String.valueOf(st) == 'FreeTrial') continue;
            bad.add(rampRef(r));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-120', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-120'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' ramp segment(s) without selling model');
            dr.description = 'Non-FreeTrial ramp segments require a ProductSellingModelId.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM121(List<Map<String, Object>> ramps) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : ramps) {
            if (String.valueOf(r.get('SegmentType')) != 'FreeTrial') continue;
            Object td = r.get('TrialDuration');
            Decimal n = td == null ? null : (Decimal) td;
            Object dtType = r.get('DurationType');
            if (n != null && n > 0 && dtType != null && !String.isBlank(String.valueOf(dtType))) continue;
            bad.add(rampRef(r));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-121', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-121'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = '"' + dsr.name + '" — ' + (' FreeTrial ramp(s) missing TrialDuration/DurationType');
            dr.description = 'FreeTrial segments must specify duration to provision correctly.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM122(List<Map<String, Object>> ramps) {
        Map<String, List<Map<String, Object>>> byKey = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> r : ramps) {
            if (String.valueOf(r.get('SegmentType')) != 'Custom') continue;
            Object pid = r.get('ProductId'); Object mid = r.get('ProductSellingModelId');
            if (pid == null || mid == null) continue;
            String k = String.valueOf(pid) + '|' + String.valueOf(mid);
            if (!byKey.containsKey(k)) byKey.put(k, new List<Map<String, Object>>());
            byKey.get(k).add(r);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (String k : byKey.keySet()) {
            List<Map<String, Object>> grp = byKey.get(k);
            if (grp.size() <= 1) continue;
            for (Map<String, Object> r : grp) bad.add(rampRef(r));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-122', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-122'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' overlapping custom ramp segment(s) on same product');
            dr.description = 'Multiple Custom ramp segments share the same (Product, SellingModel) pair.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }
}
