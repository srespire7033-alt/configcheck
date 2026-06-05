/**
 * REN-002 — Renewal Below Current List Price
 *
 * Pure-map evaluator. See REN001 header for the architecture
 * rationale — no compile-time CPQ namespace dependency.
 */
public with sharing class REN002RenewalBelowListDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'REN-002'; }
    public String getLabel() { return 'Renewal Below Current List Price'; }
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

        // Schema-presence guard for LOCAL scans only. Remote scans hit a
        // different org; SchemaUtil would describe the host (irrelevant)
        // so we skip the guard and let try/catch handle missing schema.
        if (!ctx.isRemote()) {
            if (!SchemaUtil.hasField('SBQQ__QuoteLine__c', 'SBQQ__ListPrice__c') ||
                !SchemaUtil.hasField('SBQQ__QuoteLine__c', 'SBQQ__NetPrice__c')) {
                System.debug(LoggingLevel.WARN,
                    '[OrgPrism Skip] REN-002: SBQQ__QuoteLine__c.SBQQ__ListPrice__c / SBQQ__NetPrice__c not present in this org\'s CPQ version.');
                return results;
            }
        }

        List<Map<String, Object>> rows;
        {
            String soql =
                'SELECT Id, Name, SBQQ__NetPrice__c, SBQQ__ListPrice__c, ' +
                '  SBQQ__Quote__c, SBQQ__Quote__r.Name, SBQQ__Quote__r.SBQQ__Type__c, ' +
                '  SBQQ__Product__c, SBQQ__Product__r.Name ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM SBQQ__QuoteLine__c ' +
                'WHERE SBQQ__Quote__r.SBQQ__Type__c = \'Renewal\' ' +
                // SOQL doesn't support field-to-field comparison
                // (NetPrice < ListPrice). Filter in Apex via evaluateRow.
                '  AND SBQQ__NetPrice__c != null ' +
                '  AND SBQQ__ListPrice__c != null ' +
                '  AND CreatedDate >= LAST_N_MONTHS:24 ' +
                'LIMIT 5000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] REN-FOR-002: ' + e.getMessage());
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
        return new Map<String, Object>{
            'lineId' => raw.get('Id'),
            'lineName' => raw.get('Name'),
            'netPrice' => raw.get('SBQQ__NetPrice__c'),
            'listPrice' => raw.get('SBQQ__ListPrice__c'),
            'quoteName' => quote.get('Name'),
            'currencyIsoCode' => CurrencyContext.readFromMap(raw)
        };
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
