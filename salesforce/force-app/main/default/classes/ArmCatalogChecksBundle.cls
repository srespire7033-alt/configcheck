/**
 * Phase 22c-1 — ARM catalog checks (4).
 *
 *   ARM-001  — Active product without selling model (critical)
 *   ARM-002b — Active product with no pricing path (critical)
 *   ARM-010  — Active product in inactive category (info)
 *   ARM-018  — Active product without category assignment (info)
 *
 * Surface gate: ProductSellingModel must exist (RC Advanced installed).
 */
public with sharing class ArmCatalogChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubProducts;
    @TestVisible static List<Map<String, Object>> testStubPSMOs;
    @TestVisible static List<Map<String, Object>> testStubPBEs;
    @TestVisible static List<Map<String, Object>> testStubCategories;
    @TestVisible static List<Map<String, Object>> testStubCatProducts;

    public String getDetectorId() { return 'ARM-CATALOG-BUNDLE'; }
    public String getLabel() { return 'ARM Catalog health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> products;
        List<Map<String, Object>> psmos;
        List<Map<String, Object>> pbes;
        List<Map<String, Object>> categories;
        List<Map<String, Object>> catProducts;

        Boolean usingStubs = (testStubProducts != null || testStubPSMOs != null
            || testStubPBEs != null || testStubCategories != null || testStubCatProducts != null);

        if (usingStubs) {
            products    = testStubProducts    != null ? testStubProducts    : new List<Map<String, Object>>();
            psmos       = testStubPSMOs       != null ? testStubPSMOs       : new List<Map<String, Object>>();
            pbes        = testStubPBEs        != null ? testStubPBEs        : new List<Map<String, Object>>();
            categories  = testStubCategories  != null ? testStubCategories  : new List<Map<String, Object>>();
            catProducts = testStubCatProducts != null ? testStubCatProducts : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('ProductSellingModel')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] ARM-CATALOG-BUNDLE: ARM not installed.');
                return results;
            }
            // Phase 22j — per-query isolation. Older RC orgs may have
            // ProductSellingModelOption fully absent AND ProductCategory.IsActive
            // missing. A single try/catch around all five queries used to nuke
            // the whole bundle when any one failed. Each query now degrades
            // independently via queryWithFallback so the others still produce
            // findings.
            products = OrgQueryService.queryWithFallback(ctx,
                'SELECT Id, Name, Family FROM Product2 WHERE IsActive = true LIMIT 10000', null);
            psmos = OrgQueryService.queryWithFallback(ctx,
                'SELECT Id, Product2Id, ProductSellingModelId, IsActive FROM ProductSellingModelOption LIMIT 10000',
                'SELECT Id, Product2Id, ProductSellingModelId FROM ProductSellingModelOption LIMIT 10000');
            pbes = OrgQueryService.queryWithFallback(ctx,
                'SELECT Id, Product2Id, IsActive FROM PricebookEntry LIMIT 10000', null);
            // ProductCategory.IsActive only exists on newer RC releases. Loose
            // query drops it; evaluateARM010 below treats missing IsActive as
            // active (cannot detect "active product in inactive category" when
            // we can't see category activity).
            categories = OrgQueryService.queryWithFallback(ctx,
                'SELECT Id, Name, IsActive FROM ProductCategory LIMIT 5000',
                'SELECT Id, Name FROM ProductCategory LIMIT 5000');
            catProducts = OrgQueryService.queryWithFallback(ctx,
                'SELECT Id, ProductId, ProductCategoryId FROM ProductCategoryProduct LIMIT 10000', null);
        }

        if (DetectorCatalogController.isActive('ARM-001'))  results.addAll(evaluateARM001(products, psmos));
        if (DetectorCatalogController.isActive('ARM-002b')) results.addAll(evaluateARM002b(products, pbes));
        if (DetectorCatalogController.isActive('ARM-010'))  results.addAll(evaluateARM010(catProducts, categories, products));
        if (DetectorCatalogController.isActive('ARM-018'))  results.addAll(evaluateARM018(products, catProducts, categories));
        return results;
    }

    static SourceRecord prodRef(Map<String, Object> p) {
        return new SourceRecord('Product2', (Id) p.get('Id'), (String) p.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateARM001(List<Map<String, Object>> products, List<Map<String, Object>> psmos) {
        Set<Id> productsWithModel = new Set<Id>();
        for (Map<String, Object> o : psmos) {
            // Phase 22i — treat missing IsActive (older RC release) as active.
            // Only skip when IsActive is explicitly present and false.
            if (o.containsKey('IsActive') && !Boolean.valueOf(o.get('IsActive'))) continue;
            Object pid = o.get('Product2Id');
            if (pid != null) productsWithModel.add((Id) pid);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            if (!productsWithModel.contains((Id) p.get('Id'))) bad.add(prodRef(p));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-001', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-001'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' active product(s) have no selling model');
            dr.description = 'Sales reps will see configuration or runtime errors when trying to quote these products.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM002b(List<Map<String, Object>> products, List<Map<String, Object>> pbes) {
        Set<Id> productsWithPbe = new Set<Id>();
        for (Map<String, Object> e : pbes) {
            Boolean active = e.get('IsActive') == null ? true : Boolean.valueOf(e.get('IsActive'));
            if (!active) continue;
            Object pid = e.get('Product2Id');
            if (pid != null) productsWithPbe.add((Id) pid);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            if (!productsWithPbe.contains((Id) p.get('Id'))) bad.add(prodRef(p));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-002b', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-002b'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.85;
            dr.title = '"' + dsr.name + '" — ' + (' active product(s) with no pricing path');
            dr.description = 'These products have no active PricebookEntry. They cannot be priced on a quote.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM010(List<Map<String, Object>> catProducts,
                                                List<Map<String, Object>> categories,
                                                List<Map<String, Object>> products) {
        if (catProducts.isEmpty()) return new List<DetectorResult>();
        Set<Id> inactiveCats = new Set<Id>();
        Map<Id, String> catNames = new Map<Id, String>();
        for (Map<String, Object> c : categories) {
            catNames.put((Id) c.get('Id'), (String) c.get('Name'));
            // Phase 22j — only mark inactive when IsActive is explicitly false.
            // Loose-query fallback drops the field on older RC releases; treat
            // missing as active rather than inactive (avoids false positives).
            if (c.containsKey('IsActive') && !Boolean.valueOf(c.get('IsActive'))) {
                inactiveCats.add((Id) c.get('Id'));
            }
        }
        Set<Id> activeProds = new Set<Id>();
        Map<Id, String> prodNames = new Map<Id, String>();
        for (Map<String, Object> p : products) {
            activeProds.add((Id) p.get('Id'));
            prodNames.put((Id) p.get('Id'), (String) p.get('Name'));
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> cp : catProducts) {
            Object pid = cp.get('ProductId'); Object cid = cp.get('ProductCategoryId');
            if (pid == null || cid == null) continue;
            if (!activeProds.contains((Id) pid)) continue;
            if (!inactiveCats.contains((Id) cid)) continue;
            String label = (prodNames.containsKey((Id) pid) ? prodNames.get((Id) pid) : 'Product')
                + ' → ' + (catNames.containsKey((Id) cid) ? catNames.get((Id) cid) : 'Category');
            bad.add(new SourceRecord('ProductCategoryProduct', (Id) cp.get('Id'), label));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-010', 'Info');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-010'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
            dr.title = '"' + dsr.name + '" — ' + (' active product(s) in inactive categor(ies)');
            dr.description = 'Active products are assigned to inactive product categories.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM018(List<Map<String, Object>> products,
                                                List<Map<String, Object>> catProducts,
                                                List<Map<String, Object>> categories) {
        if (categories.isEmpty() && catProducts.isEmpty()) return new List<DetectorResult>();
        Set<Id> assigned = new Set<Id>();
        for (Map<String, Object> cp : catProducts) {
            Object pid = cp.get('ProductId'); if (pid != null) assigned.add((Id) pid);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            if (!assigned.contains((Id) p.get('Id'))) bad.add(prodRef(p));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-018', 'Info');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-018'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
            dr.title = '"' + dsr.name + '" — ' + (' active product(s) without category assignment');
            dr.description = 'Products without categories are harder to discover and report on.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }
}
