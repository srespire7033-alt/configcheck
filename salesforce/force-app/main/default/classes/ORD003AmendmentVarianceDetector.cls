/**
 * ORD-FOR-003 — Quote Net Total ≠ Order Total (amendment).
 *
 * Same logic as ORD-FOR-002 but for amendment Quotes (Type='Amendment').
 * Amendment math is harder — net delta should equal the *change* in
 * recurring revenue, not the absolute quote total. v1 uses the same
 * comparison: SUM(amendment-order totals) vs Quote NetAmount.
 *
 * Category: revenue_leakage.
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 *
 * Simplifications vs TS: shares the simpler ORD-002 model. The TS
 * version had additional logic for proration and co-term math that
 * adds complexity without proportional value at v1. Refine when
 * customers report false positives.
 */
public with sharing class ORD003AmendmentVarianceDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static List<Map<String, Object>> testStubOrders;
    private static final Decimal TOLERANCE = 0.01;

    public String getDetectorId() { return 'ORD-FOR-003'; }
    public String getLabel() { return 'Quote Net Total != Order Total (amendment)'; }
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

        List<Map<String, Object>> orders;
        if (testStubOrders != null) {
            orders = testStubOrders;
        } else {
            String soql =
                'SELECT Id, OrderNumber, TotalAmount, AccountId, EffectiveDate, Status, ' +
                '  SBQQ__Quote__c, SBQQ__Quote__r.Id, SBQQ__Quote__r.Name, ' +
                '  SBQQ__Quote__r.SBQQ__NetAmount__c, SBQQ__Quote__r.SBQQ__Type__c, ' +
                '  SBQQ__Quote__r.SBQQ__Account__c ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM Order ' +
                'WHERE Status = \'Activated\' ' +
                '  AND SBQQ__Quote__c != null ' +
                '  AND EffectiveDate >= LAST_N_MONTHS:12 ' +
                'LIMIT 5000';
            try { orders = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] ORD-FOR-003: ' + e.getMessage());
                return results;
            }
        }
        if (orders.isEmpty()) return results;

        // Filter to amendment quotes only.
        Map<Id, Map<String, Object>> byQuote = new Map<Id, Map<String, Object>>();
        for (Map<String, Object> ord : orders) {
            Object qrefObj = ord.get('SBQQ__Quote__c');
            if (qrefObj == null) continue;
            Id quoteId = (Id) qrefObj;

            Object qObj = ord.get('SBQQ__Quote__r');
            Map<String, Object> quote = (qObj instanceof Map<String, Object>)
                ? (Map<String, Object>) qObj : new Map<String, Object>();
            String qType = (String) quote.get('SBQQ__Type__c');
            if (qType != 'Amendment') continue;

            Map<String, Object> agg = byQuote.get(quoteId);
            if (agg == null) {
                agg = new Map<String, Object>{
                    'quoteId' => quoteId,
                    'quoteName' => quote.get('Name'),
                    'quoteNetAmount' => quote.get('SBQQ__NetAmount__c'),
                    'accountId' => quote.get('SBQQ__Account__c'),
                    'orderIds' => new List<Id>(),
                    'orderNumbers' => new List<String>(),
                    'orderTotal' => Decimal.valueOf(0),
                    'currencyIsoCode' => CurrencyContext.readFromMap(ord)
                };
                byQuote.put(quoteId, agg);
            }
            ((List<Id>) agg.get('orderIds')).add((Id) ord.get('Id'));
            ((List<String>) agg.get('orderNumbers')).add((String) ord.get('OrderNumber'));
            Decimal total = (ord.get('TotalAmount') == null) ? 0 : (Decimal) ord.get('TotalAmount');
            agg.put('orderTotal', ((Decimal) agg.get('orderTotal')) + total);
        }

        for (Id qId : byQuote.keySet()) {
            DetectorResult r = evaluateRow(byQuote.get(qId));
            if (r != null) results.add(r);
        }
        return results;
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id quoteId = (Id) row.get('quoteId');
        if (quoteId == null) return null;

        Decimal quoteNet = (row.get('quoteNetAmount') == null) ? 0 : (Decimal) row.get('quoteNetAmount');
        Decimal orderTotal = (row.get('orderTotal') == null) ? 0 : (Decimal) row.get('orderTotal');
        Decimal delta = orderTotal - quoteNet;
        Decimal absDelta = (delta < 0) ? -delta : delta;
        if (absDelta <= TOLERANCE) return null;

        String direction = (delta > 0) ? 'over_billed' : 'under_billed';
        String directionLabel = (delta > 0) ? 'over-billed' : 'under-billed';

        String quoteName = (String) row.get('quoteName');
        List<String> orderNumbers = (List<String>) row.get('orderNumbers');
        List<Id> orderIds = (List<Id>) row.get('orderIds');

        String severity;
        if (absDelta >= 50000) severity = 'Critical';
        else if (absDelta >= 5000) severity = 'Warning';
        else severity = 'Info';

        DetectorResult r = new DetectorResult();
        r.detectorId = 'ORD-FOR-003';
        r.severity = severity;
        r.entitledUsd = quoteNet;
        r.realizedUsd = orderTotal;
        r.gapUsd = absDelta;
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.65;  // amendments slightly harder to recover than new biz
        String orderSummary = orderNumbers.size() == 1
            ? 'Order ' + orderNumbers[0]
            : orderNumbers.size() + ' orders';
        r.title = 'Amendment Quote ' + quoteName + ' ' + directionLabel +
            ' — sum of ' + orderSummary + ' = ' + orderTotal.setScale(2) +
            ' vs Quote total ' + quoteNet.setScale(2) + ' (' + absDelta.setScale(2) + ' delta)';
        r.description = 'CPQ Amendment Quote "' + quoteName + '" was approved at ' + quoteNet.setScale(2) +
            ' but the resulting ' + orderSummary + ' totalled ' + orderTotal.setScale(2) +
            '. ' + (direction == 'over_billed'
                ? 'Customer being billed ' + absDelta.setScale(2) + ' more than approved.'
                : 'Customer being billed ' + absDelta.setScale(2) + ' less than approved (revenue leak).') +
            ' Amendments are especially error-prone: proration math, co-term offsets, ' +
            'and existing-subscription credits all factor in. Verify by comparing Quote Lines ' +
            'to the Order Items they should have created.';
        r.primaryRecord = new SourceRecord('SBQQ__Quote__c', quoteId, quoteName)
            .withFinancial('quoteNetAmount', quoteNet)
            .withFinancial('orderTotal', orderTotal)
            .withFinancial('delta', delta)
            .withFinancial('direction', direction)
            .withFinancial('orderCount', orderNumbers.size());
        r.metadata.put('accountId', row.get('accountId'));
        r.metadata.put('orderIds', orderIds);
        r.metadata.put('orderNumbers', orderNumbers);
        r.metadata.put('quoteNetAmount', quoteNet);
        r.metadata.put('orderTotal', orderTotal);
        r.metadata.put('delta', delta);
        r.metadata.put('direction', direction);
        return r;
    }
}
