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
 *   PB-005 — Active product with &gt;5 BlockPrice tiers (proliferation signal)
 *   PB-006 — Product name contains &quot;Renewal Only&quot; / &quot;Legacy&quot; / &quot;Deprecated&quot;
 *           but IsActive=true (soft-retirement-by-naming pattern)
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
    /** Map<productId, blockPriceCount> for PB-005. */
    @TestVisible static Map<Id, Integer> testStubBlockPriceCounts;

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
        // PB-003 migrated to CustomDetector__mdt (Phase 24g).
        // Note: mdt path emits per-record findings (one per active product missing ProductCode);
        // old Apex emitted a single summary finding via buildAggregateResult. Intentional Vercel-parity upgrade.
        // if (DetectorCatalogController.isActive('PB-003')) results.addAll(evaluatePB003(products));
        // PB-004 migrated to CustomDetector__mdt (Phase 24g).
        // Same per-record vs summary behavior change as PB-003.
        // if (DetectorCatalogController.isActive('PB-004')) results.addAll(evaluatePB004(products));
        if (sbqqPresent && DetectorCatalogController.isActive('UA-001')) {
            results.addAll(evaluateUA001(products, usedProductIds));
        }
        if (DetectorCatalogController.isActive('PB-005')) {
            Map<Id, Integer> blockCounts = (testStubBlockPriceCounts != null)
                ? testStubBlockPriceCounts
                : fetchBlockPriceCounts(ctx);
            results.addAll(evaluatePB005(products, blockCounts));
        }
        if (DetectorCatalogController.isActive('PB-006')) {
            results.addAll(evaluatePB006(products));
        }
        return results;
    }

    /** Count SBQQ__BlockPrice__c records per product. Gated on SBQQ surface;
     *  returns empty map on any failure (skips PB-005 cleanly). */
    static Map<Id, Integer> fetchBlockPriceCounts(DetectorContext ctx) {
        Map<Id, Integer> out = new Map<Id, Integer>();
        Boolean present = ctx.isRemote() || SchemaUtil.hasObject('SBQQ__BlockPrice__c');
        if (!present) return out;
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT SBQQ__Product__c pid, COUNT(Id) cnt ' +
                'FROM SBQQ__BlockPrice__c ' +
                'WHERE SBQQ__Product__c != null ' +
                'GROUP BY SBQQ__Product__c');
            for (Map<String, Object> row : rows) {
                Object pid = row.get('pid');
                Object c = row.get('cnt');
                if (pid != null && c != null) out.put((Id) pid, Integer.valueOf(c));
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PB-005 blockCounts: ' + e.getMessage());
        }
        return out;
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

    // PB-005: Active product with >5 SBQQ__BlockPrice__c tiers.
    // PP-46 / PP-180 signature: each block-price tier becomes a separate
    // record in NetSuite (regular + renewal duplication), so 5 tiers → 10
    // NS items per product. Past ~5 tiers, the SF↔NS mapping surface
    // becomes the dominant cause of sync errors.
    @TestVisible
    static List<DetectorResult> evaluatePB005(List<Map<String, Object>> products, Map<Id, Integer> blockCounts) {
        if (blockCounts == null) blockCounts = new Map<Id, Integer>();
        List<SourceRecord> bad = new List<SourceRecord>();
        Integer maxCount = 0;
        String maxName = null;
        for (Map<String, Object> p : products) {
            Id pid = (Id) p.get('Id');
            Integer cnt = blockCounts.containsKey(pid) ? blockCounts.get(pid) : 0;
            if (cnt <= 5) continue;
            bad.add(ref(p));
            if (cnt > maxCount) {
                maxCount = cnt;
                maxName = (String) p.get('Name');
            }
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'PB-005';
        dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning');
        dr.gapUsd = 0;
        dr.recoverabilityScore = 0.6;
        dr.title = bad.size() + ' product(s) with >5 block-price tiers';
        dr.description = bad.size() + ' active Product2 records have more than 5 SBQQ__BlockPrice__c ' +
            'tiers. Worst case: "' + maxName + '" carries ' + maxCount + ' tiers. Each tier ' +
            'typically maps to a separate downstream item (e.g. NetSuite regular + renewal records), ' +
            'so high tier counts explode the SF↔NS mapping surface and drive recurring sync errors. ' +
            'Consider consolidating tiers or moving to formula-based pricing where possible.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(25, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    // PB-006: Product name signals soft retirement ("Renewal Only", "Legacy",
    // "Deprecated", "Do Not Sell") but Product2.IsActive is still true.
    // PP-187 signature: Lexipol soft-retires by prefixing/suffixing the
    // Name rather than flipping a status flag. New deals can still pick
    // up these products via search; amendments on retired SKUs fail at
    // pricebook lookup because the SKU isn't in the current year's book.
    @TestVisible
    static List<DetectorResult> evaluatePB006(List<Map<String, Object>> products) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            String name = (String) p.get('Name');
            if (String.isBlank(name)) continue;
            String lower = name.toLowerCase();
            if (!(lower.contains('renewal only') || lower.contains('legacy')
                    || lower.contains('deprecated') || lower.contains('do not sell')
                    || lower.contains('retired') || lower.contains('obsolete'))) continue;
            bad.add(ref(p));
        }
        DetectorResult dr = buildAggregateResult('PB-006', 'Warning', 0.85,
            'product(s) named as retired but still IsActive=true',
            'Products with names containing "Renewal Only", "Legacy", "Deprecated", ' +
            '"Retired", "Obsolete", or "Do Not Sell" — but Product2.IsActive is still true. ' +
            'Soft-retirement by naming convention lets these SKUs continue to surface in ' +
            'product search and quote builder, causing new deals to attach to products that ' +
            'should not be sold and amendments to fail at pricebook lookup. Flip IsActive=false ' +
            'or formalize a retirement workflow.',
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
