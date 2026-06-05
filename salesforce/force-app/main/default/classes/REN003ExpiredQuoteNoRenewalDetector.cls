/**
 * REN-003 — Quote expired with no renewal action.
 *
 * SBQQ__Quote__c.SBQQ__EndDate__c is in the past (within last 90
 * days) AND no Renewal Quote exists for the same Account created
 * after the expiration. The customer's pricing window lapsed and
 * nobody opened a new one.
 *
 * Category: pipeline (at-risk ARR, recoverable with action).
 * Severity escalates with days since expiration.
 *
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 * The TS version probed for SBQQ__ExpirationDate__c via describe and
 * fell back to SBQQ__EndDate__c; this port uses SBQQ__EndDate__c
 * directly (functionally equivalent for the pipeline use case and
 * avoids the describe call which isn't trivially available on the
 * remote target via OrgQueryService).
 */
public with sharing class REN003ExpiredQuoteNoRenewalDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    /** Drives the full pipeline (renewal lookup + per-quote evaluation)
     *  using pre-shaped contract maps. Each map should use raw Salesforce
     *  field names: Id, Name, SBQQ__Account__c, SBQQ__Account__r,
     *  SBQQ__EndDate__c, SBQQ__NetAmount__c, SBQQ__Type__c, SBQQ__Status__c.
     *  When set, the SOQL on expired quotes is skipped; the renewals
     *  lookup still runs (and may swallow exceptions). */
    @TestVisible static List<Map<String, Object>> testStubExpiredQuotes;
    /** Optional override for the per-account renewal map. When set,
     *  the renewals SOQL is skipped entirely. Key = accountId, value =
     *  latest renewal createdDate (Date or Datetime). */
    @TestVisible static Map<Id, Object> testStubRenewalsByAccount;

    public String getDetectorId() { return 'REN-003'; }
    public String getLabel() { return 'Quote expired with no renewal action'; }
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

        // 1. Expired quotes in the 90-day window.
        List<Map<String, Object>> expired;
        if (testStubExpiredQuotes != null) {
            expired = testStubExpiredQuotes;
        } else {
            String soql =
                'SELECT Id, Name, SBQQ__Account__c, SBQQ__Account__r.Name, ' +
                '  SBQQ__EndDate__c, SBQQ__NetAmount__c, SBQQ__Type__c, ' +
                '  SBQQ__Status__c ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM SBQQ__Quote__c ' +
                'WHERE SBQQ__EndDate__c < TODAY ' +
                '  AND SBQQ__EndDate__c >= LAST_N_DAYS:90 ' +
                '  AND (SBQQ__Type__c IN (\'Quote\', \'Renewal\') OR SBQQ__Type__c = null) ' +
                '  AND SBQQ__Account__c != null ' +
                'LIMIT 5000';
            try { expired = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] REN-FOR-003: ' + e.getMessage());
                return results;
            }
        }
        if (expired.isEmpty()) return results;

        // 2. For each Account in the expired set, find the latest Renewal
        //    Quote createdDate. Done as one bulk query (chunked if huge).
        Set<Id> accountIds = new Set<Id>();
        for (Map<String, Object> q : expired) {
            Object aid = q.get('SBQQ__Account__c');
            if (aid != null) accountIds.add((Id) aid);
        }
        Map<Id, Object> renewalsByAccount;
        if (testStubRenewalsByAccount != null) {
            renewalsByAccount = testStubRenewalsByAccount;
        } else {
            renewalsByAccount = new Map<Id, Object>();
            if (!accountIds.isEmpty()) {
                List<String> quoted = new List<String>();
                for (Id aid : accountIds) quoted.add('\'' + String.valueOf(aid) + '\'');
                String renewalSoql =
                    'SELECT SBQQ__Account__c, MAX(CreatedDate) latestCreated ' +
                    'FROM SBQQ__Quote__c ' +
                    'WHERE SBQQ__Account__c IN (' + String.join(quoted, ',') + ') ' +
                    '  AND SBQQ__Type__c = \'Renewal\' ' +
                    '  AND CreatedDate >= LAST_N_DAYS:90 ' +
                    'GROUP BY SBQQ__Account__c';
                try {
                    for (Map<String, Object> agg : OrgQueryService.query(ctx, renewalSoql)) {
                        Object aid = agg.get('SBQQ__Account__c');
                        if (aid == null) continue;
                        renewalsByAccount.put((Id) aid, agg.get('latestCreated'));
                    }
                } catch (Exception e) {
                    // Namespace missing → no renewals found → every expired quote flags.
                }
            }
        }

        // 3. Per-quote evaluation.
        for (Map<String, Object> q : expired) {
            Object aidObj = q.get('SBQQ__Account__c');
            if (aidObj == null) continue;
            Id accountId = (Id) aidObj;
            Object expirationObj = q.get('SBQQ__EndDate__c');
            if (expirationObj == null) continue;
            Date expirationDate = toDate(expirationObj);
            if (expirationDate == null) continue;

            // Has any renewal Quote been created AFTER the expiration?
            Object latestRenewalObj = renewalsByAccount.get(accountId);
            if (latestRenewalObj != null) {
                Date latestRenewal = toDate(latestRenewalObj);
                if (latestRenewal != null && latestRenewal > expirationDate) continue;
            }

            Object acctObj = q.get('SBQQ__Account__r');
            Map<String, Object> acct = (acctObj instanceof Map<String, Object>)
                ? (Map<String, Object>) acctObj : new Map<String, Object>();

            DetectorResult r = evaluateRow(new Map<String, Object>{
                'quoteId' => q.get('Id'),
                'quoteName' => q.get('Name'),
                'accountId' => accountId,
                'accountName' => acct.get('Name'),
                'arrAtRisk' => q.get('SBQQ__NetAmount__c'),
                'expirationDate' => expirationDate,
                'quoteType' => q.get('SBQQ__Type__c'),
                'quoteStatus' => q.get('SBQQ__Status__c'),
                'currencyIsoCode' => CurrencyContext.readFromMap(q)
            });
            if (r != null) results.add(r);
        }
        return results;
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id quoteId = (Id) row.get('quoteId');
        if (quoteId == null) return null;

        Date expirationDate = toDate(row.get('expirationDate'));
        if (expirationDate == null) return null;

        Decimal arrAtRisk = (Decimal) (row.get('arrAtRisk') == null ? 0 : row.get('arrAtRisk'));
        Integer daysSinceExpiration = expirationDate.daysBetween(Date.today());
        // daysSinceExpiration is positive when expiration is in the past
        // (which is the only case we're flagging).
        if (daysSinceExpiration < 0) daysSinceExpiration = 0;

        String accountName = (String) row.get('accountName');
        if (String.isBlank(accountName)) {
            accountName = 'Account ' + String.valueOf(row.get('accountId'));
        }
        String quoteName = (String) row.get('quoteName');

        // Severity escalates with time.
        String severity;
        if (daysSinceExpiration > 60 || arrAtRisk >= 100000) {
            severity = 'Critical';
        } else if (daysSinceExpiration > 30 || arrAtRisk >= 10000) {
            severity = 'Warning';
        } else {
            severity = 'Info';
        }

        DetectorResult r = new DetectorResult();
        r.detectorId = 'REN-003';
        r.severity = severity;
        r.entitledUsd = arrAtRisk;
        r.realizedUsd = 0;
        r.gapUsd = arrAtRisk;
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        // Recoverability: high if recent, dropping over time.
        Decimal recoverability = 0.95 - (Decimal.valueOf(daysSinceExpiration) * 0.01);
        if (recoverability < 0.3) recoverability = 0.3;
        r.recoverabilityScore = recoverability;

        String quoteType = (String) row.get('quoteType');
        if (String.isBlank(quoteType)) quoteType = 'Quote';

        r.title = 'Quote ' + quoteName + ' expired ' + daysSinceExpiration +
            'd ago — no renewal opened (' + arrAtRisk.setScale(2) + ' ARR at risk)';
        String urgency = daysSinceExpiration > 60
            ? 'Customer is likely actively shopping or has churned.'
            : (daysSinceExpiration > 30
                ? 'Pipeline rot — owner outreach needed this week.'
                : 'Window is still open — open a renewal Quote now.');
        r.description = 'Quote for ' + accountName + ' expired on ' + expirationDate.format() +
            '. ' + arrAtRisk.setScale(2) + ' of annual revenue is at risk. No renewal Quote ' +
            'has been created for this Account since the expiration. ' + urgency;
        r.primaryRecord = new SourceRecord('SBQQ__Quote__c', quoteId, quoteName)
            .withFinancial('netAmount', arrAtRisk)
            .withFinancial('expirationDate', expirationDate)
            .withFinancial('daysExpired', daysSinceExpiration)
            .withFinancial('quoteType', quoteType)
            .withFinancial('quoteStatus', row.get('quoteStatus'));
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('accountName', accountName);
        r.metadata.put('arrAtRisk', arrAtRisk);
        r.metadata.put('expirationDate', expirationDate);
        r.metadata.put('daysExpired', daysSinceExpiration);
        r.metadata.put('quoteType', quoteType);
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
