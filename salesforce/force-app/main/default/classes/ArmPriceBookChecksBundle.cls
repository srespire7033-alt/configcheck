/**
 * Phase 22c-2 — Price book checks (2).
 *
 *   ARM-007 — Multiple active custom pricebooks per currency (info)
 *            Gated behind RC sentinel (PriceAdjustmentSchedule OR RateCard)
 *            to avoid false positives on non-ARM CPQ orgs that simply use
 *            multiple custom pricebooks.
 *   ARM-028 — Standard pricebook is inactive (critical) — universal, no gate.
 *
 * ARM-132 (PBE without matching PSMO) deferred to 22c-3 — needs FieldDescribe
 * gate on PricebookEntry.ProductSellingModelId and chunked PBE scanning.
 */
public with sharing class ArmPriceBookChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubPriceBooks;
    @TestVisible static Boolean testStubRcSentinelPresent;

    public String getDetectorId() { return 'ARM-PBOOK-BUNDLE'; }
    public String getLabel() { return 'ARM Price Book checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM', 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> books;
        Boolean rcPresent;
        if (testStubPriceBooks != null || testStubRcSentinelPresent != null) {
            books = testStubPriceBooks != null ? testStubPriceBooks : new List<Map<String, Object>>();
            rcPresent = testStubRcSentinelPresent == null ? false : testStubRcSentinelPresent;
        } else {
            try {
                String soql = SchemaUtil.hasField('Pricebook2', 'CurrencyIsoCode')
                    ? 'SELECT Id, Name, IsActive, IsStandard, CurrencyIsoCode FROM Pricebook2 LIMIT 1000'
                    : 'SELECT Id, Name, IsActive, IsStandard FROM Pricebook2 LIMIT 1000';
                books = OrgQueryService.query(ctx, soql);
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] ARM-PBOOK-BUNDLE: ' + e.getMessage());
                return results;
            }
            rcPresent = SchemaUtil.hasObject('PriceAdjustmentSchedule') || SchemaUtil.hasObject('RateCard');
        }

        if (DetectorCatalogController.isActive('ARM-007') && rcPresent) results.addAll(evaluateARM007(books));
        if (DetectorCatalogController.isActive('ARM-028')) results.addAll(evaluateARM028(books));
        return results;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM007(List<Map<String, Object>> books) {
        Map<String, List<Map<String, Object>>> byCurrency = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> b : books) {
            if (!Boolean.valueOf(b.get('IsActive'))) continue;
            if (Boolean.valueOf(b.get('IsStandard'))) continue;
            String cur = b.containsKey('CurrencyIsoCode') && b.get('CurrencyIsoCode') != null
                ? String.valueOf(b.get('CurrencyIsoCode')) : 'NONE';
            if (!byCurrency.containsKey(cur)) byCurrency.put(cur, new List<Map<String, Object>>());
            byCurrency.get(cur).add(b);
        }
        List<String> currencies = new List<String>();
        List<SourceRecord> books2 = new List<SourceRecord>();
        for (String cur : byCurrency.keySet()) {
            List<Map<String, Object>> grp = byCurrency.get(cur);
            if (grp.size() <= 1) continue;
            currencies.add(cur);
            for (Map<String, Object> b : grp) books2.add(
                new SourceRecord('Pricebook2', (Id) b.get('Id'), cur + ': "' + (String) b.get('Name') + '"'));
        }
        if (currencies.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-007'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = currencies.size() + ' currency/currencies with multiple active price books';
        dr.description = 'Multiple custom price books per currency complicate quoting routing.';
        dr.primaryRecord = books2[0];
        Integer cap = Math.min(10, books2.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(books2[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM028(List<Map<String, Object>> books) {
        for (Map<String, Object> b : books) {
            if (!Boolean.valueOf(b.get('IsStandard'))) continue;
            if (Boolean.valueOf(b.get('IsActive'))) return new List<DetectorResult>();
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-028'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = 'Standard pricebook is inactive';
            dr.description = 'The Standard Pricebook must be Active for opportunity products + many CPQ flows.';
            dr.primaryRecord = new SourceRecord('Pricebook2', (Id) b.get('Id'), (String) b.get('Name'));
            return new List<DetectorResult>{ dr };
        }
        return new List<DetectorResult>();
    }
}
