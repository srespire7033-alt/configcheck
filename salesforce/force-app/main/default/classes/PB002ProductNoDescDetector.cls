/**
 * PB-002 — Active product with empty Description.
 *
 * Phase 22a-1. Ports Vercel's `products.ts:39`. Empty Description
 * on a sellable product is a quote-quality issue: the line shows up
 * on customer-facing templates without context.
 */
public with sharing class PB002ProductNoDescDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'PB-002'; }
    public String getLabel() { return 'Active product missing Description'; }
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
            '  AND Description = null ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PB-002: ' + e.getMessage());
            return results;
        }

        for (Map<String, Object> row : rows) results.add(toResult(row));
        return results;
    }

    @TestVisible
    static DetectorResult toResult(Map<String, Object> row) {
        String name = (String) row.get('Name');
        DetectorResult r = new DetectorResult();
        r.detectorId = 'PB-002';
        r.severity = 'Warning';
        r.gapUsd = 0;
        r.recoverabilityScore = 0.9;
        r.title = 'Product missing description: ' + name;
        r.description = 'Active product "' + name +
            '" has no Description. Quote templates and customer-facing exports will show this product without context.';
        r.primaryRecord = new SourceRecord('Product2', (Id) row.get('Id'), name);
        return r;
    }
}
