/**
 * Phase 22h — Consolidates the five Phase 22a-1 product-hygiene checks
 * (PB-001/002/003/004 + UA-001) from per-affected-record emission
 * to per-check aggregated emission (1 DetectorResult per check, up to
 * 25 supporting records). This brings the cpq smoke finding count
 * closer to Vercel's "1 issue per check_id firing" convention.
 *
 *   PB-001 — Active product with no active PricebookEntry (warning)
 *   PB-002 — Active product without Description (warning)
 *   PB-003 — Active product without ProductCode (warning)
 *   PB-004 — Active product without Family (info)
 *   UA-001 — Active product not on any QuoteLine in last 12 months (info)
 *
 * One Product2 query covers all 5 checks. PricebookEntry is queried
 * separately for PB-001's semi-join; SBQQ__QuoteLine__c separately for
 * UA-001 (gated on SBQQ surface — UA-001 skips on ARM-only orgs).
 *
 * Replaces: PB001..PB004ProductNo*Detector and UA001ProductUnusedDetector.
 */
public with sharing class ProductHygieneChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubProducts;
    @TestVisible static List<Map<String, Object>> testStubPbeProducts;
    @TestVisible static List<Map<String, Object>> testStubUsedProducts;
    @TestVisible static Boolean testStubSbqqPresent;

    public String getDetectorId() { return 'PRODUCT-HYGIENE-BUNDLE'; }
    public String getLabel() { return 'Product hygiene checks (PB-001..004, UA-001)'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing', 'ARM' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> products;
        List<Map<String, Object>> pbeProducts;
        List<Map<String, Object>> usedProducts;
        Boolean sbqqPresent;

        Boolean usingStubs = (testStubProducts != null || testStubPbeProducts != null
            || testStubUsedProducts != null || testStubSbqqPresent != null);

        if (usingStubs) {
            products      = testStubProducts      != null ? testStubProducts      : new List<Map<String, Object>>();
            pbeProducts   = testStubPbeProducts   != null ? testStubPbeProducts   : new List<Map<String, Object>>();
            usedProducts  = testStubUsedProducts  != null ? testStubUsedProducts  : new List<Map<String, Object>>();
            sbqqPresent   = testStubSbqqPresent   == null ? true : testStubSbqqPresent;
        } else {
            try {
                products = OrgQueryService.query(ctx,
                    'SELECT Id, Name, ProductCode, Description, Family ' +
                    'FROM Product2 WHERE IsActive = true LIMIT 10000');
                pbeProducts = OrgQueryService.query(ctx,
                    'SELECT Product2Id FROM PricebookEntry WHERE IsActive = true LIMIT 50000');
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PRODUCT-HYGIENE-BUNDLE: ' + e.getMessage());
                return results;
            }
            sbqqPresent = ctx.isRemote() || SchemaUtil.hasObject('SBQQ__QuoteLine__c');
            usedProducts = new List<Map<String, Object>>();
            if (sbqqPresent) {
                try {
                    usedProducts = OrgQueryService.query(ctx,
                        'SELECT SBQQ__Product__c FROM SBQQ__QuoteLine__c ' +
                        'WHERE CreatedDate = LAST_N_MONTHS:12 AND SBQQ__Product__c != null LIMIT 50000');
                } catch (Exception e) {
                    System.debug(LoggingLevel.INFO, '[OrgPrism] UA-001 quote-line probe failed: ' + e.getMessage());
                    sbqqPresent = false;
                }
            }
        }

        Set<Id> pbeProductIds = new Set<Id>();
        for (Map<String, Object> p : pbeProducts) {
            Object pid = p.get('Product2Id');
            if (pid != null) pbeProductIds.add((Id) pid);
        }
        Set<Id> usedProductIds = new Set<Id>();
        for (Map<String, Object> u : usedProducts) {
            Object pid = u.get('SBQQ__Product__c');
            if (pid != null) usedProductIds.add((Id) pid);
        }

        if (DetectorCatalogController.isActive('PB-001')) results.addAll(evaluatePB001(products, pbeProductIds));
        // PB-002 migrated to CustomDetector__mdt (Phase 24f pilot).
        // Note: the mdt path emits per-record findings (Vercel parity);
        // old Apex emitted one summary finding. Intentional upgrade.
        // if (DetectorCatalogController.isActive('PB-002')) results.addAll(evaluatePB002(products));
        if (DetectorCatalogController.isActive('PB-003')) results.addAll(evaluatePB003(products));
        if (DetectorCatalogController.isActive('PB-004')) results.addAll(evaluatePB004(products));
        if (sbqqPresent && DetectorCatalogController.isActive('UA-001')) {
            results.addAll(evaluateUA001(products, usedProductIds));
        }
        return results;
    }

    static SourceRecord ref(Map<String, Object> p) {
        return new SourceRecord('Product2', (Id) p.get('Id'), (String) p.get('Name'));
    }

    static DetectorResult buildAggregateResult(
        String checkId, String severity, Decimal recScore,
        String title, String description, List<SourceRecord> bad
    ) {
        if (bad.isEmpty()) return null;
        DetectorResult dr = new DetectorResult();
        dr.detectorId = checkId; dr.severity = severity;
        dr.gapUsd = 0; dr.recoverabilityScore = recScore;
        dr.title = bad.size() + ' ' + title;
        dr.description = description.replace('{N}', String.valueOf(bad.size()));
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(25, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return dr;
    }

    @TestVisible
    static List<DetectorResult> evaluatePB001(List<Map<String, Object>> products, Set<Id> pbeProductIds) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            if (pbeProductIds.contains((Id) p.get('Id'))) continue;
            bad.add(ref(p));
        }
        DetectorResult dr = buildAggregateResult('PB-001', 'Warning', 0.8,
            'active product(s) cannot be sold (no PricebookEntry)',
            'Products are active but have no active PricebookEntry — they cannot be added to a quote.',
            bad);
        return dr == null ? new List<DetectorResult>() : new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluatePB002(List<Map<String, Object>> products) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            Object v = p.get('Description');
            if (v != null && !String.isBlank(String.valueOf(v))) continue;
            bad.add(ref(p));
        }
        DetectorResult dr = buildAggregateResult('PB-002', 'Warning', 0.9,
            'active product(s) missing description',
            'Active products without a Description hurt sales discovery and CPQ search.',
            bad);
        return dr == null ? new List<DetectorResult>() : new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluatePB003(List<Map<String, Object>> products) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            Object v = p.get('ProductCode');
            if (v != null && !String.isBlank(String.valueOf(v))) continue;
            bad.add(ref(p));
        }
        DetectorResult dr = buildAggregateResult('PB-003', 'Warning', 0.9,
            'active product(s) missing ProductCode',
            'Active products without a ProductCode block SKU-based integrations and reports.',
            bad);
        return dr == null ? new List<DetectorResult>() : new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluatePB004(List<Map<String, Object>> products) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            Object v = p.get('Family');
            if (v != null && !String.isBlank(String.valueOf(v))) continue;
            bad.add(ref(p));
        }
        DetectorResult dr = buildAggregateResult('PB-004', 'Info', 1.0,
            'active product(s) missing Family',
            'Active products without a Family are harder to roll up in reports.',
            bad);
        return dr == null ? new List<DetectorResult>() : new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateUA001(List<Map<String, Object>> products, Set<Id> usedProductIds) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            if (usedProductIds.contains((Id) p.get('Id'))) continue;
            bad.add(ref(p));
        }
        DetectorResult dr = buildAggregateResult('UA-001', 'Info', 1.0,
            'active product(s) unused in last 12 months',
            'Active products not appearing on any Quote Line in the last 12 months may be candidates for deactivation.',
            bad);
        return dr == null ? new List<DetectorResult>() : new List<DetectorResult>{ dr };
    }
}
