/**
 * AMD-FOR-001 — Amendment Quote without effective date.
 *
 * Flags SBQQ__Quote__c records where SBQQ__Type__c = 'Amendment'
 * but SBQQ__StartDate__c is null. CPQ uses that field for proration
 * / co-term math; missing it makes downstream Subscription start
 * dates ambiguous and breaks the audit trail.
 *
 * Category: governance (no $ leak claim).
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 */
public with sharing class AMD001NoEffectiveDateDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'AMD-FOR-001'; }
    public String getLabel() { return 'Amendment Quote missing effective date'; }
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

        String soql =
            'SELECT Id, Name, SBQQ__Account__c, SBQQ__Account__r.Name, ' +
            '  SBQQ__Status__c, SBQQ__NetAmount__c, ' +
            '  SBQQ__StartDate__c, SBQQ__EndDate__c, CreatedDate ' +
            'FROM SBQQ__Quote__c ' +
            'WHERE SBQQ__Type__c = \'Amendment\' ' +
            '  AND SBQQ__StartDate__c = null ' +
            '  AND CreatedDate >= LAST_N_MONTHS:12 ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] AMD-FOR-001: ' + e.getMessage());
            return results;
        }

        for (Map<String, Object> row : rows) {
            DetectorResult r = evaluateRow(unwrap(row));
            if (r != null) results.add(r);
        }
        return results;
    }

    @TestVisible
    static Map<String, Object> unwrap(Map<String, Object> raw) {
        if (raw == null) return new Map<String, Object>();
        Object aObj = raw.get('SBQQ__Account__r');
        Map<String, Object> acct = (aObj instanceof Map<String, Object>)
            ? (Map<String, Object>) aObj : new Map<String, Object>();
        return new Map<String, Object>{
            'quoteId' => raw.get('Id'),
            'quoteName' => raw.get('Name'),
            'accountId' => raw.get('SBQQ__Account__c'),
            'accountName' => acct.get('Name'),
            'status' => raw.get('SBQQ__Status__c'),
            'netAmount' => raw.get('SBQQ__NetAmount__c'),
            'endDate' => raw.get('SBQQ__EndDate__c'),
            'currencyIsoCode' => CurrencyContext.readFromMap(raw)
        };
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id quoteId = (Id) row.get('quoteId');
        if (quoteId == null) return null;

        Decimal netAmount = (Decimal) (row.get('netAmount') == null ? 0 : row.get('netAmount'));
        String quoteName = (String) row.get('quoteName');
        String accountName = (String) row.get('accountName');
        if (String.isBlank(accountName)) {
            accountName = 'Account ' + String.valueOf(row.get('accountId'));
        }

        DetectorResult r = new DetectorResult();
        r.detectorId = 'AMD-FOR-001';
        r.severity = 'Warning';
        r.entitledUsd = netAmount;
        r.realizedUsd = netAmount;
        r.computeGap();
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.7;
        r.title = 'Amendment Quote ' + quoteName + ' has no effective date — proration math undefined';
        r.description = 'Amendment Quote for ' + accountName + ' (' +
            netAmount.setScale(2) + ') is missing SBQQ__StartDate__c. CPQ uses this field ' +
            'for proration / co-term math; without it, downstream Subscription start dates may ' +
            'be incorrect and the amendment\'s $ allocation across periods is ambiguous.';
        r.primaryRecord = new SourceRecord('SBQQ__Quote__c', quoteId, quoteName)
            .withFinancial('netAmount', netAmount)
            .withFinancial('status', row.get('status'))
            .withFinancial('endDate', row.get('endDate'));
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('accountName', accountName);
        r.metadata.put('status', row.get('status'));
        r.metadata.put('endDate', row.get('endDate'));
        return r;
    }
}
