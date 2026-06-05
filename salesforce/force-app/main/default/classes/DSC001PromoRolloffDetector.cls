/**
 * DSC-FOR-001 — Promo Discount Roll-off Failure
 *
 * Pure-map evaluator. See REN001 header for the architecture
 * rationale — no compile-time CPQ namespace dependency.
 */
public with sharing class DSC001PromoRolloffDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'DSC-FOR-001'; }
    public String getLabel() { return 'Promo Discount Roll-off Failure'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        // Pre-flattened test stubs bypass unwrap().
        if (testStubRows != null) {
            for (Map<String, Object> row : testStubRows) {
                DetectorResult r = evaluateRow(row);
                if (r != null) results.add(r);
            }
            return results;
        }

        // Schema-presence guard for LOCAL scans only. Remote scans rely
        // on try/catch since SchemaUtil would describe the host org.
        if (!ctx.isRemote()) {
            if (!SchemaUtil.hasField('SBQQ__DiscountSchedule__c', 'SBQQ__EndDate__c')) {
                System.debug(LoggingLevel.WARN,
                    '[OrgPrism Skip] DSC-FOR-001: SBQQ__DiscountSchedule__c.SBQQ__EndDate__c not present in this org\'s CPQ version.');
                return results;
            }
        }

        List<Map<String, Object>> rows;
        {
            String soql =
                'SELECT Id, Name, SBQQ__Discount__c, SBQQ__ListPrice__c, SBQQ__NetPrice__c, ' +
                '  SBQQ__Quantity__c, SBQQ__Quote__c, SBQQ__Quote__r.Name, ' +
                '  SBQQ__Quote__r.SBQQ__Status__c, ' +
                '  SBQQ__DiscountSchedule__c, SBQQ__DiscountSchedule__r.Name, ' +
                '  SBQQ__DiscountSchedule__r.SBQQ__EndDate__c ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM SBQQ__QuoteLine__c ' +
                'WHERE SBQQ__Discount__c > 0 ' +
                '  AND SBQQ__DiscountSchedule__c != null ' +
                '  AND SBQQ__DiscountSchedule__r.SBQQ__EndDate__c < TODAY ' +
                '  AND SBQQ__Quote__r.SBQQ__Status__c IN (\'Approved\', \'Active\') ' +
                'LIMIT 5000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] DSC-FOR-001: ' + e.getMessage());
                return results;
            }
        }

        for (Map<String, Object> row : rows) {
            DetectorResult r = evaluateRow(unwrap(row));  // raw rows need unwrap
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
        Object sObj = raw.get('SBQQ__DiscountSchedule__r');
        Map<String, Object> sched = (sObj instanceof Map<String, Object>)
            ? (Map<String, Object>) sObj : new Map<String, Object>();
        return new Map<String, Object>{
            'lineId' => raw.get('Id'),
            'lineName' => raw.get('Name'),
            'discount' => raw.get('SBQQ__Discount__c'),
            'listPrice' => raw.get('SBQQ__ListPrice__c'),
            'netPrice' => raw.get('SBQQ__NetPrice__c'),
            'qty' => raw.get('SBQQ__Quantity__c'),
            'quoteName' => quote.get('Name'),
            'scheduleName' => sched.get('Name'),
            'scheduleEndDate' => sched.get('SBQQ__EndDate__c'),
            'currencyIsoCode' => CurrencyContext.readFromMap(raw)
        };
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Decimal discount = (Decimal) row.get('discount');
        Decimal listPrice = (Decimal) row.get('listPrice');
        Decimal qty = (Decimal) row.get('qty');
        if (listPrice == null || discount == null || qty == null) return null;

        Decimal overDiscount = listPrice * (discount / 100) * qty;
        if (overDiscount <= 1) return null;

        Decimal netPrice = (Decimal) row.get('netPrice');
        if (netPrice == null) netPrice = 0;

        DetectorResult r = new DetectorResult();
        r.detectorId = 'DSC-FOR-001';
        r.severity = (overDiscount > 10000) ? 'Critical' : (overDiscount > 1000 ? 'Warning' : 'Info');
        r.entitledUsd = listPrice * qty;
        r.realizedUsd = netPrice * qty;
        r.computeGap();
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.6;
        String quoteName = (String) row.get('quoteName');
        String scheduleName = (String) row.get('scheduleName');
        r.title = 'Expired promo "' + scheduleName + '" still applied on ' + quoteName;
        r.description = 'Discount schedule ended in the past but ' + discount + '% discount still applied. Over-discounting by ' + overDiscount.setScale(2);
        r.primaryRecord = new SourceRecord(
            'SBQQ__QuoteLine__c', (Id) row.get('lineId'), (String) row.get('lineName')
        ).withFinancial('discount', discount).withFinancial('listPrice', listPrice);
        r.metadata.put('scheduleEndDate', row.get('scheduleEndDate'));
        r.metadata.put('scheduleName', scheduleName);
        return r;
    }
}
