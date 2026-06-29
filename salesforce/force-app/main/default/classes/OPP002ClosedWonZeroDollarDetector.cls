/**
 * OPP-FOR-002 — Closed-Won Opportunity at $0 (cancellation-by-zero pattern).
 *
 * Opportunity.IsWon=true AND Amount=0 in the last 90 days.
 *
 * Surfaced by the TechTorch/Lexipol engagement (PP-170, PP-171):
 * CSMs more than 45 days from a known cancel were directed to zero out
 * CPQ quote lines and close-won at $0 rather than close-lost. The pattern
 * hides churn from whitespace, churn, and downstream reporting until the
 * 45-day autoclose fires. Industry-non-standard CPQ behavior.
 *
 * Category: governance (data-shape signal, not a direct $ leak).
 * Pure-map evaluator. Works in any org; uses only standard Opportunity fields.
 */
public with sharing class OPP002ClosedWonZeroDollarDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'OPP-FOR-002'; }
    public String getLabel() { return 'Closed-Won Opportunity at $0 (cancellation-by-zero)'; }
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
            '  StageName, CreatedDate ' +
            CurrencyContext.soqlSelect() + ' ' +
            'FROM Opportunity ' +
            'WHERE IsWon = true ' +
            '  AND Amount = 0 ' +
            '  AND CloseDate >= LAST_N_DAYS:90 ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] OPP-FOR-002: ' + e.getMessage());
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
            'closeDate' => raw.get('closeDate') != null ? raw.get('closeDate') : raw.get('CloseDate'),
            'currencyIsoCode' => CurrencyContext.readFromMap(raw)
        };
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id oppId = (Id) row.get('oppId');
        if (oppId == null) return null;

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

        DetectorResult r = new DetectorResult();
        r.detectorId = 'OPP-FOR-002';
        r.severity = daysSinceClose < 30 ? 'Critical' : 'Warning';
        r.entitledUsd = 0;
        r.realizedUsd = 0;
        r.computeGap();
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.4;
        r.title = 'Opportunity ' + oppName + ' closed-won at $0';
        r.description = 'Opportunity for ' + accountName + ' closed-won ' + daysSinceClose +
            ' days ago at zero dollars. Often a cancellation-by-zero pattern (CSM zeroed out ' +
            'quote lines instead of close-lost) which hides churn from whitespace and churn ' +
            'reporting until the renewal autoclose fires. Verify whether this is a real cancel ' +
            'misclassified as won, an internal/trial deal, or an intentional $0 booking.';
        r.primaryRecord = new SourceRecord('Opportunity', oppId, oppName)
            .withFinancial('bookedAmount', 0)
            .withFinancial('closeDate', row.get('closeDate'))
            .withFinancial('daysSinceClose', daysSinceClose);
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('accountName', accountName);
        r.metadata.put('closeDate', row.get('closeDate'));
        r.metadata.put('daysSinceClose', daysSinceClose);
        return r;
    }
}
