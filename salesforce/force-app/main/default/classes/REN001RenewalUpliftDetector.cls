/**
 * REN-001 — Renewal Uplift Suppressed
 *
 * Detects renewal Quote Lines where the contractually entitled uplift
 * (escalation %) was NOT applied. Verified-$, per-record.
 *
 * Detection model:
 *   1. Pull every Quote Line with parent Quote.SBQQ__Type__c = 'Renewal'
 *      from the last 24 months.
 *   2. For each renewal quote line, find its originating subscription
 *      (SBQQ__RenewedSubscription__c) → through it the original Contract
 *      + uplift entitlement.
 *   3. entitled = originalPrice × (1 + upliftPct)
 *      realized = SBQQ__NetPrice__c
 *      gap = entitled - realized
 *   4. Anything where gap > $1 emits a finding.
 *
 * Dynamic SOQL because the SBQQ__ namespace (CPQ) is a prerequisite
 * package and may not be installed in all target orgs. The class
 * compiles regardless; the query fails gracefully at runtime if CPQ
 * isn't installed.
 */
public with sharing class REN001RenewalUpliftDetector implements IDetector {

    public String getDetectorId() { return 'REN-001'; }
    public String getLabel() { return 'Renewal Uplift Suppressed'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        // Bail early if CPQ namespace isn't installed.
        if (!Schema.getGlobalDescribe().containsKey('SBQQ__QuoteLine__c')) {
            return results;
        }

        String soql =
            'SELECT Id, Name, SBQQ__NetPrice__c, SBQQ__ListPrice__c, ' +
            '  SBQQ__Quote__c, SBQQ__Quote__r.Name, SBQQ__Quote__r.SBQQ__Account__c, ' +
            '  SBQQ__Quote__r.SBQQ__Account__r.Name, SBQQ__Quote__r.SBQQ__Type__c, ' +
            '  SBQQ__RenewedSubscription__c, SBQQ__RenewedSubscription__r.Name, ' +
            '  SBQQ__RenewedSubscription__r.SBQQ__NetPrice__c, ' +
            '  SBQQ__RenewedSubscription__r.SBQQ__Contract__c, ' +
            '  SBQQ__RenewedSubscription__r.SBQQ__Contract__r.SBQQ__RenewalUpliftRate__c, ' +
            '  CurrencyIsoCode ' +
            'FROM SBQQ__QuoteLine__c ' +
            'WHERE SBQQ__Quote__r.SBQQ__Type__c = \'Renewal\' ' +
            '  AND CreatedDate >= LAST_N_MONTHS:24 ' +
            '  AND SBQQ__NetPrice__c != null ' +
            '  AND SBQQ__RenewedSubscription__c != null ' +
            'LIMIT 5000';

        List<SObject> lines;
        try {
            lines = Database.query(soql);
        } catch (Exception e) {
            // CPQ probably not installed or fields missing — return empty.
            return results;
        }

        for (SObject line : lines) {
            Decimal netPrice = (Decimal) line.get('SBQQ__NetPrice__c');
            SObject sub = (SObject) line.getSObject('SBQQ__RenewedSubscription__r');
            if (sub == null) continue;

            Decimal originalPrice = (Decimal) sub.get('SBQQ__NetPrice__c');
            if (originalPrice == null || originalPrice <= 0) continue;

            SObject contract = (SObject) sub.getSObject('SBQQ__Contract__r');
            Decimal upliftPct = (contract != null)
                ? (Decimal) contract.get('SBQQ__RenewalUpliftRate__c')
                : null;
            if (upliftPct == null) upliftPct = 0;

            Decimal entitled = originalPrice * (1 + (upliftPct / 100));
            Decimal gap = entitled - netPrice;

            if (gap <= 1) continue; // tolerance for rounding

            String accountName = (String) ((SObject) line.getSObject('SBQQ__Quote__r')
                                                          .getSObject('SBQQ__Account__r')).get('Name');
            String quoteName = (String) line.getSObject('SBQQ__Quote__r').get('Name');

            DetectorResult r = new DetectorResult();
            r.detectorId = getDetectorId();
            r.severity = (gap > 10000) ? 'Critical' : (gap > 1000 ? 'Warning' : 'Info');
            r.entitledUsd = entitled;
            r.realizedUsd = netPrice;
            r.computeGap();
            r.currencyIsoCode = (String) line.get('CurrencyIsoCode');
            r.recoverabilityScore = 0.85;
            r.title = 'Renewal uplift suppressed on Quote ' + quoteName;
            r.description = 'Renewal Quote Line under-priced by ' + gap.setScale(2) +
                            ' vs entitled uplift of ' + upliftPct + '%';
            r.primaryRecord = new SourceRecord(
                'SBQQ__QuoteLine__c', (Id) line.get('Id'), (String) line.get('Name')
            ).withFinancial('netPrice', netPrice)
             .withFinancial('listPrice', line.get('SBQQ__ListPrice__c'));
            r.metadata.put('upliftPct', upliftPct);
            r.metadata.put('originalPrice', originalPrice);
            r.metadata.put('entitledPrice', entitled);
            r.metadata.put('subscriptionId', sub.get('Id'));

            results.add(r);
        }

        return results;
    }
}
