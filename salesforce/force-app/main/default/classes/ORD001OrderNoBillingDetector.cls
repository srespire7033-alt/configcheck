/**
 * ORD-FOR-001 — Order Activated, No Billing Schedule
 *
 * Pure-map evaluator. See REN001 header for the architecture
 * rationale — no compile-time CPQ/Billing namespace dependency.
 *
 * Two queries: (1) Orders, (2) billing schedules to filter out
 * orders that DO have billing. The billing query is wrapped in
 * try/catch — if the target org doesn't have CPQ Billing, every
 * activated order qualifies as "no billing schedule" (which is
 * correct).
 */
public with sharing class ORD001OrderNoBillingDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    /** Drives the SOQL-result iteration path without real Order data.
     *  Each map should use raw Salesforce field names (Id, OrderNumber,
     *  TotalAmount, CurrencyIsoCode (conditional)). The billing-schedule lookup is
     *  skipped when this stub is set. */
    @TestVisible static List<Map<String, Object>> testStubOrders;

    public String getDetectorId() { return 'ORD-FOR-001'; }
    public String getLabel() { return 'Order Activated, No Billing Schedule'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ+Billing', 'ARM' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        // Short-circuit stub path — used by unit tests to drive evaluateRow.
        if (testStubRows != null) {
            for (Map<String, Object> row : testStubRows) {
                DetectorResult r = evaluateRow(row);
                if (r != null) results.add(r);
            }
            return results;
        }

        List<Map<String, Object>> orders;
        if (testStubOrders != null) {
            orders = testStubOrders;
        } else {
        String soql =
            'SELECT Id, OrderNumber, AccountId, Account.Name, Status, ' +
            '  TotalAmount, ActivatedDate, EffectiveDate' +
            CurrencyContext.soqlSelect() + ', ' +
            '  (SELECT Id, Product2Id, Quantity FROM OrderItems LIMIT 100) ' +
            'FROM Order ' +
            'WHERE Status = \'Activated\' ' +
            '  AND ActivatedDate >= LAST_N_MONTHS:24 ' +
            '  AND TotalAmount > 0 ' +
            'LIMIT 5000';
        try { orders = OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] ORD-FOR-001: ' + e.getMessage());
            return results;
        }
        }

        Set<Id> orderIds = new Set<Id>();
        for (Map<String, Object> o : orders) {
            Object idVal = o.get('Id');
            if (idVal != null) orderIds.add((Id) idVal);
        }

        Set<Id> ordersWithBilling = new Set<Id>();
        if (!orderIds.isEmpty()) {
            List<String> quoted = new List<String>();
            for (Id oid : orderIds) quoted.add('\'' + String.valueOf(oid) + '\'');
            String billingSoql =
                'SELECT SBCF__OrderItem__r.OrderId FROM SBCF__BillingSchedule__c ' +
                'WHERE SBCF__OrderItem__r.OrderId IN (' + String.join(quoted, ',') + ') LIMIT 50000';
            try {
                for (Map<String, Object> bs : OrgQueryService.query(ctx, billingSoql)) {
                    Object oi = bs.get('SBCF__OrderItem__r');
                    if (oi instanceof Map<String, Object>) {
                        Object oid = ((Map<String, Object>) oi).get('OrderId');
                        if (oid != null) ordersWithBilling.add((Id) oid);
                    }
                }
            } catch (Exception e) {
                // CPQ Billing namespace not installed on the target — every
                // order qualifies as having no schedule.
            }
        }

        for (Map<String, Object> ord : orders) {
            Id ordId = (Id) ord.get('Id');
            if (ordId != null && ordersWithBilling.contains(ordId)) continue;
            DetectorResult r = evaluateRow(new Map<String, Object>{
                'orderId' => ordId,
                'orderNumber' => ord.get('OrderNumber'),
                'totalAmount' => ord.get('TotalAmount'),
                'currencyIsoCode' => CurrencyContext.readFromMap(ord)
            });
            if (r != null) results.add(r);
        }
        return results;
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
