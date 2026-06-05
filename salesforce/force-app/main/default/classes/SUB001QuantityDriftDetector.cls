/**
 * SUB-FOR-001 — Subscription quantity drift vs Asset.
 *
 * Customer's active Subscription says N units, provisioned Asset
 * says M units. When N != M:
 *   - asset > sub → under-billed (revenue leak)
 *   - asset < sub → over-billed (refund risk + compliance)
 *
 * Gap = |delta| × unitPrice.
 *
 * Category: revenue_leakage.
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 */
public with sharing class SUB001QuantityDriftDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static List<Map<String, Object>> testStubSubs;
    /** Optional: pre-built (accountId::productId) → total Asset quantity. */
    @TestVisible static Map<String, Decimal> testStubAssetQtyByKey;

    public String getDetectorId() { return 'SUB-FOR-001'; }
    public String getLabel() { return 'Subscription quantity drift vs Asset'; }
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
                '  SBQQ__Quantity__c, SBQQ__NetPrice__c ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM SBQQ__Subscription__c ' +
                'WHERE (SBQQ__SubscriptionEndDate__c >= TODAY OR SBQQ__SubscriptionEndDate__c = null) ' +
                'LIMIT 5000';
            try { subs = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] SUB-FOR-001: ' + e.getMessage());
                return results;
            }
        }
        if (subs.isEmpty()) return results;

        // 2. Asset quantities per (Account, Product).
        Map<String, Decimal> assetQty = (testStubAssetQtyByKey != null)
            ? testStubAssetQtyByKey
            : lookupAssetQuantities(ctx, subs);

        // 3. Compare and flag.
        Set<String> seen = new Set<String>();
        for (Map<String, Object> sub : subs) {
            Object aidObj = sub.get('SBQQ__Account__c');
            Object pidObj = sub.get('SBQQ__Product__c');
            if (aidObj == null || pidObj == null) continue;
            String key = String.valueOf(aidObj) + '::' + String.valueOf(pidObj);
            if (seen.contains(key)) continue;
            seen.add(key);

            Decimal aqty = assetQty.get(key);
            if (aqty == null) continue;  // PROV-FOR-002 covers the no-Asset case
            Decimal sqty = (sub.get('SBQQ__Quantity__c') == null)
                ? 0 : (Decimal) sub.get('SBQQ__Quantity__c');
            if (sqty == aqty) continue;
            if (sqty == 0 && aqty == 0) continue;

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
                'subQuantity' => sqty,
                'assetQuantity' => aqty,
                'unitPrice' => sub.get('SBQQ__NetPrice__c'),
                'currencyIsoCode' => CurrencyContext.readFromMap(sub)
            });
            if (r != null) results.add(r);
        }
        return results;
    }

    private static Map<String, Decimal> lookupAssetQuantities(
        DetectorContext ctx, List<Map<String, Object>> subs
    ) {
        Map<String, Decimal> out = new Map<String, Decimal>();
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
            'SELECT AccountId, Product2Id, Quantity FROM Asset ' +
            'WHERE AccountId IN (' + String.join(acctQuoted, ',') + ') ' +
            '  AND Product2Id IN (' + String.join(prodQuoted, ',') + ') ' +
            '  AND Status IN (\'Installed\', \'Active\', \'Purchased\', \'Registered\') ' +
            'LIMIT 50000';
        try {
            for (Map<String, Object> a : OrgQueryService.query(ctx, soql)) {
                Object aid = a.get('AccountId');
                Object pid = a.get('Product2Id');
                Object qty = a.get('Quantity');
                if (aid == null || pid == null) continue;
                String key = String.valueOf(aid) + '::' + String.valueOf(pid);
                Decimal q = (qty == null) ? 0 : (Decimal) qty;
                out.put(key, (out.containsKey(key) ? out.get(key) : 0) + q);
            }
        } catch (Exception e) {}
        return out;
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id subId = (Id) row.get('subscriptionId');
        if (subId == null) return null;

        Decimal sqty = (row.get('subQuantity') == null) ? 0 : (Decimal) row.get('subQuantity');
        Decimal aqty = (row.get('assetQuantity') == null) ? 0 : (Decimal) row.get('assetQuantity');
        if (sqty == aqty) return null;
        if (sqty == 0 && aqty == 0) return null;

        Decimal unitPrice = (row.get('unitPrice') == null) ? 0 : (Decimal) row.get('unitPrice');
        Decimal delta = aqty - sqty;
        Decimal gap = (delta < 0 ? -delta : delta) * unitPrice;
        if (gap < 1) return null;

        String direction = (delta > 0) ? 'under_billed' : 'over_billed';
        String directionLabel = (delta > 0) ? 'under-billed' : 'over-billed';

        String subName = (String) row.get('subscriptionName');
        String productName = (String) row.get('productName');
        if (String.isBlank(productName)) productName = String.valueOf(row.get('productId'));

        String severity = (gap >= 100000) ? 'Critical' : (gap >= 10000 ? 'Warning' : 'Info');

        DetectorResult r = new DetectorResult();
        r.detectorId = 'SUB-FOR-001';
        r.severity = severity;
        r.entitledUsd = aqty * unitPrice;
        r.realizedUsd = sqty * unitPrice;
        r.gapUsd = gap;
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.85;
        r.title = 'Subscription ' + subName + ' ' + directionLabel + ' — billing ' + sqty +
            ' units, customer has ' + aqty + ' (' + gap.setScale(2) + ')';
        Decimal absDelta = (delta < 0) ? -delta : delta;
        if (direction == 'under_billed') {
            r.description = 'Customer is provisioned ' + aqty + ' units of ' + productName +
                ' but only billed for ' + sqty + '. Gap of ' + absDelta + ' units at ' +
                unitPrice.setScale(2) + '/unit = ' + gap.setScale(2) + ' annual leakage.';
        } else {
            r.description = 'Customer is billed for ' + sqty + ' units of ' + productName +
                ' but only has ' + aqty + ' provisioned. Over-billed by ' + absDelta +
                ' units = ' + gap.setScale(2) + ' annual exposure.';
        }
        r.primaryRecord = new SourceRecord('SBQQ__Subscription__c', subId, subName)
            .withFinancial('subscriptionQuantity', sqty)
            .withFinancial('assetQuantity', aqty)
            .withFinancial('quantityDelta', delta)
            .withFinancial('unitNetPrice', unitPrice)
            .withFinancial('direction', direction);
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('productId', row.get('productId'));
        r.metadata.put('productName', productName);
        r.metadata.put('subscriptionQuantity', sqty);
        r.metadata.put('assetQuantity', aqty);
        r.metadata.put('quantityDelta', delta);
        r.metadata.put('unitNetPrice', unitPrice);
        r.metadata.put('direction', direction);
        return r;
    }
}
