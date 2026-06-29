/**
 * CON-FOR-002 — Orphan contract from non-coterm amendment.
 *
 * Detects Contract records that were born from an amendment
 * (SBQQ__AmendedContract__c populated) but did NOT co-term — i.e.,
 * their EndDate differs from the parent contract's EndDate. This is
 * the PP-90 signature: amendments that bypass the co-term path
 * create orphan contracts with independent renewal dates, producing
 * apparent churn when the original renews low.
 *
 * Category: governance (data-shape signal, distorts churn / renewal
 * forecast — not a direct $ leak per row, but a per-account
 * compounding effect).
 * Pure-map evaluator; fails gracefully if SBQQ namespace absent.
 */
public with sharing class CON002OrphanContractDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'CON-FOR-002'; }
    public String getLabel() { return 'Orphan contract from non-coterm amendment'; }
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
            'SELECT Id, ContractNumber, AccountId, Account.Name, ' +
            '  StartDate, EndDate, Status, SBQQ__AmendedContract__c, ' +
            '  SBQQ__AmendedContract__r.ContractNumber, ' +
            '  SBQQ__AmendedContract__r.EndDate ' +
            CurrencyContext.soqlSelect() + ' ' +
            'FROM Contract ' +
            'WHERE SBQQ__AmendedContract__c != null ' +
            '  AND Status = \'Activated\' ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] CON-FOR-002: ' + e.getMessage());
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
        Object pObj = raw.get('SBQQ__AmendedContract__r');
        Map<String, Object> parent = (pObj instanceof Map<String, Object>)
            ? (Map<String, Object>) pObj : new Map<String, Object>();
        return new Map<String, Object>{
            'contractId' => raw.get('Id'),
            'contractNumber' => raw.get('ContractNumber'),
            'accountId' => raw.get('AccountId'),
            'accountName' => acct.get('Name'),
            'endDate' => raw.get('EndDate'),
            'parentContractId' => raw.get('SBQQ__AmendedContract__c'),
            'parentContractNumber' => parent.get('ContractNumber'),
            'parentEndDate' => parent.get('EndDate'),
            'currencyIsoCode' => CurrencyContext.readFromMap(raw)
        };
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id contractId = (Id) row.get('contractId');
        if (contractId == null) return null;

        Date childEnd = toDate(row.get('endDate'));
        Date parentEnd = toDate(row.get('parentEndDate'));
        if (childEnd == null || parentEnd == null) return null;
        // Co-term: end dates match → not an orphan, skip.
        if (childEnd == parentEnd) return null;

        Integer daysDelta = parentEnd.daysBetween(childEnd);
        Integer absDelta = Math.abs(daysDelta);

        String contractNumber = (String) row.get('contractNumber');
        String parentNumber = (String) row.get('parentContractNumber');
        String accountName = (String) row.get('accountName');
        if (String.isBlank(accountName)) {
            accountName = 'Account ' + String.valueOf(row.get('accountId'));
        }

        DetectorResult r = new DetectorResult();
        r.detectorId = 'CON-FOR-002';
        // >30-day drift = Critical (apparent-churn risk), else Warning.
        r.severity = absDelta > 30 ? 'Critical' : 'Warning';
        r.entitledUsd = 0;
        r.realizedUsd = 0;
        r.computeGap();
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.5;
        r.title = 'Contract ' + contractNumber + ' not co-termed with parent ' + parentNumber;
        r.description = 'Amendment-created contract for ' + accountName + ' has EndDate ' +
            String.valueOf(childEnd) + ', but the amended parent ends ' +
            String.valueOf(parentEnd) + ' (' + absDelta + ' days difference). ' +
            'Non-coterm amendments produce orphan contracts with independent renewal dates — ' +
            'when the parent renews and the orphan does not, the gap reads as apparent churn ' +
            'in retention reporting. Verify whether co-terming was intentional.';
        r.primaryRecord = new SourceRecord('Contract', contractId, contractNumber)
            .withFinancial('childEndDate', childEnd)
            .withFinancial('parentEndDate', parentEnd)
            .withFinancial('daysDelta', daysDelta);
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('accountName', accountName);
        r.metadata.put('parentContractId', row.get('parentContractId'));
        r.metadata.put('parentContractNumber', parentNumber);
        r.metadata.put('daysDelta', daysDelta);
        return r;
    }

    private static Date toDate(Object o) {
        if (o == null) return null;
        if (o instanceof Date) return (Date) o;
        if (o instanceof Datetime) return ((Datetime) o).date();
        if (o instanceof String) {
            try { return Date.valueOf((String) o); } catch (Exception e) { return null; }
        }
        return null;
    }
}
