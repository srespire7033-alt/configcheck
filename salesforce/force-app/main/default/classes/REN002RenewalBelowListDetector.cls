/**
 * REN-002 — Renewal Below Current List Price
 */
public with sharing class REN002RenewalBelowListDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static List<SObject> testStubSObjects;

    public String getDetectorId() { return 'REN-002'; }
    public String getLabel() { return 'Renewal Below Current List Price'; }
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
                'SELECT Id, Name, SBQQ__NetPrice__c, SBQQ__ListPrice__c, ' +
                '  SBQQ__Quote__c, SBQQ__Quote__r.Name, SBQQ__Quote__r.SBQQ__Type__c, ' +
                '  SBQQ__Product__c, SBQQ__Product__r.Name, ' +
                '  CurrencyIsoCode ' +
                'FROM SBQQ__QuoteLine__c ' +
                'WHERE SBQQ__Quote__r.SBQQ__Type__c = \'Renewal\' ' +
                '  AND SBQQ__NetPrice__c < SBQQ__ListPrice__c ' +
                '  AND SBQQ__NetPrice__c != null ' +
                '  AND SBQQ__ListPrice__c != null ' +
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
        return evaluateRow(new Map<String, Object>{
            'lineId' => raw.get('Id'),
            'lineName' => raw.get('Name'),
            'netPrice' => raw.get('SBQQ__NetPrice__c'),
            'listPrice' => raw.get('SBQQ__ListPrice__c'),
            'quoteName' => quoteRaw.get('Name'),
            'currencyIsoCode' => raw.get('CurrencyIsoCode')
        });
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Decimal netPrice = (Decimal) row.get('netPrice');
        Decimal listPrice = (Decimal) row.get('listPrice');
        if (netPrice == null || listPrice == null) return null;
        Decimal gap = listPrice - netPrice;
        if (gap <= 1) return null;

        DetectorResult r = new DetectorResult();
        r.detectorId = 'REN-002';
        r.severity = (gap > 10000) ? 'Critical' : (gap > 1000 ? 'Warning' : 'Info');
        r.entitledUsd = listPrice;
        r.realizedUsd = netPrice;
        r.computeGap();
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.7;
        r.title = 'Renewal priced below current list — ' + (String) row.get('quoteName');
        r.description = 'NetPrice ' + netPrice.setScale(2) + ' is below current PricebookEntry list ' + listPrice.setScale(2);
        r.primaryRecord = new SourceRecord(
            'SBQQ__QuoteLine__c', (Id) row.get('lineId'), (String) row.get('lineName')
        ).withFinancial('netPrice', netPrice).withFinancial('listPrice', listPrice);
        return r;
    }
}
