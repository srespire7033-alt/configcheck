/**
 * MDQ-FOR-001 — MDQ segment pricing inconsistency.
 *
 * Multi-year MDQ subscriptions with Year-2/Year-3 segments priced
 * flat vs Year-1 (no compound YoY uplift). Expected:
 *   Year-N net = Year-1 net × (1 + upliftPct/100)^N
 *
 * Default uplift = 5%. Anything below expected by > $1 is flagged.
 *
 * Category: revenue_leakage.
 * Pure-map evaluator — no compile-time CPQ namespace dependency.
 */
public with sharing class MDQ001SegmentPricingDetector implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    @TestVisible static List<Map<String, Object>> testStubLines;
    private static final Decimal DEFAULT_UPLIFT_PCT = 5;

    public String getDetectorId() { return 'MDQ-FOR-001'; }
    public String getLabel() { return 'MDQ segment Year-N priced flat vs Year-1 (no uplift)'; }
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

        // Pull all segmented lines (SegmentIndex IS NOT NULL).
        List<Map<String, Object>> lines;
        if (testStubLines != null) {
            lines = testStubLines;
        } else {
            String soql =
                'SELECT Id, Name, SBQQ__Quote__c, SBQQ__Product__c, SBQQ__Product__r.Name, ' +
                '  SBQQ__NetPrice__c, SBQQ__Quantity__c, SBQQ__SegmentIndex__c ' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM SBQQ__QuoteLine__c ' +
                'WHERE SBQQ__SegmentIndex__c != null ' +
                '  AND CreatedDate >= LAST_N_MONTHS:12 ' +
                'LIMIT 10000';
            try { lines = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] MDQ-FOR-001: ' + e.getMessage());
                return results;
            }
        }
        if (lines.isEmpty()) return results;

        // Group by (Quote, Product).
        Map<String, List<Map<String, Object>>> groups = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> ln : lines) {
            String key = String.valueOf(ln.get('SBQQ__Quote__c')) + '::' + String.valueOf(ln.get('SBQQ__Product__c'));
            if (!groups.containsKey(key)) groups.put(key, new List<Map<String, Object>>());
            groups.get(key).add(ln);
        }

        for (String key : groups.keySet()) {
            List<Map<String, Object>> segs = sortBySegmentIndex(groups.get(key));
            if (segs.size() < 2) continue;

            Map<String, Object> year1 = segs[0];
            Decimal year1Net = (year1.get('SBQQ__NetPrice__c') == null) ? 0 : (Decimal) year1.get('SBQQ__NetPrice__c');
            if (year1Net <= 0) continue;

            Decimal upliftFraction = DEFAULT_UPLIFT_PCT / 100;
            Decimal totalGap = 0;
            List<Map<String, Object>> flaggedSegs = new List<Map<String, Object>>();

            for (Integer i = 1; i < segs.size(); i++) {
                Map<String, Object> seg = segs[i];
                Decimal segIdx = (seg.get('SBQQ__SegmentIndex__c') == null) ? i : (Decimal) seg.get('SBQQ__SegmentIndex__c');
                Decimal segQty = (seg.get('SBQQ__Quantity__c') == null) ? 1 : (Decimal) seg.get('SBQQ__Quantity__c');
                Double base = 1.0d + upliftFraction.doubleValue();
                Double expFactor = Math.pow(base, segIdx.doubleValue());
                Decimal expectedUnit = year1Net * Decimal.valueOf(expFactor);
                Decimal actualUnit = (seg.get('SBQQ__NetPrice__c') == null) ? 0 : (Decimal) seg.get('SBQQ__NetPrice__c');
                Decimal segGap = (expectedUnit - actualUnit) * segQty;
                if (segGap > 1) {
                    totalGap += segGap;
                    flaggedSegs.add(new Map<String, Object>{
                        'segment' => segIdx,
                        'expected' => expectedUnit,
                        'actual' => actualUnit,
                        'gap' => segGap
                    });
                }
            }
            if (flaggedSegs.isEmpty()) continue;

            Object prodObj = year1.get('SBQQ__Product__r');
            Map<String, Object> prod = (prodObj instanceof Map<String, Object>)
                ? (Map<String, Object>) prodObj : new Map<String, Object>();
            String productName = (String) prod.get('Name');
            if (String.isBlank(productName)) productName = String.valueOf(year1.get('SBQQ__Product__c'));

            DetectorResult r = evaluateRow(new Map<String, Object>{
                'year1Id' => year1.get('Id'),
                'year1Name' => year1.get('Name'),
                'year1Net' => year1Net,
                'year1Qty' => year1.get('SBQQ__Quantity__c'),
                'quoteId' => year1.get('SBQQ__Quote__c'),
                'productId' => year1.get('SBQQ__Product__c'),
                'productName' => productName,
                'segmentCount' => segs.size(),
                'flaggedSegs' => flaggedSegs,
                'totalGap' => totalGap,
                'currencyIsoCode' => CurrencyContext.readFromMap(year1)
            });
            if (r != null) results.add(r);
        }
        return results;
    }

    private static List<Map<String, Object>> sortBySegmentIndex(List<Map<String, Object>> segs) {
        // Apex List doesn't support custom comparators directly without
        // wrapping. Easier: simple selection sort by SegmentIndex.
        Integer n = segs.size();
        List<Map<String, Object>> out = new List<Map<String, Object>>(segs);
        for (Integer i = 0; i < n - 1; i++) {
            Integer minIdx = i;
            Decimal minVal = (out[i].get('SBQQ__SegmentIndex__c') == null) ? 0 : (Decimal) out[i].get('SBQQ__SegmentIndex__c');
            for (Integer j = i + 1; j < n; j++) {
                Decimal v = (out[j].get('SBQQ__SegmentIndex__c') == null) ? 0 : (Decimal) out[j].get('SBQQ__SegmentIndex__c');
                if (v < minVal) { minVal = v; minIdx = j; }
            }
            if (minIdx != i) {
                Map<String, Object> tmp = out[i];
                out[i] = out[minIdx];
                out[minIdx] = tmp;
            }
        }
        return out;
    }

    @TestVisible
    static DetectorResult evaluateRow(Map<String, Object> row) {
        Id year1Id = (Id) row.get('year1Id');
        if (year1Id == null) return null;

        Decimal totalGap = (row.get('totalGap') == null) ? 0 : (Decimal) row.get('totalGap');
        if (totalGap < 1) return null;
        Decimal year1Net = (row.get('year1Net') == null) ? 0 : (Decimal) row.get('year1Net');

        Integer segmentCount = (row.get('segmentCount') == null) ? 0 : (Integer) row.get('segmentCount');
        String productName = (String) row.get('productName');
        if (String.isBlank(productName)) productName = 'product';
        String severity = (totalGap >= 50000) ? 'Critical' : (totalGap >= 5000 ? 'Warning' : 'Info');

        DetectorResult r = new DetectorResult();
        r.detectorId = 'MDQ-FOR-001';
        r.severity = severity;
        r.entitledUsd = year1Net + totalGap;
        r.realizedUsd = year1Net;
        r.gapUsd = totalGap;
        r.currencyIsoCode = (String) row.get('currencyIsoCode');
        r.recoverabilityScore = 0.7;
        r.title = 'MDQ multi-year ' + productName + ' priced flat across ' + segmentCount +
            ' segments (' + totalGap.setScale(2) + ' uplift gap)';
        r.description = 'Multi-year segmented quote for ' + productName + '. Year 1 priced at ' +
            year1Net.setScale(2) + '/unit. Expected ' + DEFAULT_UPLIFT_PCT +
            '% YoY uplift not applied. Total uplift forgone: ' + totalGap.setScale(2) + '.';
        r.primaryRecord = new SourceRecord('SBQQ__QuoteLine__c', year1Id, (String) row.get('year1Name'))
            .withFinancial('year1NetPrice', year1Net)
            .withFinancial('year1Quantity', row.get('year1Qty'))
            .withFinancial('expectedUpliftPct', DEFAULT_UPLIFT_PCT)
            .withFinancial('flaggedSegments', ((List<Map<String, Object>>) row.get('flaggedSegs')).size());
        r.metadata.put('quoteId', row.get('quoteId'));
        r.metadata.put('productName', productName);
        r.metadata.put('segmentCount', segmentCount);
        r.metadata.put('year1Net', year1Net);
        r.metadata.put('flaggedSegs', row.get('flaggedSegs'));
        return r;
    }
}
