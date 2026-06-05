/**
 * DSC-FOR-002 — Stacked discounts exceed approved cap.
 *
 * Effective discount = (1 - NetPrice/ListPrice) × 100. Anything
 * above the configurable cap (default 50%) is flagged with the
 * $ that should have been collected if the cap had held.
 *
 * Category: revenue_leakage.
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 *
 * Simplification vs TS: skips the describe-probe for optional
 * SBQQ__AdditionalDiscount__c / SBQQ__PartnerDiscount__c columns.
 * Always asks for them; if absent the SOQL fails inside try/catch.
 */
public with sharing class DSC002StackedDiscountsDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static Decimal capPct = 50;

    public String getDetectorId() { return 'DSC-FOR-002'; }
    public String getLabel() { return 'Stacked discounts exceed approved cap'; }
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

        // Schema-presence guard for LOCAL scans only. DSC-FOR-002 depends
        // on optional fields AdditionalDiscount / PartnerDiscount that
        // don't exist in older CPQ versions.
        if (!ctx.isRemote()) {
            if (!SchemaUtil.hasField('SBQQ__QuoteLine__c', 'SBQQ__AdditionalDiscount__c') ||
                !SchemaUtil.hasField('SBQQ__QuoteLine__c', 'SBQQ__PartnerDiscount__c')) {
                System.debug(LoggingLevel.WARN,
                    '[OrgPrism Skip] DSC-FOR-002: SBQQ__QuoteLine__c.SBQQ__AdditionalDiscount__c / SBQQ__PartnerDiscount__c not present in this org\'s CPQ version.');
                return results;
            }
        }

        String soql =
            'SELECT Id, Name, SBQQ__Quote__c, SBQQ__Quote__r.Name, ' +
            '  SBQQ__Quote__r.SBQQ__Account__c, SBQQ__Quote__r.SBQQ__Account__r.Name, ' +
            '  SBQQ__Product__c, SBQQ__Product__r.Name, ' +
            '  SBQQ__ListPrice__c, SBQQ__NetPrice__c, SBQQ__Quantity__c, ' +
            '  SBQQ__Discount__c, SBQQ__AdditionalDiscount__c, SBQQ__PartnerDiscount__c ' +
            CurrencyContext.soqlSelect() + ' ' +
            'FROM SBQQ__QuoteLine__c ' +
            'WHERE SBQQ__ListPrice__c > 0 ' +
            '  AND SBQQ__NetPrice__c > 0 ' +
            '  AND SBQQ__Discount__c > 0 ' +
            '  AND CreatedDate >= LAST_N_MONTHS:12 ' +
            'LIMIT 5000';
        List<Map<String, Object>> rows;
        try { rows = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] DSC-FOR-002: ' + e.getMessage());
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
        Object qObj = raw.get('SBQQ__Quote__r');
        Map<String, Object> quote = (qObj instanceof Map<String, Object>)
            ? (Map<String, Object>) qObj : new Map<String, Object>();
        Object aObj = quote.get('SBQQ__Account__r');
        Map<String, Object> acct = (aObj instanceof Map<String, Object>)
            ? (Map<String, Object>) aObj : new Map<String, Object>();
        Object pObj = raw.get('SBQQ__Product__r');
        Map<String, Object> prod = (pObj instanceof Map<String, Object>)
            ? (Map<String, Object>) pObj : new Map<String, Object>();
        return new Map<String, Object>{
            'lineId' => raw.get('Id'),
            'lineName' => raw.get('Name'),
            'quoteId' => raw.get('SBQQ__Quote__c'),
            'quoteName' => quote.get('Name'),
            'accountId' => quote.get('SBQQ__Account__c'),
            'accountName' => acct.get('Name'),
            'productId' => raw.get('SBQQ__Product__c'),
            'productName' => prod.get('Name'),
            'listPrice' => raw.get('SBQQ__ListPrice__c'),
            'netPrice' => raw.get('SBQQ__NetPrice__c'),
            'qty' => raw.get('SBQQ__Quantity__c'),
            'standardDisc' => raw.get('SBQQ__Discount__c'),
            'additionalDisc' => raw.get('SBQQ__AdditionalDiscount__c'),
            'partnerDisc' => raw.get('SBQQ__PartnerDiscount__c'),
            'currencyIsoCode' => CurrencyContext.readFromMap(raw)
        };
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id lineId = (Id) row.get('lineId');
        if (lineId == null) return null;

        Decimal listPrice = (row.get('listPrice') == null) ? 0 : (Decimal) row.get('listPrice');
        Decimal netPrice = (row.get('netPrice') == null) ? 0 : (Decimal) row.get('netPrice');
        Decimal qty = (row.get('qty') == null) ? 1 : (Decimal) row.get('qty');
        if (listPrice <= 0 || netPrice >= listPrice) return null;

        Decimal effDiscPct = ((listPrice - netPrice) / listPrice) * 100;
        if (effDiscPct <= capPct) return null;

        Decimal cappedNet = listPrice * (1 - capPct / 100);
        Decimal gap = (cappedNet - netPrice) * qty;
        if (gap < 1) return null;

        Decimal standardDisc = (row.get('standardDisc') == null) ? 0 : (Decimal) row.get('standardDisc');
        Decimal additionalDisc = (row.get('additionalDisc') == null) ? 0 : (Decimal) row.get('additionalDisc');
        Decimal partnerDisc = (row.get('partnerDisc') == null) ? 0 : (Decimal) row.get('partnerDisc');

        String lineName = (String) row.get('lineName');
        String productName = (String) row.get('productName');
        if (String.isBlank(productName)) productName = String.valueOf(row.get('productId'));
        String accountName = (String) row.get('accountName');
        if (String.isBlank(accountName)) accountName = 'Account ' + String.valueOf(row.get('accountId'));

        DetectorResult r = new DetectorResult();
        r.detectorId = 'DSC-FOR-002';
        r.severity = (effDiscPct >= 75) ? 'Critical' : 'Warning';
        r.entitledUsd = cappedNet * qty;
        r.realizedUsd = netPrice * qty;
        r.gapUsd = gap;
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.7;
        r.title = 'Quote line ' + lineName + ' discounted ' + effDiscPct.setScale(2) +
            '% — exceeds ' + capPct + '% cap (' + gap.setScale(2) + ')';
        r.description = 'Quote line "' + productName + '" for ' + accountName + ' has effective discount ' +
            effDiscPct.setScale(2) + '%. Sources: standard ' + standardDisc + '%, additional ' + additionalDisc +
            '%, partner ' + partnerDisc + '%. Approval cap of ' + capPct + '% was either not enforced or ' +
            'overridden. If capped, ' + gap.setScale(2) + ' more would have been collected.';
        r.primaryRecord = new SourceRecord('SBQQ__QuoteLine__c', lineId, lineName)
            .withFinancial('listPrice', listPrice)
            .withFinancial('netPrice', netPrice)
            .withFinancial('effectiveDiscountPct', effDiscPct)
            .withFinancial('standardDisc', standardDisc)
            .withFinancial('additionalDisc', additionalDisc)
            .withFinancial('partnerDisc', partnerDisc)
            .withFinancial('quantity', qty);
        r.metadata.put('quoteId', row.get('quoteId'));
        r.metadata.put('accountName', accountName);
        r.metadata.put('productName', productName);
        r.metadata.put('effectiveDiscountPct', effDiscPct);
        r.metadata.put('capPct', capPct);
        return r;
    }
}
