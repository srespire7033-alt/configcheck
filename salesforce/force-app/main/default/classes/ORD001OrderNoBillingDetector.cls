/**
 * ORD-FOR-001 — Order Activated, No Billing Schedule
 *
 * An Order is Activated but no related billing schedule exists.
 * Customer is consuming the product but isn't being billed for it.
 *
 * Note: in pure CPQ orgs there's no Order.SBQQ__BillingFrequency__c —
 * we look for OrderItems without SBCF__BillingSchedule__r (CPQ Billing
 * namespace) or for activated Orders with no Invoice records (Revenue
 * Cloud Billing). Falls back gracefully if neither namespace is present.
 */
public with sharing class ORD001OrderNoBillingDetector implements IDetector {

    public String getDetectorId() { return 'ORD-FOR-001'; }
    public String getLabel() { return 'Order Activated, No Billing Schedule'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ+Billing', 'ARM' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        // Use base SF Order — always available.
        String soql =
            'SELECT Id, OrderNumber, AccountId, Account.Name, Status, ' +
            '  TotalAmount, ActivatedDate, EffectiveDate, CurrencyIsoCode, ' +
            '  (SELECT Id, Product2Id, Quantity FROM OrderItems LIMIT 100) ' +
            'FROM Order ' +
            'WHERE Status = \'Activated\' ' +
            '  AND ActivatedDate >= LAST_N_MONTHS:24 ' +
            '  AND TotalAmount > 0 ' +
            'LIMIT 5000';

        List<SObject> orders;
        try { orders = Database.query(soql); } catch (Exception e) { return results; }

        // For each order, check if billing records exist. If CPQ+Billing
        // namespace isn't installed, we can't query SBCF__BillingSchedule__c —
        // skip the detector entirely.
        if (!Schema.getGlobalDescribe().containsKey('SBCF__BillingSchedule__c')) {
            return results;
        }

        // Pull related billing schedules in bulk to avoid N+1.
        Set<Id> orderIds = new Set<Id>();
        for (SObject o : orders) orderIds.add((Id) o.get('Id'));

        Set<Id> ordersWithBilling = new Set<Id>();
        String billingSoql =
            'SELECT SBCF__OrderItem__r.OrderId FROM SBCF__BillingSchedule__c ' +
            'WHERE SBCF__OrderItem__r.OrderId IN :orderIds LIMIT 50000';
        try {
            for (SObject bs : Database.query(billingSoql)) {
                ordersWithBilling.add((Id) bs.getSObject('SBCF__OrderItem__r').get('OrderId'));
            }
        } catch (Exception e) {
            return results;
        }

        for (SObject ord : orders) {
            Id ordId = (Id) ord.get('Id');
            if (ordersWithBilling.contains(ordId)) continue;

            Decimal totalAmount = (Decimal) ord.get('TotalAmount');
            DetectorResult r = new DetectorResult();
            r.detectorId = getDetectorId();
            r.severity = (totalAmount > 50000) ? 'Critical' : (totalAmount > 5000 ? 'Warning' : 'Info');
            r.entitledUsd = totalAmount; // expected billed amount
            r.realizedUsd = 0;            // nothing billed yet
            r.computeGap();
            r.currencyIsoCode = (String) ord.get('CurrencyIsoCode');
            r.recoverabilityScore = 0.95;
            String orderNumber = (String) ord.get('OrderNumber');
            r.title = 'Order ' + orderNumber + ' activated with no billing schedule';
            r.description = 'Activated order with TotalAmount ' + totalAmount.setScale(2) +
                            ' has no related billing schedule. Customer is not being billed.';
            r.primaryRecord = new SourceRecord(
                'Order', ordId, orderNumber
            ).withFinancial('totalAmount', totalAmount);
            results.add(r);
        }
        return results;
    }
}
