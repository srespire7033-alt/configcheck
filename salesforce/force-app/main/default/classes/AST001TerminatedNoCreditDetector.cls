/**
 * AST-FOR-001 — Asset terminated, billing still active, no credit memo.
 *
 * Asset in Terminated/Obsolete/Cancelled status but active subscription
 * continues billing. No blng__CreditMemo__c exists for the account in
 * the last 12 months. Customer paying for a product they no longer have.
 *
 * Category: revenue_leakage (exposure side).
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 */
public with sharing class AST001TerminatedNoCreditDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static List<Map<String, Object>> testStubAssets;
    @TestVisible static Map<String, Map<String, Object>> testStubSubsByKey;
    @TestVisible static Set<Id> testStubAccountsWithCreditMemo;

    public String getDetectorId() { return 'AST-FOR-001'; }
    public String getLabel() { return 'Asset terminated, billing still active, no credit memo'; }
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

        // 1. Terminated Assets in 12-month window.
        List<Map<String, Object>> assets;
        if (testStubAssets != null) {
            assets = testStubAssets;
        } else {
            String soql =
                'SELECT Id, Name, AccountId, Product2Id, Product2.Name, ' +
                '  Quantity, Price, Status, UsageEndDate ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM Asset ' +
                'WHERE Status IN (\'Terminated\', \'Obsolete\', \'Cancelled\', \'Expired\') ' +
                '  AND (UsageEndDate >= LAST_N_MONTHS:12 OR UsageEndDate = null) ' +
                'LIMIT 5000';
            try { assets = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] AST-FOR-001: ' + e.getMessage());
                return results;
            }
        }
        if (assets.isEmpty()) return results;

        // 2. Active subscriptions for the same (Account, Product) pairs.
        Map<String, Map<String, Object>> subsByKey = (testStubSubsByKey != null)
            ? testStubSubsByKey
            : lookupActiveSubs(ctx, assets);

        // 3. Accounts that have a credit memo in the window.
        Set<Id> accountsWithCM = (testStubAccountsWithCreditMemo != null)
            ? testStubAccountsWithCreditMemo
            : lookupCreditMemoAccounts(ctx, assets);

        // 4. Build findings.
        for (Map<String, Object> a : assets) {
            Object aidObj = a.get('AccountId');
            Object pidObj = a.get('Product2Id');
            if (aidObj == null || pidObj == null) continue;
            String key = String.valueOf(aidObj) + '::' + String.valueOf(pidObj);
            Map<String, Object> sub = subsByKey.get(key);
            if (sub == null) continue;  // no active billing → not flagging
            if (accountsWithCM.contains((Id) aidObj)) continue;  // CM covers it

            Object prodObj = a.get('Product2');
            Map<String, Object> prod = (prodObj instanceof Map<String, Object>)
                ? (Map<String, Object>) prodObj : new Map<String, Object>();

            DetectorResult r = evaluateRow(new Map<String, Object>{
                'assetId' => a.get('Id'),
                'assetName' => a.get('Name'),
                'accountId' => aidObj,
                'productId' => pidObj,
                'productName' => prod.get('Name'),
                'assetStatus' => a.get('Status'),
                'terminatedDate' => a.get('UsageEndDate'),
                'subscriptionId' => sub.get('Id'),
                'subNetPrice' => sub.get('SBQQ__NetPrice__c'),
                'subQuantity' => sub.get('SBQQ__Quantity__c'),
                'currencyIsoCode' => CurrencyContext.readFromMap(a)
            });
            if (r != null) results.add(r);
        }
        return results;
    }

    private static Map<String, Map<String, Object>> lookupActiveSubs(
        DetectorContext ctx, List<Map<String, Object>> assets
    ) {
        Map<String, Map<String, Object>> out = new Map<String, Map<String, Object>>();
        Set<Id> accountIds = new Set<Id>();
        Set<Id> productIds = new Set<Id>();
        for (Map<String, Object> a : assets) {
            if (a.get('AccountId') != null) accountIds.add((Id) a.get('AccountId'));
            if (a.get('Product2Id') != null) productIds.add((Id) a.get('Product2Id'));
        }
        if (accountIds.isEmpty() || productIds.isEmpty()) return out;

        List<String> acctQuoted = new List<String>();
        for (Id aid : accountIds) acctQuoted.add('\'' + String.valueOf(aid) + '\'');
        List<String> prodQuoted = new List<String>();
        for (Id pid : productIds) prodQuoted.add('\'' + String.valueOf(pid) + '\'');

        String soql =
            'SELECT Id, SBQQ__Account__c, SBQQ__Product__c, SBQQ__Quantity__c, ' +
            '  SBQQ__NetPrice__c, SBQQ__SubscriptionEndDate__c ' +
            'FROM SBQQ__Subscription__c ' +
            'WHERE SBQQ__Account__c IN (' + String.join(acctQuoted, ',') + ') ' +
            '  AND SBQQ__Product__c IN (' + String.join(prodQuoted, ',') + ') ' +
            '  AND (SBQQ__SubscriptionEndDate__c >= TODAY OR SBQQ__SubscriptionEndDate__c = null) ' +
            'LIMIT 50000';
        try {
            for (Map<String, Object> s : OrgQueryService.query(ctx, soql)) {
                Object aid = s.get('SBQQ__Account__c');
                Object pid = s.get('SBQQ__Product__c');
                if (aid == null || pid == null) continue;
                out.put(String.valueOf(aid) + '::' + String.valueOf(pid), s);
            }
        } catch (Exception e) {}
        return out;
    }

    private static Set<Id> lookupCreditMemoAccounts(
        DetectorContext ctx, List<Map<String, Object>> assets
    ) {
        Set<Id> out = new Set<Id>();
        Set<Id> accountIds = new Set<Id>();
        for (Map<String, Object> a : assets) {
            if (a.get('AccountId') != null) accountIds.add((Id) a.get('AccountId'));
        }
        if (accountIds.isEmpty()) return out;

        List<String> quoted = new List<String>();
        for (Id aid : accountIds) quoted.add('\'' + String.valueOf(aid) + '\'');
        String soql =
            'SELECT blng__Account__c FROM blng__CreditMemo__c ' +
            'WHERE blng__Account__c IN (' + String.join(quoted, ',') + ') ' +
            '  AND CreatedDate >= LAST_N_MONTHS:12 ' +
            'LIMIT 50000';
        try {
            for (Map<String, Object> cm : OrgQueryService.query(ctx, soql)) {
                Object aid = cm.get('blng__Account__c');
                if (aid != null) out.add((Id) aid);
            }
        } catch (Exception e) {
            // Billing not installed → no CMs to find → treat all as no-CM.
        }
        return out;
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id assetId = (Id) row.get('assetId');
        if (assetId == null) return null;

        Decimal netPrice = (row.get('subNetPrice') == null) ? 0 : (Decimal) row.get('subNetPrice');
        Decimal qty = (row.get('subQuantity') == null) ? 0 : (Decimal) row.get('subQuantity');
        Decimal annualExposure = netPrice * qty;
        if (annualExposure < 1) return null;

        String assetName = (String) row.get('assetName');
        String productName = (String) row.get('productName');
        if (String.isBlank(productName)) productName = 'product';
        String assetStatus = (String) row.get('assetStatus');

        Date terminated = toDate(row.get('terminatedDate'));
        Integer daysSince = (terminated == null) ? 0 : terminated.daysBetween(Date.today());
        if (daysSince < 0) daysSince = 0;

        String severity = (annualExposure >= 50000) ? 'Critical' : (annualExposure >= 5000 ? 'Warning' : 'Info');

        DetectorResult r = new DetectorResult();
        r.detectorId = 'AST-FOR-001';
        r.severity = severity;
        r.entitledUsd = 0;
        r.realizedUsd = annualExposure;
        r.gapUsd = annualExposure;
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.7;
        r.title = 'Asset ' + assetName + ' terminated but subscription still billing — no credit memo (' +
            annualExposure.setScale(2) + '/yr exposure)';
        String dayPhrase = (terminated == null) ? '' : ' (' + daysSince + ' days ago)';
        r.description = 'Asset for ' + productName + ' is in \'' + assetStatus + '\' status' + dayPhrase +
            ', but an active Subscription continues to bill ' + annualExposure.setScale(2) +
            '/yr. No Credit Memo found in the last 12 months for this Account. Customer is paying ' +
            'for a product they no longer have.';
        r.primaryRecord = new SourceRecord('Asset', assetId, assetName)
            .withFinancial('status', assetStatus)
            .withFinancial('terminatedDate', terminated)
            .withFinancial('daysSinceTerminated', daysSince);
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('productId', row.get('productId'));
        r.metadata.put('productName', productName);
        r.metadata.put('assetStatus', assetStatus);
        r.metadata.put('terminatedDate', terminated);
        r.metadata.put('subscriptionId', row.get('subscriptionId'));
        r.metadata.put('annualExposure', annualExposure);
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
