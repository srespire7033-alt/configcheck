/**
 * REN-002 — Renewal Below Current List Price
 *
 * Renewal Quote Line where NetPrice < current PricebookEntry list price.
 * Indicates the price book was updated but the renewal didn't pull the
 * new list.
 */
public with sharing class REN002RenewalBelowListDetector implements IDetector {

    public String getDetectorId() { return 'REN-002'; }
    public String getLabel() { return 'Renewal Below Current List Price'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        if (!Schema.getGlobalDescribe().containsKey('SBQQ__QuoteLine__c')) return results;

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

        List<SObject> lines;
        try { lines = Database.query(soql); } catch (Exception e) { return results; }

        for (SObject line : lines) {
            Decimal netPrice = (Decimal) line.get('SBQQ__NetPrice__c');
            Decimal listPrice = (Decimal) line.get('SBQQ__ListPrice__c');
            Decimal gap = listPrice - netPrice;
            if (gap <= 1) continue;

            DetectorResult r = new DetectorResult();
            r.detectorId = getDetectorId();
            r.severity = (gap > 10000) ? 'Critical' : (gap > 1000 ? 'Warning' : 'Info');
            r.entitledUsd = listPrice;
            r.realizedUsd = netPrice;
            r.computeGap();
            r.currencyIsoCode = (String) line.get('CurrencyIsoCode');
            r.recoverabilityScore = 0.7;
            r.title = 'Renewal priced below current list — ' + (String) line.getSObject('SBQQ__Quote__r').get('Name');
            r.description = 'NetPrice ' + netPrice.setScale(2) + ' is below current PricebookEntry list ' + listPrice.setScale(2);
            r.primaryRecord = new SourceRecord(
                'SBQQ__QuoteLine__c', (Id) line.get('Id'), (String) line.get('Name')
            ).withFinancial('netPrice', netPrice).withFinancial('listPrice', listPrice);
            results.add(r);
        }
        return results;
    }
}
