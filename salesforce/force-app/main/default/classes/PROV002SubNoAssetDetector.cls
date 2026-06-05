/**
 * PROV-FOR-002 — Active Subscription with no Asset.
 *
 * Inverse of PROV-FOR-001. Customer is being billed (active
 * Subscription) but no Asset exists. Either:
 *   - Customer cancelled but billing wasn't stopped (refund risk)
 *   - Provisioning never happened (customer success gap)
 *
 * Category: revenue_leakage (exposure side, not pure leak —
 * could go either direction).
 *
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 */
public with sharing class PROV002SubNoAssetDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static List<Map<String, Object>> testStubSubs;
    @TestVisible static Set<String> testStubAssetKeys;

    public String getDetectorId() { return 'PROV-FOR-002'; }
    public String getLabel() { return 'Active subscription with no Asset'; }
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

        // 1. Active subscriptions.
        List<Map<String, Object>> subs;
        if (testStubSubs != null) {
            subs = testStubSubs;
        } else {
            String soql =
                'SELECT Id, Name, SBQQ__Account__c, SBQQ__Account__r.Name, ' +
                '  SBQQ__Product__c, SBQQ__Product__r.Name, ' +
                '  SBQQ__Quantity__c, SBQQ__NetPrice__c, ' +
                '  SBQQ__SubscriptionStartDate__c, SBQQ__SubscriptionEndDate__c ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM SBQQ__Subscription__c ' +
                'WHERE (SBQQ__SubscriptionEndDate__c >= TODAY OR SBQQ__SubscriptionEndDate__c = null) ' +
                'LIMIT 5000';
            try { subs = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PROV-FOR-002: ' + e.getMessage());
                return results;
            }
        }
        if (subs.isEmpty()) return results;

        // 2. (Account, Product) keys that DO have an installed Asset.
        Set<String> assetKeys = (testStubAssetKeys != null)
            ? testStubAssetKeys
            : lookupAssetKeys(ctx, subs);

        // 3. Build findings (dedupe per Account+Product).
        Set<String> seen = new Set<String>();
        for (Map<String, Object> sub : subs) {
            Object aidObj = sub.get('SBQQ__Account__c');
            Object pidObj = sub.get('SBQQ__Product__c');
            if (aidObj == null || pidObj == null) continue;
            String key = String.valueOf(aidObj) + '::' + String.valueOf(pidObj);
            if (seen.contains(key)) continue;
            seen.add(key);
            if (assetKeys.contains(key)) continue;

            Object acctMap = sub.get('SBQQ__Account__r');
            Map<String, Object> acct = (acctMap instanceof Map<String, Object>)
                ? (Map<String, Object>) acctMap : new Map<String, Object>();
            Object prodMap = sub.get('SBQQ__Product__r');
            Map<String, Object> prod = (prodMap instanceof Map<String, Object>)
                ? (Map<String, Object>) prodMap : new Map<String, Object>();

            DetectorResult r = evaluateRow(new Map<String, Object>{
                'subscriptionId' => sub.get('Id'),
                'subscriptionName' => sub.get('Name'),
                'accountId' => aidObj,
                'accountName' => acct.get('Name'),
                'productId' => pidObj,
                'productName' => prod.get('Name'),
                'quantity' => sub.get('SBQQ__Quantity__c'),
                'unitPrice' => sub.get('SBQQ__NetPrice__c'),
                'currencyIsoCode' => CurrencyContext.readFromMap(sub)
            });
            if (r != null) results.add(r);
        }
        return results;
    }

    private static Set<String> lookupAssetKeys(DetectorContext ctx, List<Map<String, Object>> subs) {
        Set<String> out = new Set<String>();
        Set<Id> accountIds = new Set<Id>();
        Set<Id> productIds = new Set<Id>();
        for (Map<String, Object> s : subs) {
            if (s.get('SBQQ__Account__c') != null) accountIds.add((Id) s.get('SBQQ__Account__c'));
            if (s.get('SBQQ__Product__c') != null) productIds.add((Id) s.get('SBQQ__Product__c'));
        }
        if (accountIds.isEmpty() || productIds.isEmpty()) return out;

        List<String> acctQuoted = new List<String>();
        for (Id aid : accountIds) acctQuoted.add('\'' + String.valueOf(aid) + '\'');
        List<String> prodQuoted = new List<String>();
        for (Id pid : productIds) prodQuoted.add('\'' + String.valueOf(pid) + '\'');

        String soql =
            'SELECT AccountId, Product2Id FROM Asset ' +
            'WHERE AccountId IN (' + String.join(acctQuoted, ',') + ') ' +
            '  AND Product2Id IN (' + String.join(prodQuoted, ',') + ') ' +
            '  AND Status IN (\'Installed\', \'Active\', \'Purchased\', \'Registered\') ' +
            'LIMIT 50000';
        try {
            for (Map<String, Object> a : OrgQueryService.query(ctx, soql)) {
                Object aid = a.get('AccountId');
                Object pid = a.get('Product2Id');
                if (aid != null && pid != null) {
                    out.add(String.valueOf(aid) + '::' + String.valueOf(pid));
                }
            }
        } catch (Exception e) {}
        return out;
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id subId = (Id) row.get('subscriptionId');
        if (subId == null) return null;

        Decimal qty = (row.get('quantity') == null) ? 0 : (Decimal) row.get('quantity');
        Decimal unitPrice = (row.get('unitPrice') == null) ? 0 : (Decimal) row.get('unitPrice');
        Decimal annualExposure = qty * unitPrice;
        if (annualExposure < 1) return null;

        String subName = (String) row.get('subscriptionName');
        String productName = (String) row.get('productName');
        if (String.isBlank(productName)) productName = String.valueOf(row.get('productId'));
        String accountName = (String) row.get('accountName');
        if (String.isBlank(accountName)) {
            accountName = 'Account ' + String.valueOf(row.get('accountId'));
        }

        String severity = (annualExposure >= 50000) ? 'Critical' : (annualExposure >= 5000 ? 'Warning' : 'Info');

        DetectorResult r = new DetectorResult();
        r.detectorId = 'PROV-FOR-002';
        r.severity = severity;
        r.entitledUsd = 0;
        r.realizedUsd = annualExposure;
        r.gapUsd = annualExposure;
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.5;  // requires investigation
        r.title = 'Active subscription ' + subName + ' bills ' + qty + '× ' + productName +
            ' — no Asset on file (' + annualExposure.setScale(2) + '/yr)';
        r.description = 'Customer ' + accountName + ' is being billed for ' + qty + '× ' +
            productName + ' (' + annualExposure.setScale(2) + '/yr) but no installed Asset ' +
            'exists for this Account+Product. Either the customer cancelled and billing wasn\'t ' +
            'stopped (refund risk) OR provisioning never happened (customer success gap).';
        r.primaryRecord = new SourceRecord('SBQQ__Subscription__c', subId, subName)
            .withFinancial('quantity', qty)
            .withFinancial('unitPrice', unitPrice)
            .withFinancial('annualExposure', annualExposure);
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('accountName', accountName);
        r.metadata.put('productId', row.get('productId'));
        r.metadata.put('productName', productName);
        r.metadata.put('quantity', qty);
        r.metadata.put('unitPrice', unitPrice);
        r.metadata.put('annualExposure', annualExposure);
        return r;
    }
}
