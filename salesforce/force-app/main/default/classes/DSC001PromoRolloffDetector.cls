/**
 * DSC-FOR-001 — Promo Discount Roll-off Failure
 *
 * A promotional discount past its expiration is still being applied
 * to an active Quote Line. The price book → discount schedule
 * roll-off didn't fire.
 *
 * Detection:
 *   - Quote Line.SBQQ__Discount__c > 0
 *   - Joined Discount Schedule's effective end date is in the past
 *   - Quote is in Approved or Active status (not Draft)
 *
 * Gap = list × discount% × quantity (the dollars over-discounted).
 */
public with sharing class DSC001PromoRolloffDetector implements IDetector {

    public String getDetectorId() { return 'DSC-FOR-001'; }
    public String getLabel() { return 'Promo Discount Roll-off Failure'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        if (!Schema.getGlobalDescribe().containsKey('SBQQ__QuoteLine__c')) return results;

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

        List<SObject> lines;
        try { lines = Database.query(soql); } catch (Exception e) { return results; }

        for (SObject line : lines) {
            Decimal discount = (Decimal) line.get('SBQQ__Discount__c');
            Decimal listPrice = (Decimal) line.get('SBQQ__ListPrice__c');
            Decimal qty = (Decimal) line.get('SBQQ__Quantity__c');
            if (listPrice == null || discount == null || qty == null) continue;

            Decimal overDiscount = listPrice * (discount / 100) * qty;
            if (overDiscount <= 1) continue;

            DetectorResult r = new DetectorResult();
            r.detectorId = getDetectorId();
            r.severity = (overDiscount > 10000) ? 'Critical' : (overDiscount > 1000 ? 'Warning' : 'Info');
            r.entitledUsd = listPrice * qty;
            r.realizedUsd = (Decimal) line.get('SBQQ__NetPrice__c') * qty;
            r.computeGap();
            r.currencyIsoCode = (String) line.get('CurrencyIsoCode');
            r.recoverabilityScore = 0.6; // some legitimate strategic accounts
            String quoteName = (String) line.getSObject('SBQQ__Quote__r').get('Name');
            String scheduleName = (String) line.getSObject('SBQQ__DiscountSchedule__r').get('Name');
            r.title = 'Expired promo "' + scheduleName + '" still applied on ' + quoteName;
            r.description = 'Discount schedule ended in the past but ' + discount + '% discount still applied. Over-discounting by ' + overDiscount.setScale(2);
            r.primaryRecord = new SourceRecord(
                'SBQQ__QuoteLine__c', (Id) line.get('Id'), (String) line.get('Name')
            ).withFinancial('discount', discount).withFinancial('listPrice', listPrice);
            r.metadata.put('scheduleEndDate', line.getSObject('SBQQ__DiscountSchedule__r').get('SBQQ__EndDate__c'));
            r.metadata.put('scheduleName', scheduleName);
            results.add(r);
        }
        return results;
    }
}
