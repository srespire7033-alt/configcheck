/**
 * QL-FOR-002 — QuoteLine discount exceeded approval threshold,
 * no approval recorded.
 *
 * Finds the minimum SBQQ__DiscountAmount__c across all active
 * ApprovalRules, then flags QuoteLines whose SBQQ__Discount__c
 * exceeds that threshold but have no SBQQ__Approval__c record.
 *
 * Category: governance (no $ leak claim — audit trail gap).
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 */
public with sharing class QL002ApprovalSkippedDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static Decimal testStubMinThreshold;
    @TestVisible static List<Map<String, Object>> testStubLines;
    @TestVisible static Set<Id> testStubApprovedLineIds;

    public String getDetectorId() { return 'QL-FOR-002'; }
    public String getLabel() { return 'QuoteLine discount exceeded approval threshold, no approval recorded'; }
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

        // 1. Minimum threshold across active approval rules.
        Decimal minThreshold = (testStubMinThreshold != null)
            ? testStubMinThreshold
            : findMinThreshold(ctx);
        if (minThreshold == null) return results;  // no rules → can't run

        // 2. Discounted QuoteLines above threshold.
        List<Map<String, Object>> lines;
        if (testStubLines != null) {
            lines = testStubLines;
        } else {
            String soql =
                'SELECT Id, Name, SBQQ__Quote__c, SBQQ__Quote__r.Name, ' +
                '  SBQQ__Quote__r.SBQQ__Account__r.Name, ' +
                '  SBQQ__Product__c, SBQQ__Product__r.Name, ' +
                '  SBQQ__ListPrice__c, SBQQ__NetPrice__c, ' +
                '  SBQQ__Quantity__c, SBQQ__Discount__c ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM SBQQ__QuoteLine__c ' +
                'WHERE SBQQ__Discount__c >= ' + minThreshold + ' ' +
                '  AND CreatedDate >= LAST_N_MONTHS:12 ' +
                'LIMIT 5000';
            try { lines = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] QL-FOR-002: ' + e.getMessage());
                return results;
            }
        }
        if (lines.isEmpty()) return results;

        // 3. Approvals against these lines.
        Set<Id> approvedLineIds = (testStubApprovedLineIds != null)
            ? testStubApprovedLineIds
            : lookupApprovals(ctx, lines);

        // 4. Emit findings for lines lacking approval.
        for (Map<String, Object> ln : lines) {
            Id lineId = (Id) ln.get('Id');
            if (lineId == null) continue;
            if (approvedLineIds.contains(lineId)) continue;

            Object qObj = ln.get('SBQQ__Quote__r');
            Map<String, Object> quote = (qObj instanceof Map<String, Object>)
                ? (Map<String, Object>) qObj : new Map<String, Object>();
            Object aObj = quote.get('SBQQ__Account__r');
            Map<String, Object> acct = (aObj instanceof Map<String, Object>)
                ? (Map<String, Object>) aObj : new Map<String, Object>();
            Object pObj = ln.get('SBQQ__Product__r');
            Map<String, Object> prod = (pObj instanceof Map<String, Object>)
                ? (Map<String, Object>) pObj : new Map<String, Object>();

            DetectorResult r = evaluateRow(new Map<String, Object>{
                'lineId' => lineId,
                'lineName' => ln.get('Name'),
                'quoteId' => ln.get('SBQQ__Quote__c'),
                'quoteName' => quote.get('Name'),
                'accountName' => acct.get('Name'),
                'productId' => ln.get('SBQQ__Product__c'),
                'productName' => prod.get('Name'),
                'discount' => ln.get('SBQQ__Discount__c'),
                'threshold' => minThreshold,
                'listPrice' => ln.get('SBQQ__ListPrice__c'),
                'netPrice' => ln.get('SBQQ__NetPrice__c'),
                'qty' => ln.get('SBQQ__Quantity__c'),
                'currencyIsoCode' => CurrencyContext.readFromMap(ln)
            });
            if (r != null) results.add(r);
        }
        return results;
    }

    private static Decimal findMinThreshold(DetectorContext ctx) {
        // Older CPQ versions don't expose SBQQ__ApprovalRule__c. Guard
        // locally; remote scans still hit the try/catch fallback.
        if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__ApprovalRule__c')) {
            return null;
        }
        Decimal minT = null;
        String soql =
            'SELECT Id, SBQQ__DiscountAmount__c FROM SBQQ__ApprovalRule__c ' +
            'WHERE SBQQ__Active__c = TRUE AND SBQQ__DiscountAmount__c != null ' +
            'LIMIT 5000';
        try {
            for (Map<String, Object> ar : OrgQueryService.query(ctx, soql)) {
                Object t = ar.get('SBQQ__DiscountAmount__c');
                if (t != null) {
                    Decimal v = (Decimal) t;
                    if (v > 0 && (minT == null || v < minT)) minT = v;
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] QL-FOR-002 (findMinThreshold): ' + e.getMessage());
        }
        return minT;
    }

    private static Set<Id> lookupApprovals(DetectorContext ctx, List<Map<String, Object>> lines) {
        Set<Id> out = new Set<Id>();
        Set<Id> lineIds = new Set<Id>();
        for (Map<String, Object> ln : lines) {
            if (ln.get('Id') != null) lineIds.add((Id) ln.get('Id'));
        }
        if (lineIds.isEmpty()) return out;

        List<String> quoted = new List<String>();
        for (Id lid : lineIds) quoted.add('\'' + String.valueOf(lid) + '\'');
        String soql =
            'SELECT Id, SBQQ__QuoteLine__c FROM SBQQ__Approval__c ' +
            'WHERE SBQQ__QuoteLine__c IN (' + String.join(quoted, ',') + ') ' +
            'LIMIT 50000';
        try {
            for (Map<String, Object> a : OrgQueryService.query(ctx, soql)) {
                Object lid = a.get('SBQQ__QuoteLine__c');
                if (lid != null) out.add((Id) lid);
            }
        } catch (Exception e) {}
        return out;
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id lineId = (Id) row.get('lineId');
        if (lineId == null) return null;

        Decimal discount = (row.get('discount') == null) ? 0 : (Decimal) row.get('discount');
        Decimal threshold = (row.get('threshold') == null) ? 0 : (Decimal) row.get('threshold');
        if (discount < threshold) return null;

        Decimal netPrice = (row.get('netPrice') == null) ? 0 : (Decimal) row.get('netPrice');
        Decimal qty = (row.get('qty') == null) ? 1 : (Decimal) row.get('qty');
        Decimal listPrice = (row.get('listPrice') == null) ? 0 : (Decimal) row.get('listPrice');

        String lineName = (String) row.get('lineName');
        String productName = (String) row.get('productName');
        if (String.isBlank(productName)) productName = 'product';
        String accountName = (String) row.get('accountName');
        if (String.isBlank(accountName)) accountName = 'unknown account';

        String severity = (discount >= 50) ? 'Critical' : 'Warning';

        DetectorResult r = new DetectorResult();
        r.detectorId = 'QL-FOR-002';
        r.severity = severity;
        r.entitledUsd = netPrice * qty;
        r.realizedUsd = netPrice * qty;
        r.gapUsd = 0;  // governance — no $ claim
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.5;
        r.title = 'Quote line ' + lineName + ' given ' + discount + '% discount, no approval recorded';
        r.description = 'Quote line for "' + productName + '" on ' + accountName + ' carries a ' +
            discount + '% discount. Org\'s lowest approval threshold is ' + threshold +
            '% — this discount should have required approval, but no SBQQ__Approval__c record ' +
            'exists for this line. Likely cause: approval rule failed to fire or was overridden.';
        r.primaryRecord = new SourceRecord('SBQQ__QuoteLine__c', lineId, lineName)
            .withFinancial('discountPct', discount)
            .withFinancial('thresholdPct', threshold)
            .withFinancial('listPrice', listPrice)
            .withFinancial('netPrice', netPrice)
            .withFinancial('quantity', qty);
        r.metadata.put('quoteId', row.get('quoteId'));
        r.metadata.put('discountPct', discount);
        r.metadata.put('thresholdPct', threshold);
        r.metadata.put('accountName', accountName);
        r.metadata.put('productName', productName);
        return r;
    }
}
