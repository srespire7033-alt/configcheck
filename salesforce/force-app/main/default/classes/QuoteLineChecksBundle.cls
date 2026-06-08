/**
 * Phase 22a-6 — 5 checks on SBQQ__QuoteLine__c.
 *
 *   QL-001 — Zero NetPrice on positive Qty with positive ListPrice (critical)
 *   QL-002 — NetTotal calculation mismatch (critical)
 *   QL-003 — Negative NetTotal (warning)
 *   QL-004 — >50% effective discount (info)
 *   TF-001 — Both Discount + AdditionalDiscount populated; both Uplift + UpliftAmount (warning, up to 2 findings)
 *
 * Single SOQL serves all 5 checks.
 */
public with sharing class QuoteLineChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'QL-BUNDLE'; }
    public String getLabel() { return 'Quote Line health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__QuoteLine__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] QL-BUNDLE: SBQQ__QuoteLine__c not present.');
                return results;
            }
            Boolean hasUplift = SchemaUtil.hasField('SBQQ__QuoteLine__c', 'SBQQ__Uplift__c');
            Boolean hasUpliftAmt = SchemaUtil.hasField('SBQQ__QuoteLine__c', 'SBQQ__UpliftAmount__c');
            Boolean hasAddDisc = SchemaUtil.hasField('SBQQ__QuoteLine__c', 'SBQQ__AdditionalDiscount__c');
            String soql = 'SELECT Id, Name, SBQQ__NetPrice__c, SBQQ__ListPrice__c, ' +
                'SBQQ__Quantity__c, SBQQ__NetTotal__c, SBQQ__Discount__c, ' +
                'SBQQ__Quote__c, SBQQ__Product__c, SBQQ__Product__r.Name' +
                (hasAddDisc ? ', SBQQ__AdditionalDiscount__c' : '') +
                (hasUplift ? ', SBQQ__Uplift__c' : '') +
                (hasUpliftAmt ? ', SBQQ__UpliftAmount__c' : '') +
                ' FROM SBQQ__QuoteLine__c LIMIT 10000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] QL-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        Boolean runQL001 = DetectorCatalogController.isActive('QL-001');
        Boolean runQL002 = DetectorCatalogController.isActive('QL-002');
        Boolean runQL003 = DetectorCatalogController.isActive('QL-003');
        Boolean runQL004 = DetectorCatalogController.isActive('QL-004');
        Boolean runTF001 = DetectorCatalogController.isActive('TF-001');

        // QL-001 migrated to CustomDetector__mdt (Phase 24h).
        // if (runQL001) results.addAll(evaluateQL001(rows));
        if (runQL002) results.addAll(evaluateQL002(rows));
        if (runQL003) results.addAll(evaluateQL003(rows));
        if (runQL004) results.addAll(evaluateQL004(rows));
        if (runTF001) results.addAll(evaluateTF001(rows));
        return results;
    }

    static Decimal num(Map<String, Object> r, String key) {
        Object v = r.get(key);
        return (v == null) ? null : Decimal.valueOf(String.valueOf(v));
    }
    static SourceRecord ref(Map<String, Object> r) {
        return new SourceRecord('SBQQ__QuoteLine__c', (Id) r.get('Id'), (String) r.get('Name'));
    }
    static String productName(Map<String, Object> r) {
        Object o = r.get('SBQQ__Product__r');
        if (o != null && o instanceof Map<String, Object>) {
            Object n = ((Map<String, Object>) o).get('Name');
            if (n != null) return String.valueOf(n);
        }
        return 'Unknown';
    }

    @TestVisible
    static List<DetectorResult> evaluateQL001(List<Map<String, Object>> rows) {
        List<Map<String, Object>> bad = new List<Map<String, Object>>();
        Set<Id> quoteIds = new Set<Id>();
        for (Map<String, Object> r : rows) {
            Decimal qty = num(r, 'SBQQ__Quantity__c');
            Decimal np = num(r, 'SBQQ__NetPrice__c');
            Decimal lp = num(r, 'SBQQ__ListPrice__c');
            if (qty == null || qty <= 0) continue;
            if (lp == null || lp <= 0) continue;
            if (np != null && np > 0) continue;
            bad.add(r);
            Object qid = r.get('SBQQ__Quote__c');
            if (qid != null) quoteIds.add((Id) qid);
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'QL-001'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' quote line(s) with zero NetPrice';
        dr.description = bad.size() + ' quote line(s) across ' + quoteIds.size() +
            ' quote(s) have Quantity > 0 and ListPrice > 0 but NetPrice = $0. Likely revenue leakage from misconfigured price rules.';
        dr.primaryRecord = ref(bad[0]);
        Integer cap = Math.min(50, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(bad[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateQL002(List<Map<String, Object>> rows) {
        List<Map<String, Object>> bad = new List<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            Decimal np = num(r, 'SBQQ__NetPrice__c');
            Decimal qty = num(r, 'SBQQ__Quantity__c');
            Decimal nt = num(r, 'SBQQ__NetTotal__c');
            if (np == null || qty == null || nt == null) continue;
            Decimal expected = np * qty;
            Decimal diff = (nt - expected).abs();
            if (diff <= 1) continue;
            if (expected == 0) continue;
            if (diff / expected.abs() <= 0.01) continue;
            bad.add(r);
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        Map<String, Object> ex = bad[0];
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'QL-002'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.85;
        dr.title = bad.size() + ' quote line(s) with calculation mismatch';
        dr.description = 'NetTotal does not equal NetPrice × Quantity on ' + bad.size() + ' line(s). Example: "' +
            productName(ex) + '" has NetPrice ' + num(ex, 'SBQQ__NetPrice__c') + ' × Qty ' +
            num(ex, 'SBQQ__Quantity__c') + ' but NetTotal shows ' + num(ex, 'SBQQ__NetTotal__c') + '.';
        dr.primaryRecord = ref(bad[0]);
        Integer cap = Math.min(10, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(bad[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateQL003(List<Map<String, Object>> rows) {
        List<Map<String, Object>> bad = new List<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            Decimal nt = num(r, 'SBQQ__NetTotal__c');
            if (nt != null && nt < 0) bad.add(r);
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'QL-003'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.8;
        dr.title = bad.size() + ' quote line(s) with negative totals';
        dr.description = bad.size() + ' quote lines have negative NetTotal values. May indicate credits or over-discounting.';
        dr.primaryRecord = ref(bad[0]);
        Integer cap = Math.min(10, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(bad[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateQL004(List<Map<String, Object>> rows) {
        List<Map<String, Object>> bad = new List<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            Decimal lp = num(r, 'SBQQ__ListPrice__c');
            Decimal np = num(r, 'SBQQ__NetPrice__c');
            if (lp == null || lp <= 0 || np == null) continue;
            Decimal pct = (1 - (np / lp)) * 100;
            if (pct <= 50) continue;
            bad.add(r);
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'QL-004'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' quote line(s) with >50% discount';
        dr.description = bad.size() + ' quote line(s) have an effective discount exceeding 50% of list price.';
        dr.primaryRecord = ref(bad[0]);
        Integer cap = Math.min(10, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(bad[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateTF001(List<Map<String, Object>> rows) {
        List<DetectorResult> out = new List<DetectorResult>();
        List<Map<String, Object>> discountConflicts = new List<Map<String, Object>>();
        List<Map<String, Object>> upliftConflicts = new List<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            Decimal d = num(r, 'SBQQ__Discount__c');
            Decimal ad = r.containsKey('SBQQ__AdditionalDiscount__c') ? num(r, 'SBQQ__AdditionalDiscount__c') : null;
            if (d != null && d != 0 && ad != null && ad != 0) discountConflicts.add(r);
            Decimal u = r.containsKey('SBQQ__Uplift__c') ? num(r, 'SBQQ__Uplift__c') : null;
            Decimal ua = r.containsKey('SBQQ__UpliftAmount__c') ? num(r, 'SBQQ__UpliftAmount__c') : null;
            if (u != null && u != 0 && ua != null && ua != 0) upliftConflicts.add(r);
        }
        if (!discountConflicts.isEmpty()) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'TF-001'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = discountConflicts.size() * 50;
            dr.recoverabilityScore = 0.85;
            dr.title = discountConflicts.size() + ' quote line(s) have both Discount and Additional Discount set';
            dr.description = 'Both SBQQ__Discount__c and SBQQ__AdditionalDiscount__c populated on ' + discountConflicts.size() +
                ' line(s). Compounding discounts may produce lower final prices than intended.';
            dr.primaryRecord = ref(discountConflicts[0]);
            Integer cap = Math.min(20, discountConflicts.size());
            for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(discountConflicts[i]));
            out.add(dr);
        }
        if (!upliftConflicts.isEmpty()) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'TF-001'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.85;
            dr.title = upliftConflicts.size() + ' quote line(s) have both Uplift % and Uplift Amount set';
            dr.description = 'Both percentage and flat uplift populated on ' + upliftConflicts.size() +
                ' line(s). Renewal pricing may be inflated.';
            dr.primaryRecord = ref(upliftConflicts[0]);
            Integer cap = Math.min(20, upliftConflicts.size());
            for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(upliftConflicts[i]));
            out.add(dr);
        }
        return out;
    }
}
