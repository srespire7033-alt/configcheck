/**
 * REN-001 — Renewal Uplift Suppressed
 *
 * Detects renewal Quote Lines where the contractually entitled uplift
 * (escalation %) was NOT applied. Verified-$, per-record.
 *
 * Pure-map evaluator: this class never references CPQ namespace types
 * at compile time. The SBQQ__ namespace appears only inside the SOQL
 * string. OrgQueryService returns generic Map<String, Object> rows;
 * detectors read fields by key. Result: this class compiles cleanly
 * in a host org that does NOT have CPQ installed — only the remote
 * target org needs CPQ.
 *
 * Test injection seam: `testStubRows` short-circuits run() to drive
 * evaluateRow directly. No SOQL is executed when the stub is set.
 */
public with sharing class REN001RenewalUpliftDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'REN-001'; }
    public String getLabel() { return 'Renewal Uplift Suppressed'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        // testStubRows is pre-flattened (already in evaluateRow's expected
        // shape). Go straight to evaluateRow; unwrap() is only for raw
        // SOQL/REST rows that still have SBQQ__ prefixed keys and nested
        // relationship maps.
        if (testStubRows != null) {
            for (Map<String, Object> row : testStubRows) {
                DetectorResult r = evaluateRow(row);
                if (r != null) results.add(r);
            }
            return results;
        }

        String soql =
            'SELECT Id, Name, SBQQ__NetPrice__c, SBQQ__ListPrice__c, ' +
            '  SBQQ__Quote__c, SBQQ__Quote__r.Name, SBQQ__Quote__r.SBQQ__Account__c, ' +
            '  SBQQ__Quote__r.SBQQ__Account__r.Name, SBQQ__Quote__r.SBQQ__Type__c, ' +
            '  SBQQ__RenewedSubscription__c, SBQQ__RenewedSubscription__r.Name, ' +
            '  SBQQ__RenewedSubscription__r.SBQQ__NetPrice__c, ' +
            '  SBQQ__RenewedSubscription__r.SBQQ__Contract__c, ' +
            '  SBQQ__RenewedSubscription__r.SBQQ__Contract__r.SBQQ__RenewalUpliftRate__c ' +
            CurrencyContext.soqlSelect() + ' ' +
            'FROM SBQQ__QuoteLine__c ' +
            'WHERE SBQQ__Quote__r.SBQQ__Type__c = \'Renewal\' ' +
            '  AND CreatedDate >= LAST_N_MONTHS:24 ' +
            '  AND SBQQ__NetPrice__c != null ' +
            '  AND SBQQ__RenewedSubscription__c != null ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] REN-FOR-001: ' + e.getMessage());
            return results;
        }

        for (Map<String, Object> row : rows) {
            DetectorResult r = evaluateRow(unwrap(row));
            if (r != null) results.add(r);
        }
        return results;
    }

    /**
     * Flatten the nested-relationship Map shape returned by OrgQueryService
     * into the simple flat shape evaluateRow consumes. Robust to missing
     * nested objects — every step short-circuits to null safely.
     */
    @TestVisible
    static Map<String, Object> unwrap(Map<String, Object> raw) {
        if (raw == null) return new Map<String, Object>();
        Map<String, Object> sub = asMap(raw.get('SBQQ__RenewedSubscription__r'));
        Map<String, Object> contract = asMap(sub.get('SBQQ__Contract__r'));
        Map<String, Object> quote = asMap(raw.get('SBQQ__Quote__r'));
        Map<String, Object> acct = asMap(quote.get('SBQQ__Account__r'));

        return new Map<String, Object>{
            'lineId' => raw.get('Id'),
            'lineName' => raw.get('Name'),
            'netPrice' => raw.get('SBQQ__NetPrice__c'),
            'listPrice' => raw.get('SBQQ__ListPrice__c'),
            'originalPrice' => sub.get('SBQQ__NetPrice__c'),
            'upliftPct' => contract.get('SBQQ__RenewalUpliftRate__c'),
            'quoteName' => quote.get('Name'),
            'accountName' => acct.get('Name'),
            'subscriptionId' => sub.get('Id'),
            'currencyIsoCode' => CurrencyContext.readFromMap(raw)
        };
    }

    @TestVisible
    static Map<String, Object> asMap(Object o) {
        if (o == null || !(o instanceof Map<String, Object>)) return new Map<String, Object>();
        return (Map<String, Object>) o;
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        // Accept both pre-flat (test stubs) and raw-from-query shapes.
        // The keys differ: pre-flat uses 'netPrice', raw uses 'SBQQ__NetPrice__c'.
        Decimal netPrice = pickDecimal(row, 'netPrice', 'SBQQ__NetPrice__c');
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
        Decimal listPrice = pickDecimal(row, 'listPrice', 'SBQQ__ListPrice__c');
        r.primaryRecord = new SourceRecord(
            'SBQQ__QuoteLine__c', (Id) row.get('lineId'), (String) row.get('lineName')
        ).withFinancial('netPrice', netPrice)
         .withFinancial('listPrice', listPrice);
        r.metadata.put('upliftPct', upliftPct);
        r.metadata.put('originalPrice', originalPrice);
        r.metadata.put('entitledPrice', entitled);
        r.metadata.put('subscriptionId', row.get('subscriptionId'));
        return r;
    }

    private static Decimal pickDecimal(Map<String, Object> row, String key1, String key2) {
        Object v = row.get(key1);
        if (v == null) v = row.get(key2);
        return (Decimal) v;
    }
}
