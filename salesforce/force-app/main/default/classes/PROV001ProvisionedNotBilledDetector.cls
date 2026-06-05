/**
 * PROV-FOR-001 — Provisioned but not billed.
 *
 * Asset.Status='Installed' (customer has the product) but NO active
 * SBQQ__Subscription__c exists for the same Account+Product.
 * Customer consuming a product they're not being charged for.
 *
 * Category: revenue_leakage. Gap = annualized Asset value (Price ×
 * Quantity if Asset.Price > 0; else PricebookEntry standard price ×
 * Quantity). If neither available, the asset is skipped (info-only
 * with $0 gap isn't worth a finding).
 *
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 */
public with sharing class PROV001ProvisionedNotBilledDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    /** Raw Asset shape stubs — drives full pipeline including billing
     *  lookup and Pricebook fallback (those queries get skipped when
     *  the override map below is provided). */
    @TestVisible static List<Map<String, Object>> testStubAssets;
    /** Optional: pre-built (accountId::productId) → true map. When set,
     *  skips the subscription lookup. */
    @TestVisible static Set<String> testStubBilledKeys;
    /** Optional: pre-built productId → standard PricebookEntry unit price. */
    @TestVisible static Map<Id, Decimal> testStubPbePrices;

    public String getDetectorId() { return 'PROV-FOR-001'; }
    public String getLabel() { return 'Asset provisioned, no active subscription'; }
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

        // 1. Installed Assets in 24-month window.
        List<Map<String, Object>> assets;
        if (testStubAssets != null) {
            assets = testStubAssets;
        } else {
            String soql =
                'SELECT Id, Name, AccountId, Product2Id, Product2.Name, Quantity, Price, ' +
                '  Status, InstallDate ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM Asset ' +
                'WHERE Status IN (\'Installed\', \'Active\', \'Purchased\', \'Registered\') ' +
                '  AND (InstallDate >= LAST_N_MONTHS:24 OR InstallDate = null) ' +
                'LIMIT 5000';
            try { assets = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PROV-FOR-001: ' + e.getMessage());
                return results;
            }
        }
        if (assets.isEmpty()) return results;

        // 2. (Account, Product) keys that DO have an active Subscription.
        Set<String> billedKeys = (testStubBilledKeys != null)
            ? testStubBilledKeys
            : lookupBilledKeys(ctx, assets);

        // 3. Pricebook fallback for assets with no Price.
        Set<Id> needsPriceLookup = new Set<Id>();
        for (Map<String, Object> a : assets) {
            Object priceObj = a.get('Price');
            Decimal price = (priceObj == null) ? 0 : (Decimal) priceObj;
            Object prodObj = a.get('Product2Id');
            if (price <= 0 && prodObj != null) needsPriceLookup.add((Id) prodObj);
        }
        Map<Id, Decimal> pbePrices = (testStubPbePrices != null)
            ? testStubPbePrices
            : lookupPbeFallback(ctx, needsPriceLookup);

        // 4. Build findings.
        for (Map<String, Object> a : assets) {
            Object aidObj = a.get('AccountId');
            Object pidObj = a.get('Product2Id');
            if (aidObj == null || pidObj == null) continue;
            String key = String.valueOf(aidObj) + '::' + String.valueOf(pidObj);
            if (billedKeys.contains(key)) continue;

            Object prodMap = a.get('Product2');
            Map<String, Object> prod = (prodMap instanceof Map<String, Object>)
                ? (Map<String, Object>) prodMap : new Map<String, Object>();

            Decimal price = (a.get('Price') == null) ? 0 : (Decimal) a.get('Price');
            if (price <= 0) {
                Decimal pbe = pbePrices.get((Id) pidObj);
                if (pbe != null) price = pbe;
            }
            DetectorResult r = evaluateRow(new Map<String, Object>{
                'assetId' => a.get('Id'),
                'assetName' => a.get('Name'),
                'accountId' => aidObj,
                'productId' => pidObj,
                'productName' => prod.get('Name'),
                'quantity' => a.get('Quantity'),
                'unitPrice' => price,
                'installDate' => a.get('InstallDate'),
                'status' => a.get('Status'),
                'priceSource' => ((a.get('Price') != null && (Decimal) a.get('Price') > 0)
                    ? 'asset' : 'pricebook_fallback'),
                'currencyIsoCode' => CurrencyContext.readFromMap(a)
            });
            if (r != null) results.add(r);
        }
        return results;
    }

    private static Set<String> lookupBilledKeys(DetectorContext ctx, List<Map<String, Object>> assets) {
        Set<String> out = new Set<String>();
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
            'SELECT SBQQ__Account__c, SBQQ__Product__c ' +
            'FROM SBQQ__Subscription__c ' +
            'WHERE SBQQ__Account__c IN (' + String.join(acctQuoted, ',') + ') ' +
            '  AND SBQQ__Product__c IN (' + String.join(prodQuoted, ',') + ') ' +
            '  AND (SBQQ__SubscriptionEndDate__c >= TODAY OR SBQQ__SubscriptionEndDate__c = null) ' +
            'LIMIT 50000';
        try {
            for (Map<String, Object> s : OrgQueryService.query(ctx, soql)) {
                Object aid = s.get('SBQQ__Account__c');
                Object pid = s.get('SBQQ__Product__c');
                if (aid != null && pid != null) {
                    out.add(String.valueOf(aid) + '::' + String.valueOf(pid));
                }
            }
        } catch (Exception e) {
            // SBQQ not installed → no billed keys → every Asset flags.
        }
        return out;
    }

    private static Map<Id, Decimal> lookupPbeFallback(DetectorContext ctx, Set<Id> productIds) {
        Map<Id, Decimal> out = new Map<Id, Decimal>();
        if (productIds.isEmpty()) return out;

        // Standard Pricebook lookup.
        Id stdPbId = null;
        try {
            List<Map<String, Object>> stdPb = OrgQueryService.query(ctx,
                'SELECT Id FROM Pricebook2 WHERE IsStandard = TRUE LIMIT 1');
            if (!stdPb.isEmpty()) stdPbId = (Id) stdPb[0].get('Id');
        } catch (Exception e) { return out; }
        if (stdPbId == null) return out;

        List<String> prodQuoted = new List<String>();
        for (Id pid : productIds) prodQuoted.add('\'' + String.valueOf(pid) + '\'');
        String soql =
            'SELECT Product2Id, UnitPrice FROM PricebookEntry ' +
            'WHERE Pricebook2Id = \'' + String.valueOf(stdPbId) + '\' ' +
            '  AND IsActive = TRUE ' +
            '  AND Product2Id IN (' + String.join(prodQuoted, ',') + ') ' +
            'LIMIT 5000';
        try {
            for (Map<String, Object> p : OrgQueryService.query(ctx, soql)) {
                Object pid = p.get('Product2Id');
                Object price = p.get('UnitPrice');
                if (pid != null && price != null) {
                    out.put((Id) pid, (Decimal) price);
                }
            }
        } catch (Exception e) {}
        return out;
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id assetId = (Id) row.get('assetId');
        if (assetId == null) return null;

        Decimal qty = (row.get('quantity') == null) ? 1 : (Decimal) row.get('quantity');
        Decimal unitPrice = (row.get('unitPrice') == null) ? 0 : (Decimal) row.get('unitPrice');
        Decimal annualGap = unitPrice * qty;
        if (annualGap < 1) return null;

        String assetName = (String) row.get('assetName');
        String productName = (String) row.get('productName');
        if (String.isBlank(productName)) productName = String.valueOf(row.get('productId'));

        Object instObj = row.get('installDate');
        Date installDate = toDate(instObj);
        Integer daysInstalled = (installDate == null) ? 0 : installDate.daysBetween(Date.today());

        String severity = (annualGap >= 100000) ? 'Critical' : (annualGap >= 10000 ? 'Warning' : 'Info');

        DetectorResult r = new DetectorResult();
        r.detectorId = 'PROV-FOR-001';
        r.severity = severity;
        r.entitledUsd = annualGap;
        r.realizedUsd = 0;
        r.gapUsd = annualGap;
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.85;
        r.title = 'Asset ' + assetName + ' provisioned, no active subscription (' +
            annualGap.setScale(2) + '/yr)';
        r.description = (daysInstalled > 0
            ? 'Asset installed ' + daysInstalled + ' days ago for '
            : 'Asset installed for ') + qty + '× ' + productName +
            ', but no active Subscription billing this product for this Account. ' +
            annualGap.setScale(2) + ' of annual revenue is unbilled.';
        r.primaryRecord = new SourceRecord('Asset', assetId, assetName)
            .withFinancial('quantity', qty)
            .withFinancial('unitPrice', unitPrice)
            .withFinancial('installDate', installDate)
            .withFinancial('status', row.get('status'));
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('productId', row.get('productId'));
        r.metadata.put('productName', productName);
        r.metadata.put('quantity', qty);
        r.metadata.put('unitPrice', unitPrice);
        r.metadata.put('installDate', installDate);
        r.metadata.put('daysInstalled', daysInstalled);
        r.metadata.put('priceSource', row.get('priceSource'));
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
