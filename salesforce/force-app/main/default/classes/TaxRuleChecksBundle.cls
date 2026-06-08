/**
 * Phase 22b-2 — 4 checks on blng__TaxRule__c (+Product2).
 *
 *   TR-001 — Active products → no tax rule (critical)
 *   TR-002 — Active products → inactive tax rule (critical)
 *   TR-003 — Active tax rules not marked Taxable=Yes (warning)
 *   TR-004 — Inactive tax rules cleanup (info)
 */
public with sharing class TaxRuleChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRules;
    @TestVisible static List<Map<String, Object>> testStubProductsAll;
    @TestVisible static List<Map<String, Object>> testStubProductsRefs;

    public String getDetectorId() { return 'TR-BUNDLE'; }
    public String getLabel() { return 'Tax Rule health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ+Billing', 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> rules;
        List<Map<String, Object>> productsAll;
        List<Map<String, Object>> productsRefs;
        if (testStubRules != null || testStubProductsAll != null || testStubProductsRefs != null) {
            rules = (testStubRules != null) ? testStubRules : new List<Map<String, Object>>();
            productsAll = (testStubProductsAll != null) ? testStubProductsAll : new List<Map<String, Object>>();
            productsRefs = (testStubProductsRefs != null) ? testStubProductsRefs : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('blng__TaxRule__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] TR-BUNDLE: blng__TaxRule__c not present.');
                return results;
            }
            try {
                rules = OrgQueryService.query(ctx,
                    'SELECT Id, Name, blng__Active__c, blng__TaxableYesNo__c ' +
                    'FROM blng__TaxRule__c LIMIT 5000');
                // TR-001 needs ALL active products to find ones with null tax rule.
                productsAll = OrgQueryService.query(ctx,
                    'SELECT Id, Name, blng__TaxRule__c FROM Product2 WHERE IsActive = true LIMIT 10000');
                // TR-002 reuses the same list but only those with non-null tax rule.
                productsRefs = new List<Map<String, Object>>();
                for (Map<String, Object> p : productsAll) {
                    if (p.get('blng__TaxRule__c') != null) productsRefs.add(p);
                }
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] TR-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        if (DetectorCatalogController.isActive('TR-001')) results.addAll(evaluateTR001(productsAll));
        if (DetectorCatalogController.isActive('TR-002')) results.addAll(evaluateTR002(rules, productsRefs));
        // TR-003 migrated to CustomDetector__mdt (Phase 24g).
        // if (DetectorCatalogController.isActive('TR-003')) results.addAll(evaluateTR003(rules));
        // TR-004 migrated to CustomDetector__mdt (Phase 24g).
        // Note: mdt path emits one Info per inactive rule (per-record); old Apex emitted a
        // single summary finding with sample names. Intentional Vercel-parity upgrade.
        // if (DetectorCatalogController.isActive('TR-004')) results.addAll(evaluateTR004(rules));
        return results;
    }

    static Boolean isActive(Map<String, Object> r) { return Boolean.valueOf(r.get('blng__Active__c')); }
    static SourceRecord ruleRef(Map<String, Object> r) {
        return new SourceRecord('blng__TaxRule__c', (Id) r.get('Id'), (String) r.get('Name'));
    }
    static SourceRecord prodRef(Map<String, Object> p) {
        return new SourceRecord('Product2', (Id) p.get('Id'), (String) p.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateTR001(List<Map<String, Object>> products) {
        // Phase 24c — emit one finding PER affected product (Vercel parity).
        // Was: 1 summary finding with all bad records in supportingRecords.
        // Now: each product with a null tax rule produces its own finding,
        // so the dashboard severity count reflects the true blast radius.
        List<DetectorResult> results = new List<DetectorResult>();
        String sev = DetectorCatalogController.getSeverity('TR-001', 'Critical');
        for (Map<String, Object> p : products) {
            if (p.get('blng__TaxRule__c') != null) continue;
            SourceRecord sr = prodRef(p);
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'TR-001';
            dr.severity = sev;
            dr.gapUsd = 2000;
            dr.recoverabilityScore = 0.85;
            dr.title = 'Product "' + sr.name + '" missing tax rule';
            dr.description = 'Active product has no tax rule. Tax won\'t be calculated on quote lines or invoices that include it.';
            dr.primaryRecord = sr;
            results.add(dr);
        }
        return results;
    }

    @TestVisible
    static List<DetectorResult> evaluateTR002(List<Map<String, Object>> rules, List<Map<String, Object>> products) {
        Set<Id> inactiveRuleIds = new Set<Id>();
        for (Map<String, Object> r : rules) if (!isActive(r)) inactiveRuleIds.add((Id) r.get('Id'));
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            Object rid = p.get('blng__TaxRule__c');
            if (rid == null || !inactiveRuleIds.contains((Id) rid)) continue;
            bad.add(prodRef(p));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('TR-002', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'TR-002'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + ('Inactive tax rules assigned to active products');
            dr.description = bad.size() + ' active product(s) reference inactive tax rules.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateTR003(List<Map<String, Object>> rules) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            if (String.valueOf(r.get('blng__TaxableYesNo__c')) == 'Yes') continue;
            bad.add(ruleRef(r));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('TR-003', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'TR-003'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + ('Active tax rules not marked as taxable');
            dr.description = bad.size() + ' active tax rule(s) don\'t have Taxable=Yes. Products using these won\'t have tax applied.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateTR004(List<Map<String, Object>> rules) {
        List<Map<String, Object>> inactives = new List<Map<String, Object>>();
        for (Map<String, Object> r : rules) if (!isActive(r)) inactives.add(r);
        if (inactives.isEmpty()) return new List<DetectorResult>();
        List<String> sample = new List<String>();
        Integer sampleCap = Math.min(5, inactives.size());
        for (Integer i = 0; i < sampleCap; i++) sample.add('"' + (String) inactives[i].get('Name') + '"');
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'TR-004'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = inactives.size() + ' inactive tax rule(s)';
        dr.description = inactives.size() + ' tax rule(s) inactive: ' + String.join(sample, ', ') +
            (inactives.size() > 5 ? ' and ' + (inactives.size() - 5) + ' more.' : '.');
        dr.primaryRecord = ruleRef(inactives[0]);
        Integer cap = Math.min(10, inactives.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ruleRef(inactives[i]));
        return new List<DetectorResult>{ dr };
    }
}
