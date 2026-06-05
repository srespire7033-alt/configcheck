/**
 * REN-004 — Renewal Quote stuck in Draft past contract end.
 *
 * Renewal Quotes (SBQQ__Type__c='Renewal') that are sitting in
 * Draft/In Review/etc. while the related MasterContract's EndDate
 * is already in the past. Renewal IS being worked but is stalled
 * in someone's queue — classic pipeline rot.
 *
 * Different from REN-003 (Quote expired with NO renewal opened) —
 * here the renewal Quote EXISTS but hasn't moved.
 *
 * Category: pipeline (prospective, recoverable with action).
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 */
public with sharing class REN004StuckDraftRenewalDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'REN-004'; }
    public String getLabel() { return 'Renewal Quote stuck in Draft past contract end'; }
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

        // Stale statuses — quotes here are "being worked" but not closed.
        String soql =
            'SELECT Id, Name, SBQQ__Account__c, SBQQ__Account__r.Name, ' +
            '  SBQQ__Status__c, SBQQ__NetAmount__c, ' +
            '  SBQQ__MasterContract__c, SBQQ__MasterContract__r.EndDate, ' +
            '  SBQQ__MasterContract__r.ContractNumber, ' +
            '  CreatedDate, LastModifiedDate ' +
            CurrencyContext.soqlSelect() + ' ' +
            'FROM SBQQ__Quote__c ' +
            'WHERE SBQQ__Type__c = \'Renewal\' ' +
            '  AND SBQQ__Status__c IN (\'Draft\', \'In Review\', \'In Review/Approval\', ' +
            '    \'Pending\', \'Pending Approval\', \'Saved\') ' +
            '  AND SBQQ__MasterContract__c != null ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] REN-FOR-004: ' + e.getMessage());
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
        Object cObj = raw.get('SBQQ__MasterContract__r');
        Map<String, Object> contract = (cObj instanceof Map<String, Object>)
            ? (Map<String, Object>) cObj : new Map<String, Object>();
        return new Map<String, Object>{
            'quoteId' => raw.get('Id'),
            'quoteName' => raw.get('Name'),
            'accountId' => raw.get('SBQQ__Account__c'),
            'accountName' => acct.get('Name'),
            'status' => raw.get('SBQQ__Status__c'),
            'arrAtRisk' => raw.get('SBQQ__NetAmount__c'),
            'contractId' => raw.get('SBQQ__MasterContract__c'),
            'contractEndDate' => contract.get('EndDate'),
            'contractNumber' => contract.get('ContractNumber'),
            'lastModifiedDate' => raw.get('LastModifiedDate'),
            'currencyIsoCode' => CurrencyContext.readFromMap(raw)
        };
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id quoteId = (Id) row.get('quoteId');
        if (quoteId == null) return null;

        // Contract end must exist AND be in the past.
        Date contractEnd = toDate(row.get('contractEndDate'));
        if (contractEnd == null) return null;
        Integer daysOverdue = contractEnd.daysBetween(Date.today());
        if (daysOverdue <= 0) return null;

        Decimal arrAtRisk = (Decimal) (row.get('arrAtRisk') == null ? 0 : row.get('arrAtRisk'));
        Integer daysSinceTouched = 0;
        Date lastMod = toDate(row.get('lastModifiedDate'));
        if (lastMod != null) daysSinceTouched = lastMod.daysBetween(Date.today());

        String quoteName = (String) row.get('quoteName');
        String status = (String) row.get('status');
        String accountName = (String) row.get('accountName');
        if (String.isBlank(accountName)) {
            accountName = 'Account ' + String.valueOf(row.get('accountId'));
        }

        String severity;
        if (daysOverdue > 90) severity = 'Critical';
        else if (daysOverdue > 30) severity = 'Warning';
        else severity = 'Info';

        DetectorResult r = new DetectorResult();
        r.detectorId = 'REN-004';
        r.severity = severity;
        r.entitledUsd = arrAtRisk;
        r.realizedUsd = 0;
        r.gapUsd = arrAtRisk;
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        // Recoverability drops with time — customer goes silent.
        Decimal recov = 0.9 - (Decimal.valueOf(daysOverdue) * 0.005);
        if (recov < 0.3) recov = 0.3;
        r.recoverabilityScore = recov;
        r.title = 'Renewal Quote ' + quoteName + ' ' + daysOverdue + 'd past contract end — still in ' +
            status + ' (' + arrAtRisk.setScale(2) + ' ARR)';
        r.description = 'Renewal Quote for ' + accountName + ' sits in \'' + status + '\' status. ' +
            'Contract ended ' + daysOverdue + ' days ago. Last touched ' + daysSinceTouched +
            ' days ago. ' + arrAtRisk.setScale(2) + ' of annual revenue at risk.';
        r.primaryRecord = new SourceRecord('SBQQ__Quote__c', quoteId, quoteName)
            .withFinancial('netAmount', arrAtRisk)
            .withFinancial('status', status)
            .withFinancial('contractEndDate', contractEnd)
            .withFinancial('daysOverdue', daysOverdue)
            .withFinancial('daysSinceTouched', daysSinceTouched);
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('accountName', accountName);
        r.metadata.put('status', status);
        r.metadata.put('contractId', row.get('contractId'));
        r.metadata.put('contractEndDate', contractEnd);
        r.metadata.put('daysOverdue', daysOverdue);
        r.metadata.put('daysSinceTouched', daysSinceTouched);
        r.metadata.put('arrAtRisk', arrAtRisk);
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
