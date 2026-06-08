/**
 * Phase 22a-6 — 4 checks on SBQQ__Subscription__c.
 *
 *   SR-001 — Zero / null NetPrice (warning, revenue impact)
 *   SR-002 — Null or zero ProrateMultiplier (warning)
 *   SR-003 — No Contract reference (critical)
 *   SR-004 — Quantity > 1000 (info)
 */
public with sharing class SubscriptionChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'SR-BUNDLE'; }
    public String getLabel() { return 'Subscription health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__Subscription__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] SR-BUNDLE: SBQQ__Subscription__c not present.');
                return results;
            }
            Boolean hasProrate = SchemaUtil.hasField('SBQQ__Subscription__c', 'SBQQ__ProrateMultiplier__c');
            Boolean hasContract = SchemaUtil.hasField('SBQQ__Subscription__c', 'SBQQ__Contract__c');
            String soql = 'SELECT Id, Name, SBQQ__NetPrice__c, SBQQ__Quantity__c' +
                (hasProrate ? ', SBQQ__ProrateMultiplier__c' : '') +
                (hasContract ? ', SBQQ__Contract__c' : '') +
                ' FROM SBQQ__Subscription__c LIMIT 10000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] SR-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        Boolean runSR001 = DetectorCatalogController.isActive('SR-001');
        Boolean runSR002 = DetectorCatalogController.isActive('SR-002');
        Boolean runSR003 = DetectorCatalogController.isActive('SR-003');
        Boolean runSR004 = DetectorCatalogController.isActive('SR-004');

        if (runSR001) results.addAll(evaluateSR001(rows));
        if (runSR002) results.addAll(evaluateSR002(rows));
        if (runSR003) results.addAll(evaluateSR003(rows));
        if (runSR004) results.addAll(evaluateSR004(rows));
        return results;
    }

    static Decimal num(Map<String, Object> r, String key) {
        Object v = r.get(key);
        return (v == null) ? null : Decimal.valueOf(String.valueOf(v));
    }
    static SourceRecord ref(Map<String, Object> r) {
        return new SourceRecord('SBQQ__Subscription__c', (Id) r.get('Id'), (String) r.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateSR001(List<Map<String, Object>> rows) {
        List<Map<String, Object>> bad = new List<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            Decimal np = num(r, 'SBQQ__NetPrice__c');
            if (np == null || np == 0) bad.add(r);
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'SR-001'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = bad.size() * 100;
        dr.recoverabilityScore = 0.85;
        dr.title = bad.size() + ' subscription(s) with zero or missing net price';
        dr.description = bad.size() + ' subscription record(s) have zero or null SBQQ__NetPrice__c. May be intentional free, or pricing not applied.';
        dr.primaryRecord = ref(bad[0]);
        Integer cap = Math.min(20, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(bad[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateSR002(List<Map<String, Object>> rows) {
        List<Map<String, Object>> bad = new List<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            if (!r.containsKey('SBQQ__ProrateMultiplier__c')) continue;
            Decimal pm = num(r, 'SBQQ__ProrateMultiplier__c');
            if (pm == null || pm == 0) bad.add(r);
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'SR-002'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.85;
        dr.title = bad.size() + ' subscription(s) missing prorate multiplier';
        dr.description = bad.size() + ' subscription(s) have null or zero SBQQ__ProrateMultiplier__c. Co-termed renewals will miscalculate.';
        dr.primaryRecord = ref(bad[0]);
        Integer cap = Math.min(20, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(bad[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateSR003(List<Map<String, Object>> rows) {
        List<Map<String, Object>> bad = new List<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            if (!r.containsKey('SBQQ__Contract__c')) continue;
            if (r.get('SBQQ__Contract__c') == null) bad.add(r);
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'SR-003'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' subscription(s) without contract reference';
        dr.description = bad.size() + ' subscription(s) have null SBQQ__Contract__c. Orphaned — will not appear in renewals.';
        dr.primaryRecord = ref(bad[0]);
        Integer cap = Math.min(20, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(bad[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateSR004(List<Map<String, Object>> rows) {
        List<Map<String, Object>> bad = new List<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            Decimal q = num(r, 'SBQQ__Quantity__c');
            if (q != null && q > 1000) bad.add(r);
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'SR-004'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = bad.size() + ' subscription(s) with quantity > 1,000';
        dr.description = bad.size() + ' subscription(s) have unusually high quantities. May be seat-based licensing or data entry errors.';
        dr.primaryRecord = ref(bad[0]);
        Integer cap = Math.min(10, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(bad[i]));
        return new List<DetectorResult>{ dr };
    }
}
