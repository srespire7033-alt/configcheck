/**
 * CON-FOR-001 — Contract Activated but all subscriptions expired
 * (or no subscriptions exist at all).
 *
 * Two failure modes:
 *   - 'no_subs': Activated contract with zero SBQQ__Subscription__c records
 *   - 'all_expired': Activated contract where every sub ended before today
 *
 * Category: governance (no $ leak claim — inconsistent state).
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 */
public with sharing class CON001NoActiveSubsDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    /** Drives the SOQL-result iteration path without real Contract data. */
    @TestVisible static List<Map<String, Object>> testStubContracts;

    public String getDetectorId() { return 'CON-FOR-001'; }
    public String getLabel() { return 'Contract activated, all subscriptions expired'; }
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

        // 1. Live activated contracts — either from SOQL or from the
        //    testStubContracts seam (used for testing the full pipeline
        //    including the subscription-aggregate lookup).
        List<Map<String, Object>> contracts;
        if (testStubContracts != null) {
            contracts = testStubContracts;
        } else {
            String contractSoql =
                'SELECT Id, ContractNumber, AccountId, Account.Name, ' +
                '  StartDate, EndDate, Status ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM Contract ' +
                'WHERE Status = \'Activated\' ' +
                '  AND (EndDate > TODAY OR EndDate = null) ' +
                'LIMIT 5000';
            try { contracts = OrgQueryService.query(ctx, contractSoql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] CON-FOR-001: ' + e.getMessage());
                return results;
            }
        }
        if (contracts.isEmpty()) return results;

        // 2. Subscription aggregates per contract.
        Set<Id> contractIds = new Set<Id>();
        for (Map<String, Object> c : contracts) {
            Object idVal = c.get('Id');
            if (idVal != null) contractIds.add((Id) idVal);
        }

        Map<Id, Map<String, Object>> subState = new Map<Id, Map<String, Object>>();
        if (!contractIds.isEmpty()) {
            List<String> quoted = new List<String>();
            for (Id cid : contractIds) quoted.add('\'' + String.valueOf(cid) + '\'');
            String subSoql =
                'SELECT SBQQ__Contract__c, MAX(SBQQ__SubscriptionEndDate__c) maxEnd, ' +
                '  COUNT(Id) subCount ' +
                'FROM SBQQ__Subscription__c ' +
                'WHERE SBQQ__Contract__c IN (' + String.join(quoted, ',') + ') ' +
                'GROUP BY SBQQ__Contract__c';
            try {
                for (Map<String, Object> agg : OrgQueryService.query(ctx, subSoql)) {
                    Object cid = agg.get('SBQQ__Contract__c');
                    if (cid == null) continue;
                    subState.put((Id) cid, new Map<String, Object>{
                        'count' => agg.get('subCount'),
                        'maxEnd' => agg.get('maxEnd')
                    });
                }
            } catch (Exception e) {
                // SBQQ namespace not present → all contracts have no_subs.
            }
        }

        // 3. Flag matching contracts.
        for (Map<String, Object> c : contracts) {
            Id contractId = (Id) c.get('Id');
            Map<String, Object> state = subState.get(contractId);
            Integer subCount = (state == null || state.get('count') == null)
                ? 0 : Integer.valueOf(state.get('count'));
            Object maxEnd = (state == null) ? null : state.get('maxEnd');

            Object aObj = c.get('Account');
            Map<String, Object> acct = (aObj instanceof Map<String, Object>)
                ? (Map<String, Object>) aObj : new Map<String, Object>();

            DetectorResult r = evaluateRow(new Map<String, Object>{
                'contractId' => contractId,
                'contractNumber' => c.get('ContractNumber'),
                'accountId' => c.get('AccountId'),
                'accountName' => acct.get('Name'),
                'startDate' => c.get('StartDate'),
                'endDate' => c.get('EndDate'),
                'subscriptionCount' => subCount,
                'maxSubEnd' => maxEnd,
                'currencyIsoCode' => CurrencyContext.readFromMap(c)
            });
            if (r != null) results.add(r);
        }
        return results;
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id contractId = (Id) row.get('contractId');
        if (contractId == null) return null;

        Integer subCount = (row.get('subscriptionCount') == null)
            ? 0 : Integer.valueOf(row.get('subscriptionCount'));
        Object maxEnd = row.get('maxSubEnd');

        String flag = null;
        if (subCount == 0) {
            flag = 'no_subs';
        } else if (maxEnd != null) {
            Date maxEndDate = toDate(maxEnd);
            if (maxEndDate != null && maxEndDate < Date.today()) flag = 'all_expired';
        }
        if (flag == null) return null;

        String contractNumber = (String) row.get('contractNumber');
        String accountName = (String) row.get('accountName');
        if (String.isBlank(accountName)) {
            accountName = 'Account ' + String.valueOf(row.get('accountId'));
        }
        Object endDateRaw = row.get('endDate');
        String endDateStr = (endDateRaw == null) ? '(open-ended)' : String.valueOf(endDateRaw);

        DetectorResult r = new DetectorResult();
        r.detectorId = 'CON-FOR-001';
        r.severity = 'Warning';
        r.entitledUsd = 0;
        r.realizedUsd = 0;
        r.computeGap();
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.6;

        if (flag == 'no_subs') {
            r.title = 'Contract ' + contractNumber + ' activated but has zero subscriptions';
            r.description = 'Contract is in Activated status with EndDate ' + endDateStr +
                ', but no SBQQ__Subscription__c records reference it. Either the renewal/' +
                'amendment skipped subscription creation, or the contract should never have ' +
                'been activated.';
        } else {
            r.title = 'Contract ' + contractNumber + ' activated but all subscriptions expired';
            r.description = 'Contract is in Activated status with EndDate ' + endDateStr +
                ', but all ' + subCount + ' subscription(s) on this contract ended by ' +
                String.valueOf(maxEnd) + '. Customer has nothing live under this contract — ' +
                'either it needs to be renewed/amended or its status corrected.';
        }

        r.primaryRecord = new SourceRecord('Contract', contractId, contractNumber)
            .withFinancial('startDate', row.get('startDate'))
            .withFinancial('endDate', row.get('endDate'))
            .withFinancial('subscriptionCount', subCount)
            .withFinancial('latestSubscriptionEnd', maxEnd);
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('accountName', accountName);
        r.metadata.put('flagReason', flag);
        r.metadata.put('subscriptionCount', subCount);
        r.metadata.put('latestSubscriptionEnd', maxEnd);
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
