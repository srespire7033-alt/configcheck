/**
 * PB-003 — Active product missing ProductCode.
 *
 * Phase 22a-1. Ports Vercel's `products.ts:88`. ProductCode is the
 * canonical SKU used in downstream ERP/billing integrations; missing
 * it indicates the product was created sloppily and will fail to
 * sync.
 */
public with sharing class PB003ProductNoCodeDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'PB-003'; }
    public String getLabel() { return 'Active product missing ProductCode'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing', 'ARM' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        if (testStubRows != null) {
            for (Map<String, Object> row : testStubRows) results.add(toResult(row));
            return results;
        }

        String soql =
            'SELECT Id, Name ' +
            'FROM Product2 ' +
            'WHERE IsActive = true ' +
            '  AND ProductCode = null ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PB-003: ' + e.getMessage());
            return results;
        }

        for (Map<String, Object> row : rows) results.add(toResult(row));
        return results;
    }

    @TestVisible
    static DetectorResult toResult(Map<String, Object> row) {
        String name = (String) row.get('Name');
        DetectorResult r = new DetectorResult();
        r.detectorId = 'PB-003';
        r.severity = 'Warning';
        r.gapUsd = 0;
        r.recoverabilityScore = 0.9;
        r.title = 'Product missing ProductCode: ' + name;
        r.description = 'Active product "' + name +
            '" has no ProductCode. Downstream ERP/billing integrations that key on SKU will fail or duplicate this product.';
        r.primaryRecord = new SourceRecord('Product2', (Id) row.get('Id'), name);
        return r;
    }
}
