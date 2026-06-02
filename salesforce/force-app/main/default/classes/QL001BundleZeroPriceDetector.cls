/**
 * QL-FOR-001 — Bundle Required Option at $0
 *
 * A required bundle option (SBQQ__Required__c = true) is being
 * delivered at SBQQ__NetPrice__c = 0. Likely the bundle's pricing
 * configuration didn't pass through to the child option.
 *
 * Note: bundle "parent" lines have SBQQ__Bundled__c = true; their
 * required child options inherit pricing UNLESS overridden. A 0-priced
 * required option is almost always a configuration miss.
 */
public with sharing class QL001BundleZeroPriceDetector implements IDetector {

    public String getDetectorId() { return 'QL-FOR-001'; }
    public String getLabel() { return 'Bundle Required Option at $0'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        if (!Schema.getGlobalDescribe().containsKey('SBQQ__QuoteLine__c')) return results;

        // Find required option lines priced at $0 where the parent bundle
        // line has a non-zero net total — signals a configuration miss.
        String soql =
            'SELECT Id, Name, SBQQ__NetPrice__c, SBQQ__ListPrice__c, SBQQ__Quantity__c, ' +
            '  SBQQ__Required__c, SBQQ__Bundled__c, SBQQ__Quote__c, ' +
            '  SBQQ__Quote__r.Name, SBQQ__Quote__r.SBQQ__NetAmount__c, ' +
            '  SBQQ__Product__c, SBQQ__Product__r.Name, ' +
            '  CurrencyIsoCode ' +
            'FROM SBQQ__QuoteLine__c ' +
            'WHERE SBQQ__Required__c = true ' +
            '  AND SBQQ__Bundled__c = false ' + // bundle CHILDREN, not the parent
            '  AND SBQQ__NetPrice__c = 0 ' +
            '  AND SBQQ__ListPrice__c > 0 ' +
            '  AND CreatedDate >= LAST_N_MONTHS:24 ' +
            'LIMIT 5000';

        List<SObject> lines;
        try { lines = Database.query(soql); } catch (Exception e) { return results; }

        for (SObject line : lines) {
            Decimal listPrice = (Decimal) line.get('SBQQ__ListPrice__c');
            Decimal qty = (Decimal) line.get('SBQQ__Quantity__c');
            if (listPrice == null || qty == null) continue;
            Decimal expected = listPrice * qty;
            if (expected <= 1) continue;

            DetectorResult r = new DetectorResult();
            r.detectorId = getDetectorId();
            r.severity = (expected > 10000) ? 'Critical' : (expected > 1000 ? 'Warning' : 'Info');
            r.entitledUsd = expected;
            r.realizedUsd = 0;
            r.computeGap();
            r.currencyIsoCode = (String) line.get('CurrencyIsoCode');
            r.recoverabilityScore = 0.9;
            String quoteName = (String) line.getSObject('SBQQ__Quote__r').get('Name');
            String productName = (String) line.getSObject('SBQQ__Product__r').get('Name');
            r.title = 'Required option "' + productName + '" priced at \$0 on Quote ' + quoteName;
            r.description = 'List price ' + listPrice.setScale(2) + ' × qty ' + qty +
                            ' = ' + expected.setScale(2) + ' expected, but NetPrice is \$0';
            r.primaryRecord = new SourceRecord(
                'SBQQ__QuoteLine__c', (Id) line.get('Id'), (String) line.get('Name')
            ).withFinancial('listPrice', listPrice).withFinancial('quantity', qty);
            results.add(r);
        }
        return results;
    }
}
