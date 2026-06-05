/**
 * OPP-FOR-001 — Closed-Won Opportunity without a Primary Quote.
 *
 * Opportunity.StageName='Closed Won' but SBQQ__PrimaryQuote__c is null.
 * Deal booked, no quoting trail. The Amount was booked by the AE and
 * may already be invoiced — but no pricing approval signature exists.
 *
 * Category: governance (no $ leak claim — audit trail gap).
 * Pure-map evaluator. Works in any org; SBQQ__PrimaryQuote__c only
 * exists when CPQ is installed in the target.
 */
public with sharing class OPP001ClosedWonNoQuoteDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'OPP-FOR-001'; }
    public String getLabel() { return 'Closed-Won Opportunity has no Primary Quote'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing', 'ARM' };
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
            'SELECT Id, Name, AccountId, Account.Name, Amount, CloseDate, ' +
            '  StageName, CreatedDate, SBQQ__PrimaryQuote__c ' +
            CurrencyContext.soqlSelect() + ' ' +
            'FROM Opportunity ' +
            'WHERE StageName = \'Closed Won\' ' +
            '  AND CloseDate >= LAST_N_MONTHS:12 ' +
            '  AND SBQQ__PrimaryQuote__c = null ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] OPP-FOR-001: ' + e.getMessage());
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
        Object aObj = raw.get('Account');
        Map<String, Object> acct = (aObj instanceof Map<String, Object>)
            ? (Map<String, Object>) aObj : new Map<String, Object>();
        return new Map<String, Object>{
            'oppId' => raw.get('Id'),
            'oppName' => raw.get('Name'),
            'accountId' => raw.get('AccountId'),
            'accountName' => acct.get('Name'),
            'amount' => raw.get('Amount'),
            'closeDate' => raw.get('CloseDate'),
            'currencyIsoCode' => CurrencyContext.readFromMap(raw)
        };
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id oppId = (Id) row.get('oppId');
        if (oppId == null) return null;

        Decimal amount = (Decimal) (row.get('amount') == null ? 0 : row.get('amount'));
        String oppName = (String) row.get('oppName');
        String accountName = (String) row.get('accountName');
        if (String.isBlank(accountName)) {
            accountName = 'Account ' + String.valueOf(row.get('accountId'));
        }

        Integer daysSinceClose = 0;
        Object cdRaw = row.get('closeDate');
        if (cdRaw != null) {
            Date closeDate;
            if (cdRaw instanceof Date) {
                closeDate = (Date) cdRaw;
            } else if (cdRaw instanceof String) {
                try { closeDate = Date.valueOf((String) cdRaw); } catch (Exception e) {}
            }
            if (closeDate != null) {
                daysSinceClose = closeDate.daysBetween(Date.today());
            }
        }

        String severity = (amount >= 100000 && daysSinceClose < 90) ? 'Critical' : 'Warning';

        DetectorResult r = new DetectorResult();
        r.detectorId = 'OPP-FOR-001';
        r.severity = severity;
        r.entitledUsd = amount;
        r.realizedUsd = amount;
        r.computeGap();  // 0 — NOT a $ leak claim
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.5;
        r.title = 'Opportunity ' + oppName + ' closed ' + amount.setScale(2) + ' without a Quote';
        r.description = 'Deal closed ' + daysSinceClose + ' days ago for ' + accountName +
            ' at ' + amount.setScale(2) + ', but no Quote was created or linked. ' +
            'No pricing audit trail, no approval signature. Verify billing and pricing ' +
            'match the booked amount.';
        r.primaryRecord = new SourceRecord('Opportunity', oppId, oppName)
            .withFinancial('bookedAmount', amount)
            .withFinancial('closeDate', row.get('closeDate'))
            .withFinancial('daysSinceClose', daysSinceClose);
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('accountName', accountName);
        r.metadata.put('closeDate', row.get('closeDate'));
        r.metadata.put('daysSinceClose', daysSinceClose);
        return r;
    }
}
