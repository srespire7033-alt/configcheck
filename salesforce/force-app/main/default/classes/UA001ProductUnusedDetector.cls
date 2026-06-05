/**
 * UA-001 — Active product not used in any quote in the last 12 months.
 *
 * Phase 22a-1. Ports Vercel's `usage-analytics.ts:11`. Unused active
 * products bloat the picklist and confuse new sellers; usually they
 * should be deactivated. Severity Info because this is a cleanup
 * signal, not a revenue risk.
 *
 * Requires SBQQ__QuoteLine__c (CPQ namespace). Gated upstream:
 *   - Local scans:  Detector__mdt.RequiredSurface__c → ForensicScanService.getDetectorsFor
 *   - Remote scans: try/catch on the OrgQueryService callout below
 * Two layers is enough; no third in-class guard.
 */
public with sharing class UA001ProductUnusedDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'UA-001'; }
    public String getLabel() { return 'Active product not used in any quote (12 mo)'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        if (testStubRows != null) {
            for (Map<String, Object> row : testStubRows) results.add(toResult(row));
            return results;
        }

        String soql =
            'SELECT Id, Name, ProductCode ' +
            'FROM Product2 ' +
            'WHERE IsActive = true ' +
            '  AND Id NOT IN ' +
            '    (SELECT SBQQ__Product__c FROM SBQQ__QuoteLine__c ' +
            '     WHERE CreatedDate = LAST_N_MONTHS:12 AND SBQQ__Product__c != null) ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] UA-001: ' + e.getMessage());
            return results;
        }

        for (Map<String, Object> row : rows) results.add(toResult(row));
        return results;
    }

    @TestVisible
    static DetectorResult toResult(Map<String, Object> row) {
        String name = (String) row.get('Name');
        DetectorResult r = new DetectorResult();
        r.detectorId = 'UA-001';
        r.severity = 'Info';
        r.gapUsd = 0;
        r.recoverabilityScore = 1.0;
        r.title = 'Unused product: ' + name;
        r.description = 'Active product "' + name +
            '" has not appeared on any quote line in 12 months. Consider deactivating to reduce picklist clutter.';
        r.primaryRecord = new SourceRecord('Product2', (Id) row.get('Id'), name);
        return r;
    }
}
