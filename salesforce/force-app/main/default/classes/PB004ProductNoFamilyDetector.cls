/**
 * PB-004 — Active product missing Family.
 *
 * Phase 22a-1. Ports Vercel's `products.ts:121`. Family is the most
 * common reporting/segmentation axis; missing it breaks any analytics
 * grouped by product line.
 */
public with sharing class PB004ProductNoFamilyDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'PB-004'; }
    public String getLabel() { return 'Active product missing Family'; }
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
            'SELECT Id, Name, ProductCode ' +
            'FROM Product2 ' +
            'WHERE IsActive = true ' +
            '  AND Family = null ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PB-004: ' + e.getMessage());
            return results;
        }

        for (Map<String, Object> row : rows) results.add(toResult(row));
        return results;
    }

    @TestVisible
    static DetectorResult toResult(Map<String, Object> row) {
        String name = (String) row.get('Name');
        DetectorResult r = new DetectorResult();
        r.detectorId = 'PB-004';
        r.severity = 'Info';
        r.gapUsd = 0;
        r.recoverabilityScore = 1.0;
        r.title = 'Product missing Family: ' + name;
        r.description = 'Active product "' + name +
            '" has no Family. Reporting and analytics grouped by product family will not include this product.';
        r.primaryRecord = new SourceRecord('Product2', (Id) row.get('Id'), name);
        return r;
    }
}
