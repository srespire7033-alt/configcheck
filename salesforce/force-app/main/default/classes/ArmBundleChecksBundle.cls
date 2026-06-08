/**
 * Phase 22c-1 — ARM bundle checks (4).
 *
 *   ARM-005 — Bundle product with no components (critical)
 *   ARM-013 — Bundle component min>max (critical)
 *   ARM-014 — Component references inactive child (warning)
 *   ARM-015 — Inactive bundle parent still has components (info)
 */
public with sharing class ArmBundleChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubProducts;
    @TestVisible static List<Map<String, Object>> testStubComponents;

    public String getDetectorId() { return 'ARM-BUNDLE-BUNDLE'; }
    public String getLabel() { return 'ARM Bundle health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> products;
        List<Map<String, Object>> components;
        Boolean usingStubs = (testStubProducts != null || testStubComponents != null);
        if (usingStubs) {
            products   = testStubProducts   != null ? testStubProducts   : new List<Map<String, Object>>();
            components = testStubComponents != null ? testStubComponents : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('ProductRelatedComponent')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] ARM-BUNDLE-BUNDLE: ProductRelatedComponent missing.');
                return results;
            }
            try {
                products = OrgQueryService.query(ctx,
                    'SELECT Id, Name, Family, IsActive FROM Product2 LIMIT 10000');
                components = OrgQueryService.query(ctx,
                    'SELECT Id, ParentProductId, ChildProductId, MinQuantity, MaxQuantity ' +
                    'FROM ProductRelatedComponent LIMIT 10000');
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] ARM-BUNDLE-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        if (DetectorCatalogController.isActive('ARM-005')) results.addAll(evaluateARM005(products, components));
        if (DetectorCatalogController.isActive('ARM-013')) results.addAll(evaluateARM013(components));
        if (DetectorCatalogController.isActive('ARM-014')) results.addAll(evaluateARM014(components, products));
        if (DetectorCatalogController.isActive('ARM-015')) results.addAll(evaluateARM015(components, products));
        return results;
    }

    static SourceRecord prodRef(Map<String, Object> p) {
        return new SourceRecord('Product2', (Id) p.get('Id'), (String) p.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateARM005(List<Map<String, Object>> products, List<Map<String, Object>> components) {
        if (components.isEmpty()) return new List<DetectorResult>();
        Set<Id> hasComponentRelation = new Set<Id>();
        for (Map<String, Object> c : components) {
            Object pp = c.get('ParentProductId'); Object cp = c.get('ChildProductId');
            if (pp != null) hasComponentRelation.add((Id) pp);
            if (cp != null) hasComponentRelation.add((Id) cp);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            if (!Boolean.valueOf(p.get('IsActive'))) continue;
            String nm = (p.get('Name')  == null ? '' : String.valueOf(p.get('Name'))).toLowerCase();
            String fm = (p.get('Family')== null ? '' : String.valueOf(p.get('Family'))).toLowerCase();
            if (!(nm.contains('bundle') || fm.contains('bundle'))) continue;
            if (hasComponentRelation.contains((Id) p.get('Id'))) continue;
            bad.add(prodRef(p));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-005', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-005'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.85;
            dr.title = '"' + dsr.name + '" — ' + (' bundle product(s) with no components');
            dr.description = 'Products named/categorized as bundles have no ProductRelatedComponent rows.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM013(List<Map<String, Object>> components) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> c : components) {
            Object mn = c.get('MinQuantity'); Object mx = c.get('MaxQuantity');
            if (mn == null || mx == null) continue;
            Decimal dn = (Decimal) mn; Decimal dx = (Decimal) mx;
            if (dn <= dx) continue;
            bad.add(new SourceRecord('ProductRelatedComponent', (Id) c.get('Id'),
                'Min ' + dn + ' > Max ' + dx));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-013', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-013'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = '"' + dsr.name + '" — ' + (' bundle component(s) with impossible quantity range');
            dr.description = 'MinQuantity exceeds MaxQuantity. Configuration will fail at runtime.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM014(List<Map<String, Object>> components, List<Map<String, Object>> products) {
        Set<Id> inactives = new Set<Id>();
        for (Map<String, Object> p : products) if (!Boolean.valueOf(p.get('IsActive'))) inactives.add((Id) p.get('Id'));
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> c : components) {
            Object cp = c.get('ChildProductId');
            if (cp == null || !inactives.contains((Id) cp)) continue;
            bad.add(new SourceRecord('ProductRelatedComponent', (Id) c.get('Id'), 'Component'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-014', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-014'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' bundle component(s) reference inactive children');
            dr.description = 'These components point to a deactivated Product2 — the bundle will fail validation.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM015(List<Map<String, Object>> components, List<Map<String, Object>> products) {
        Set<Id> inactives = new Set<Id>();
        for (Map<String, Object> p : products) if (!Boolean.valueOf(p.get('IsActive'))) inactives.add((Id) p.get('Id'));
        Map<Id, Integer> countByParent = new Map<Id, Integer>();
        for (Map<String, Object> c : components) {
            Object pp = c.get('ParentProductId');
            if (pp == null || !inactives.contains((Id) pp)) continue;
            countByParent.put((Id) pp, (countByParent.containsKey((Id) pp) ? countByParent.get((Id) pp) : 0) + 1);
        }
        if (countByParent.isEmpty()) return new List<DetectorResult>();
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Id parentId : countByParent.keySet()) {
            bad.add(new SourceRecord('Product2', parentId, 'Inactive parent (' + countByParent.get(parentId) + ' components)'));
        }
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-015'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = bad.size() + ' inactive bundle parent(s) still have components defined';
        dr.description = 'Cleanup: deactivated parent products still own ProductRelatedComponent rows.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }
}
