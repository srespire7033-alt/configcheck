/**
 * QL-FOR-001 — Bundle Required Option at $0
 *
 * Pure-map evaluator. See REN001 header for the architecture
 * rationale — no compile-time CPQ namespace dependency.
 */
public with sharing class QL001BundleZeroPriceDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'QL-FOR-001'; }
    public String getLabel() { return 'Bundle Required Option at $0'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        // Pre-flattened test stubs bypass unwrap().
        if (testStubRows != null) {
            for (Map<String, Object> row : testStubRows) {
                DetectorResult r = evaluateRow(row);
                if (r != null) results.add(r);
            }
            return results;
        }

        // Schema-presence guard for LOCAL scans only.
        if (!ctx.isRemote()) {
            if (!SchemaUtil.hasField('SBQQ__QuoteLine__c', 'SBQQ__Required__c') ||
                !SchemaUtil.hasField('SBQQ__QuoteLine__c', 'SBQQ__Bundled__c')) {
                System.debug(LoggingLevel.WARN,
                    '[OrgPrism Skip] QL-FOR-001: SBQQ__QuoteLine__c.SBQQ__Required__c / SBQQ__Bundled__c not present in this org\'s CPQ version.');
                return results;
            }
        }

        List<Map<String, Object>> rows;
        {
            String soql =
                'SELECT Id, Name, SBQQ__NetPrice__c, SBQQ__ListPrice__c, SBQQ__Quantity__c, ' +
                '  SBQQ__Required__c, SBQQ__Bundled__c, SBQQ__Quote__c, ' +
                '  SBQQ__Quote__r.Name, SBQQ__Quote__r.SBQQ__NetAmount__c, ' +
                '  SBQQ__Product__c, SBQQ__Product__r.Name ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM SBQQ__QuoteLine__c ' +
                'WHERE SBQQ__Required__c = true ' +
                '  AND SBQQ__Bundled__c = false ' +
                '  AND SBQQ__NetPrice__c = 0 ' +
                '  AND SBQQ__ListPrice__c > 0 ' +
                '  AND CreatedDate >= LAST_N_MONTHS:24 ' +
                'LIMIT 5000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] QL-FOR-001: ' + e.getMessage());
                return results;
            }
        }

        for (Map<String, Object> row : rows) {
            DetectorResult r = evaluateRow(unwrap(row));  // raw rows need unwrap
            if (r != null) results.add(r);
        }
        return results;
    }

    @TestVisible
    static Map<String, Object> unwrap(Map<String, Object> raw) {
        if (raw == null) return new Map<String, Object>();
        Object qObj = raw.get('SBQQ__Quote__r');
        Map<String, Object> quote = (qObj instanceof Map<String, Object>)
            ? (Map<String, Object>) qObj : new Map<String, Object>();
        Object pObj = raw.get('SBQQ__Product__r');
        Map<String, Object> product = (pObj instanceof Map<String, Object>)
            ? (Map<String, Object>) pObj : new Map<String, Object>();
        return new Map<String, Object>{
            'lineId' => raw.get('Id'),
            'lineName' => raw.get('Name'),
            'listPrice' => raw.get('SBQQ__ListPrice__c'),
            'qty' => raw.get('SBQQ__Quantity__c'),
            'quoteName' => quote.get('Name'),
            'productName' => product.get('Name'),
            'currencyIsoCode' => CurrencyContext.readFromMap(raw)
        };
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Decimal listPrice = (Decimal) row.get('listPrice');
        Decimal qty = (Decimal) row.get('qty');
        if (listPrice == null || qty == null) return null;
        Decimal expected = listPrice * qty;
        if (expected <= 1) return null;

        DetectorResult r = new DetectorResult();
        r.detectorId = 'QL-FOR-001';
        r.severity = (expected > 10000) ? 'Critical' : (expected > 1000 ? 'Warning' : 'Info');
        r.entitledUsd = expected;
        r.realizedUsd = 0;
        r.computeGap();
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.9;
        String quoteName = (String) row.get('quoteName');
        String productName = (String) row.get('productName');
        r.title = 'Required option "' + productName + '" priced at $0 on Quote ' + quoteName;
        r.description = 'List price ' + listPrice.setScale(2) + ' x qty ' + qty +
                        ' = ' + expected.setScale(2) + ' expected, but NetPrice is $0';
        r.primaryRecord = new SourceRecord(
            'SBQQ__QuoteLine__c', (Id) row.get('lineId'), (String) row.get('lineName')
        ).withFinancial('listPrice', listPrice).withFinancial('quantity', qty);
        return r;
    }
}
