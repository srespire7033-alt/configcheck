/**
 * DSC-FOR-001 — Promo Discount Roll-off Failure
 */
public with sharing class DSC001PromoRolloffDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static List<SObject> testStubSObjects;

    public String getDetectorId() { return 'DSC-FOR-001'; }
    public String getLabel() { return 'Promo Discount Roll-off Failure'; }
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

        List<SObject> lines;
        if (testStubSObjects != null) {
            lines = testStubSObjects;
        } else {
            String soql =
                'SELECT Id, Name, SBQQ__Discount__c, SBQQ__ListPrice__c, SBQQ__NetPrice__c, ' +
                '  SBQQ__Quantity__c, SBQQ__Quote__c, SBQQ__Quote__r.Name, ' +
                '  SBQQ__Quote__r.SBQQ__Status__c, ' +
                '  SBQQ__DiscountSchedule__c, SBQQ__DiscountSchedule__r.Name, ' +
                '  SBQQ__DiscountSchedule__r.SBQQ__EndDate__c, ' +
                '  CurrencyIsoCode ' +
                'FROM SBQQ__QuoteLine__c ' +
                'WHERE SBQQ__Discount__c > 0 ' +
                '  AND SBQQ__DiscountSchedule__c != null ' +
                '  AND SBQQ__DiscountSchedule__r.SBQQ__EndDate__c < TODAY ' +
                '  AND SBQQ__Quote__r.SBQQ__Status__c IN (\'Approved\', \'Active\') ' +
                'LIMIT 5000';
            try { lines = Database.query(soql); } catch (Exception e) { return results; }
        }

        for (SObject line : lines) {
            DetectorResult r = evaluateSObject(line);
            if (r != null) results.add(r);
        }
        return results;
    }

    @TestVisible
    static DetectorResult evaluateSObject(SObject line) {
        Map<String, Object> raw = line.getPopulatedFieldsAsMap();
        SObject quote = (SObject) raw.get('SBQQ__Quote__r');
        Map<String, Object> quoteRaw = quote != null ? quote.getPopulatedFieldsAsMap() : new Map<String, Object>();
        SObject sched = (SObject) raw.get('SBQQ__DiscountSchedule__r');
        Map<String, Object> schedRaw = sched != null ? sched.getPopulatedFieldsAsMap() : new Map<String, Object>();
        return evaluateRow(new Map<String, Object>{
            'lineId' => raw.get('Id'),
            'lineName' => raw.get('Name'),
            'discount' => raw.get('SBQQ__Discount__c'),
            'listPrice' => raw.get('SBQQ__ListPrice__c'),
            'netPrice' => raw.get('SBQQ__NetPrice__c'),
            'qty' => raw.get('SBQQ__Quantity__c'),
            'quoteName' => quoteRaw.get('Name'),
            'scheduleName' => schedRaw.get('Name'),
            'scheduleEndDate' => schedRaw.get('SBQQ__EndDate__c'),
            'currencyIsoCode' => raw.get('CurrencyIsoCode')
        });
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
