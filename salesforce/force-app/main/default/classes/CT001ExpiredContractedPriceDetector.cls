/**
 * CT-FOR-001 — Contracted Price expired but still applied.
 *
 * QuoteLine references SBQQ__ContractedPrice__c whose expiration is
 * in the past. Customer locked into stale pricing below current list.
 *
 * Gap = (currentList - lockedPrice) × quantity.
 *
 * Category: revenue_leakage.
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 */
public with sharing class CT001ExpiredContractedPriceDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static List<Map<String, Object>> testStubLines;
    @TestVisible static Map<Id, Map<String, Object>> testStubCpById;
    @TestVisible static Map<Id, Decimal> testStubPbeByProduct;

    public String getDetectorId() { return 'CT-FOR-001'; }
    public String getLabel() { return 'Contracted Price expired but still applied'; }
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

        // 1. QuoteLines referencing any ContractedPrice.
        List<Map<String, Object>> lines;
        if (testStubLines != null) {
            lines = testStubLines;
        } else {
            String soql =
                'SELECT Id, Name, SBQQ__Quote__c, SBQQ__Quote__r.Name, ' +
                '  SBQQ__ContractedPrice__c, SBQQ__Product__c, SBQQ__Product__r.Name, ' +
                '  SBQQ__ListPrice__c, SBQQ__NetPrice__c, SBQQ__Quantity__c ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM SBQQ__QuoteLine__c ' +
                'WHERE SBQQ__ContractedPrice__c != null ' +
                '  AND CreatedDate >= LAST_N_MONTHS:12 ' +
                'LIMIT 5000';
            try { lines = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] CT-FOR-001: ' + e.getMessage());
                return results;
            }
        }
        if (lines.isEmpty()) return results;

        // 2. Lookup referenced ContractedPrice records + their expiration.
        Map<Id, Map<String, Object>> cpById = (testStubCpById != null)
            ? testStubCpById
            : lookupContractedPrices(ctx, lines);

        // 3. Current Pricebook list per Product.
        Map<Id, Decimal> pbeByProduct = (testStubPbeByProduct != null)
            ? testStubPbeByProduct
            : lookupCurrentList(ctx, lines);

        // 4. Per-line evaluation.
        for (Map<String, Object> ln : lines) {
            Object cpRefObj = ln.get('SBQQ__ContractedPrice__c');
            if (cpRefObj == null) continue;
            Id cpId = (Id) cpRefObj;
            Map<String, Object> cp = cpById.get(cpId);
            if (cp == null) continue;
            Date expiration = toDate(cp.get('SBQQ__ExpirationDate__c'));
            if (expiration == null) continue;
            if (expiration >= Date.today()) continue;

            Decimal lockedPrice = (cp.get('SBQQ__Price__c') == null) ? 0 : (Decimal) cp.get('SBQQ__Price__c');
            Object prodObj = ln.get('SBQQ__Product__c');
            Decimal currentList = 0;
            if (prodObj != null) {
                Decimal v = pbeByProduct.get((Id) prodObj);
                if (v != null) currentList = v;
            }
            if (currentList <= lockedPrice) continue;
            Decimal qty = (ln.get('SBQQ__Quantity__c') == null) ? 1 : (Decimal) ln.get('SBQQ__Quantity__c');
            Decimal gap = (currentList - lockedPrice) * qty;
            if (gap < 1) continue;

            Object prodMap = ln.get('SBQQ__Product__r');
            Map<String, Object> prod = (prodMap instanceof Map<String, Object>)
                ? (Map<String, Object>) prodMap : new Map<String, Object>();

            DetectorResult r = evaluateRow(new Map<String, Object>{
                'lineId' => ln.get('Id'),
                'lineName' => ln.get('Name'),
                'quoteId' => ln.get('SBQQ__Quote__c'),
                'contractedPriceId' => cpId,
                'contractedPriceName' => cp.get('Name'),
                'productName' => prod.get('Name'),
                'lockedPrice' => lockedPrice,
                'currentList' => currentList,
                'quantity' => qty,
                'expiration' => expiration,
                'currencyIsoCode' => CurrencyContext.readFromMap(ln)
            });
            if (r != null) results.add(r);
        }
        return results;
    }

    private static Map<Id, Map<String, Object>> lookupContractedPrices(
        DetectorContext ctx, List<Map<String, Object>> lines
    ) {
        Map<Id, Map<String, Object>> out = new Map<Id, Map<String, Object>>();
        Set<Id> ids = new Set<Id>();
        for (Map<String, Object> ln : lines) {
            Object cp = ln.get('SBQQ__ContractedPrice__c');
            if (cp != null) ids.add((Id) cp);
        }
        if (ids.isEmpty()) return out;
        List<String> quoted = new List<String>();
        for (Id id : ids) quoted.add('\'' + String.valueOf(id) + '\'');
        String soql =
            'SELECT Id, Name, SBQQ__Account__c, SBQQ__Product__c, SBQQ__Price__c, ' +
            '  SBQQ__EffectiveDate__c, SBQQ__ExpirationDate__c ' +
            'FROM SBQQ__ContractedPrice__c ' +
            'WHERE Id IN (' + String.join(quoted, ',') + ') LIMIT 5000';
        try {
            for (Map<String, Object> cp : OrgQueryService.query(ctx, soql)) {
                Object id = cp.get('Id');
                if (id != null) out.put((Id) id, cp);
            }
        } catch (Exception e) {}
        return out;
    }

    private static Map<Id, Decimal> lookupCurrentList(
        DetectorContext ctx, List<Map<String, Object>> lines
    ) {
        Map<Id, Decimal> out = new Map<Id, Decimal>();
        Set<Id> prodIds = new Set<Id>();
        for (Map<String, Object> ln : lines) {
            Object p = ln.get('SBQQ__Product__c');
            if (p != null) prodIds.add((Id) p);
        }
        if (prodIds.isEmpty()) return out;
        List<String> quoted = new List<String>();
        for (Id pid : prodIds) quoted.add('\'' + String.valueOf(pid) + '\'');
        String soql =
            'SELECT Product2Id, UnitPrice FROM PricebookEntry ' +
            'WHERE Product2Id IN (' + String.join(quoted, ',') + ') ' +
            '  AND Pricebook2.IsStandard = TRUE ' +
            '  AND IsActive = TRUE ' +
            'LIMIT 5000';
        try {
            for (Map<String, Object> p : OrgQueryService.query(ctx, soql)) {
                Object id = p.get('Product2Id');
                Object price = p.get('UnitPrice');
                if (id != null && price != null) out.put((Id) id, (Decimal) price);
            }
        } catch (Exception e) {}
        return out;
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id lineId = (Id) row.get('lineId');
        if (lineId == null) return null;

        Decimal lockedPrice = (row.get('lockedPrice') == null) ? 0 : (Decimal) row.get('lockedPrice');
        Decimal currentList = (row.get('currentList') == null) ? 0 : (Decimal) row.get('currentList');
        Decimal qty = (row.get('quantity') == null) ? 1 : (Decimal) row.get('quantity');
        if (currentList <= lockedPrice) return null;
        Decimal gap = (currentList - lockedPrice) * qty;
        if (gap < 1) return null;

        Date expiration = toDate(row.get('expiration'));
        Integer daysExpired = (expiration == null) ? 0 : expiration.daysBetween(Date.today());
        if (daysExpired < 0) daysExpired = 0;

        String severity = (gap >= 50000) ? 'Critical' : (gap >= 5000 ? 'Warning' : 'Info');
        String lineName = (String) row.get('lineName');
        String productName = (String) row.get('productName');
        if (String.isBlank(productName)) productName = 'product';
        String cpName = (String) row.get('contractedPriceName');
        if (String.isBlank(cpName)) cpName = String.valueOf(row.get('contractedPriceId'));

        DetectorResult r = new DetectorResult();
        r.detectorId = 'CT-FOR-001';
        r.severity = severity;
        r.entitledUsd = currentList * qty;
        r.realizedUsd = lockedPrice * qty;
        r.gapUsd = gap;
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.8;
        r.title = 'Quote line ' + lineName + ' locked to expired contracted price (' +
            gap.setScale(2) + ' below current list)';
        r.description = 'Quote line for ' + productName + ' references Contracted Price "' + cpName +
            '" which expired ' + daysExpired + ' days ago. Locked at ' + lockedPrice.setScale(2) +
            '/unit vs current list ' + currentList.setScale(2) + '/unit. ' + gap.setScale(2) +
            ' of margin foregone on this line alone.';
        r.primaryRecord = new SourceRecord('SBQQ__QuoteLine__c', lineId, lineName)
            .withFinancial('lockedPrice', lockedPrice)
            .withFinancial('currentList', currentList)
            .withFinancial('quantity', qty)
            .withFinancial('daysExpired', daysExpired);
        r.metadata.put('contractedPriceId', row.get('contractedPriceId'));
        r.metadata.put('expiration', expiration);
        r.metadata.put('lockedPrice', lockedPrice);
        r.metadata.put('currentList', currentList);
        r.metadata.put('daysExpired', daysExpired);
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
