/**
 * ORD-FOR-001 — Order Activated, No Billing Schedule
 */
public with sharing class ORD001OrderNoBillingDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static List<SObject> testStubSObjects;

    public String getDetectorId() { return 'ORD-FOR-001'; }
    public String getLabel() { return 'Order Activated, No Billing Schedule'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ+Billing', 'ARM' };
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

        List<SObject> orders;
        if (testStubSObjects != null) {
            orders = testStubSObjects;
        } else {
            String soql =
                'SELECT Id, OrderNumber, AccountId, Account.Name, Status, ' +
                '  TotalAmount, ActivatedDate, EffectiveDate, CurrencyIsoCode, ' +
                '  (SELECT Id, Product2Id, Quantity FROM OrderItems LIMIT 100) ' +
                'FROM Order ' +
                'WHERE Status = \'Activated\' ' +
                '  AND ActivatedDate >= LAST_N_MONTHS:24 ' +
                '  AND TotalAmount > 0 ' +
                'LIMIT 5000';
            try { orders = Database.query(soql); } catch (Exception e) { return results; }
        }

        // Bulk-lookup billing schedules. When CPQ Billing isn't installed
        // (the common case in test orgs), the catch returns an empty set
        // and every order qualifies as "no billing schedule".
        Set<Id> orderIds = new Set<Id>();
        for (SObject o : orders) {
            Object idVal = o.getPopulatedFieldsAsMap().get('Id');
            if (idVal != null) orderIds.add((Id) idVal);
        }

        Set<Id> ordersWithBilling = new Set<Id>();
        if (!orderIds.isEmpty()) {
            String billingSoql =
                'SELECT SBCF__OrderItem__r.OrderId FROM SBCF__BillingSchedule__c ' +
                'WHERE SBCF__OrderItem__r.OrderId IN :orderIds LIMIT 50000';
            try {
                for (SObject bs : Database.query(billingSoql)) {
                    Map<String, Object> bsRaw = bs.getPopulatedFieldsAsMap();
                    SObject orderItem = (SObject) bsRaw.get('SBCF__OrderItem__r');
                    if (orderItem != null) {
                        Object oid = orderItem.getPopulatedFieldsAsMap().get('OrderId');
                        if (oid != null) ordersWithBilling.add((Id) oid);
                    }
                }
            } catch (Exception e) {
                // CPQ Billing namespace not installed — every order qualifies.
            }
        }

        for (SObject ord : orders) {
            DetectorResult r = evaluateSObject(ord, ordersWithBilling);
            if (r != null) results.add(r);
        }
        return results;
    }

    @TestVisible
    static DetectorResult evaluateSObject(SObject ord, Set<Id> ordersWithBilling) {
        Map<String, Object> raw = ord.getPopulatedFieldsAsMap();
        Id ordId = (Id) raw.get('Id');
        if (ordId != null && ordersWithBilling.contains(ordId)) return null;
        return evaluateRow(new Map<String, Object>{
            'orderId' => ordId,
            'orderNumber' => raw.get('OrderNumber'),
            'totalAmount' => raw.get('TotalAmount'),
            'currencyIsoCode' => raw.get('CurrencyIsoCode')
        });
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Decimal totalAmount = (Decimal) row.get('totalAmount');
        if (totalAmount == null || totalAmount <= 0) return null;

        DetectorResult r = new DetectorResult();
        r.detectorId = 'ORD-FOR-001';
        r.severity = (totalAmount > 50000) ? 'Critical' : (totalAmount > 5000 ? 'Warning' : 'Info');
        r.entitledUsd = totalAmount;
        r.realizedUsd = 0;
        r.computeGap();
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.95;
        String orderNumber = (String) row.get('orderNumber');
        r.title = 'Order ' + orderNumber + ' activated with no billing schedule';
        r.description = 'Activated order with TotalAmount ' + totalAmount.setScale(2) +
                        ' has no related billing schedule. Customer is not being billed.';
        r.primaryRecord = new SourceRecord(
            'Order', (Id) row.get('orderId'), orderNumber
        ).withFinancial('totalAmount', totalAmount);
        return r;
    }
}
