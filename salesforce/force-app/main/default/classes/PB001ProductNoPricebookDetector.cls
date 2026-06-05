/**
 * PB-001 — Active product with no active PricebookEntry.
 *
 * Phase 22a-1. Ports Vercel's `products.ts:6` check. A product
 * marked Active but absent from every active PricebookEntry can't
 * be quoted or sold — silent dead inventory.
 *
 * Uses standard objects (Product2, PricebookEntry); no namespace
 * dependency. Severity hardcoded Warning per Vercel parity.
 */
public with sharing class PB001ProductNoPricebookDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'PB-001'; }
    public String getLabel() { return 'Active product missing PricebookEntry'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing', 'ARM' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        if (testStubRows != null) {
            for (Map<String, Object> row : testStubRows) {
                results.add(toResult(row));
            }
            return results;
        }

        String soql =
            'SELECT Id, Name, ProductCode ' +
            'FROM Product2 ' +
            'WHERE IsActive = true ' +
            '  AND Id NOT IN (SELECT Product2Id FROM PricebookEntry WHERE IsActive = true) ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PB-001: ' + e.getMessage());
            return results;
        }

        for (Map<String, Object> row : rows) results.add(toResult(row));
        return results;
    }

    @TestVisible
    static DetectorResult toResult(Map<String, Object> row) {
        String name = (String) row.get('Name');
        String code = (String) row.get('ProductCode');
        DetectorResult r = new DetectorResult();
        r.detectorId = 'PB-001';
        r.severity = 'Warning';
        r.gapUsd = 0;
        r.recoverabilityScore = 0.8;
        r.title = 'Active product cannot be sold: ' + name;
        r.description = 'Product "' + name + '"' +
            (String.isBlank(code) ? '' : ' (' + code + ')') +
            ' is active but has no active PricebookEntry — it cannot be added to a quote.';
        r.primaryRecord = new SourceRecord('Product2', (Id) row.get('Id'), name);
        return r;
    }
}
