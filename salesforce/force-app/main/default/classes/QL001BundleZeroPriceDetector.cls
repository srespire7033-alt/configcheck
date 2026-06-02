/**
 * QL-FOR-001 — Bundle Required Option at $0
 */
public with sharing class QL001BundleZeroPriceDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static List<SObject> testStubSObjects;

    public String getDetectorId() { return 'QL-FOR-001'; }
    public String getLabel() { return 'Bundle Required Option at $0'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        if (testStubRows != null) {
            for (Map<String, Object> row : testStubRows) {
                DetectorResult r = evaluateRow(row);
                if (r != null) results.add(r);
            }
            return results;
        }

        List<SObject> lines;
        if (testStubSObjects != null) {
            lines = testStubSObjects;
        } else {
            String soql =
                'SELECT Id, Name, SBQQ__NetPrice__c, SBQQ__ListPrice__c, SBQQ__Quantity__c, ' +
                '  SBQQ__Required__c, SBQQ__Bundled__c, SBQQ__Quote__c, ' +
                '  SBQQ__Quote__r.Name, SBQQ__Quote__r.SBQQ__NetAmount__c, ' +
                '  SBQQ__Product__c, SBQQ__Product__r.Name, ' +
                '  CurrencyIsoCode ' +
                'FROM SBQQ__QuoteLine__c ' +
                'WHERE SBQQ__Required__c = true ' +
                '  AND SBQQ__Bundled__c = false ' +
                '  AND SBQQ__NetPrice__c = 0 ' +
                '  AND SBQQ__ListPrice__c > 0 ' +
                '  AND CreatedDate >= LAST_N_MONTHS:24 ' +
                'LIMIT 5000';
            try { lines = Database.query(soql); } catch (Exception e) { return results; }
        }

        for (SObject line : lines) {
            DetectorResult r = evaluateSObject(line);
            if (r != null) results.add(r);
        }
        return results;
    }

    @TestVisible
    static DetectorResult evaluateSObject(SObject line) {
        Map<String, Object> raw = line.getPopulatedFieldsAsMap();
        SObject quote = (SObject) raw.get('SBQQ__Quote__r');
        Map<String, Object> quoteRaw = quote != null ? quote.getPopulatedFieldsAsMap() : new Map<String, Object>();
        SObject product = (SObject) raw.get('SBQQ__Product__r');
        Map<String, Object> productRaw = product != null ? product.getPopulatedFieldsAsMap() : new Map<String, Object>();
        return evaluateRow(new Map<String, Object>{
            'lineId' => raw.get('Id'),
            'lineName' => raw.get('Name'),
            'listPrice' => raw.get('SBQQ__ListPrice__c'),
            'qty' => raw.get('SBQQ__Quantity__c'),
            'quoteName' => quoteRaw.get('Name'),
            'productName' => productRaw.get('Name'),
            'currencyIsoCode' => raw.get('CurrencyIsoCode')
        });
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
