/**
 * REN-001 — Renewal Uplift Suppressed
 *
 * Detects renewal Quote Lines where the contractually entitled uplift
 * (escalation %) was NOT applied. Verified-$, per-record.
 *
 * Dynamic SOQL because the SBQQ__ namespace (CPQ) is a prerequisite
 * package and may not be installed in all target orgs. The class
 * compiles regardless; the query fails gracefully at runtime if CPQ
 * isn't installed.
 *
 * Two test injection seams:
 *   - testStubRows (List<Map>): bypasses SOQL + unwrap, drives
 *     evaluateRow directly with synthetic data.
 *   - testStubSObjects (List<SObject>): bypasses SOQL, drives the
 *     full for-loop + evaluateSObject + unwrap path. Used in tests
 *     to exercise the SObject-unwrap code without CPQ installed.
 */
public with sharing class REN001RenewalUpliftDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static List<SObject> testStubSObjects;

    public String getDetectorId() { return 'REN-001'; }
    public String getLabel() { return 'Renewal Uplift Suppressed'; }
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
            try { lines = Database.query(soql); }
            catch (Exception e) { return results; }
        }

        for (SObject line : lines) {
            DetectorResult r = evaluateSObject(line);
            if (r != null) results.add(r);
        }
        return results;
    }

    /**
     * Unwraps a Quote Line SObject into a flat Map and delegates to
     * evaluateRow. Uses getPopulatedFieldsAsMap() everywhere so the
     * code is safe on ANY SObject — passing a `new Account()` returns
     * null gracefully instead of throwing.
     */
    @TestVisible
    static DetectorResult evaluateSObject(SObject line) {
        Map<String, Object> raw = line.getPopulatedFieldsAsMap();
        SObject sub = (SObject) raw.get('SBQQ__RenewedSubscription__r');
        if (sub == null) return null;
        Map<String, Object> subRaw = sub.getPopulatedFieldsAsMap();
        SObject contract = (SObject) subRaw.get('SBQQ__Contract__r');
        Map<String, Object> contractRaw = contract != null ? contract.getPopulatedFieldsAsMap() : new Map<String, Object>();
        SObject quote = (SObject) raw.get('SBQQ__Quote__r');
        Map<String, Object> quoteRaw = quote != null ? quote.getPopulatedFieldsAsMap() : new Map<String, Object>();
        SObject acct = (SObject) quoteRaw.get('SBQQ__Account__r');
        Map<String, Object> acctRaw = acct != null ? acct.getPopulatedFieldsAsMap() : new Map<String, Object>();

        return evaluateRow(new Map<String, Object>{
            'lineId' => raw.get('Id'),
            'lineName' => raw.get('Name'),
            'netPrice' => raw.get('SBQQ__NetPrice__c'),
            'listPrice' => raw.get('SBQQ__ListPrice__c'),
            'originalPrice' => subRaw.get('SBQQ__NetPrice__c'),
            'upliftPct' => contractRaw.get('SBQQ__RenewalUpliftRate__c'),
            'quoteName' => quoteRaw.get('Name'),
            'accountName' => acctRaw.get('Name'),
            'subscriptionId' => subRaw.get('Id'),
            'currencyIsoCode' => raw.get('CurrencyIsoCode')
        });
    }

    /**
     * Pure-data evaluation of one renewal quote line. Returns a
     * DetectorResult when the uplift is suppressed; null otherwise.
     */
    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Decimal netPrice = (Decimal) row.get('netPrice');
        Decimal originalPrice = (Decimal) row.get('originalPrice');
        if (netPrice == null) return null;
        if (originalPrice == null || originalPrice <= 0) return null;

        Decimal upliftPct = (Decimal) row.get('upliftPct');
        if (upliftPct == null) upliftPct = 0;

        Decimal entitled = originalPrice * (1 + (upliftPct / 100));
        Decimal gap = entitled - netPrice;
        if (gap <= 1) return null;

        DetectorResult r = new DetectorResult();
        r.detectorId = 'REN-001';
        r.severity = (gap > 10000) ? 'Critical' : (gap > 1000 ? 'Warning' : 'Info');
        r.entitledUsd = entitled;
        r.realizedUsd = netPrice;
        r.computeGap();
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.85;
        String quoteName = (String) row.get('quoteName');
        r.title = 'Renewal uplift suppressed on Quote ' + quoteName;
        r.description = 'Renewal Quote Line under-priced by ' + gap.setScale(2) +
                        ' vs entitled uplift of ' + upliftPct + '%';
        r.primaryRecord = new SourceRecord(
            'SBQQ__QuoteLine__c', (Id) row.get('lineId'), (String) row.get('lineName')
        ).withFinancial('netPrice', netPrice)
         .withFinancial('listPrice', row.get('listPrice'));
        r.metadata.put('upliftPct', upliftPct);
        r.metadata.put('originalPrice', originalPrice);
        r.metadata.put('entitledPrice', entitled);
        r.metadata.put('subscriptionId', row.get('subscriptionId'));
        return r;
    }
}
