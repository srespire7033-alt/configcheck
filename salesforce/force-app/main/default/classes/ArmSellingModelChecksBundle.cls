/**
 * Phase 22c-1 — ARM selling-model checks (5).
 *
 *   ARM-002 — Recurring selling model without billing frequency (critical)
 *   ARM-011 — Term selling model without pricing term (warning)
 *   ARM-012 — Active option referencing inactive selling model (warning)
 *   ARM-019 — Duplicate selling model options (warning)
 *   ARM-133 — Draft selling model referenced by active records (warning)
 */
public with sharing class ArmSellingModelChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubModels;
    @TestVisible static List<Map<String, Object>> testStubPSMOs;
    @TestVisible static List<Map<String, Object>> testStubPBEs;

    public String getDetectorId() { return 'ARM-PSM-BUNDLE'; }
    public String getLabel() { return 'ARM Selling Model checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> models;
        List<Map<String, Object>> psmos;
        List<Map<String, Object>> pbes;

        Boolean usingStubs = (testStubModels != null || testStubPSMOs != null || testStubPBEs != null);
        if (usingStubs) {
            models = testStubModels != null ? testStubModels : new List<Map<String, Object>>();
            psmos  = testStubPSMOs  != null ? testStubPSMOs  : new List<Map<String, Object>>();
            pbes   = testStubPBEs   != null ? testStubPBEs   : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('ProductSellingModel')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] ARM-PSM-BUNDLE: ARM not installed.');
                return results;
            }
            try {
                String statusField = SchemaUtil.hasField('ProductSellingModel', 'Status') ? ', Status' : '';
                String freqField = SchemaUtil.hasField('ProductSellingModel', 'SellingFrequencyId')
                    ? ', SellingFrequencyId' : '';
                String pricingTermField = SchemaUtil.hasField('ProductSellingModel', 'PricingTerm')
                    ? ', PricingTerm' : '';
                models = OrgQueryService.query(ctx,
                    'SELECT Id, Name, SellingModelType, IsActive' + freqField + pricingTermField + statusField +
                    ' FROM ProductSellingModel LIMIT 5000');
                // Phase 22i — PSMO.IsActive missing on older RC releases.
                psmos = OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Product2Id, ProductSellingModelId, IsActive FROM ProductSellingModelOption LIMIT 10000',
                    'SELECT Id, Product2Id, ProductSellingModelId FROM ProductSellingModelOption LIMIT 10000');
                pbes = OrgQueryService.query(ctx,
                    SchemaUtil.hasField('PricebookEntry', 'ProductSellingModelId')
                        ? 'SELECT Id, ProductSellingModelId, IsActive FROM PricebookEntry WHERE ProductSellingModelId != null LIMIT 10000'
                        : 'SELECT Id FROM PricebookEntry LIMIT 1');
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] ARM-PSM-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        if (DetectorCatalogController.isActive('ARM-002')) results.addAll(evaluateARM002(models));
        if (DetectorCatalogController.isActive('ARM-011')) results.addAll(evaluateARM011(models));
        if (DetectorCatalogController.isActive('ARM-012')) results.addAll(evaluateARM012(models, psmos));
        if (DetectorCatalogController.isActive('ARM-019')) results.addAll(evaluateARM019(psmos));
        if (DetectorCatalogController.isActive('ARM-133')) results.addAll(evaluateARM133(models, psmos, pbes));
        return results;
    }

    static Boolean isActive(Map<String, Object> m) { return Boolean.valueOf(m.get('IsActive')); }
    static String typeOf(Map<String, Object> m) {
        Object o = m.get('SellingModelType');
        return o == null ? '' : String.valueOf(o).toLowerCase();
    }
    static SourceRecord modelRef(Map<String, Object> m) {
        return new SourceRecord('ProductSellingModel', (Id) m.get('Id'), (String) m.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateARM002(List<Map<String, Object>> models) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> m : models) {
            if (!isActive(m)) continue;
            String t = typeOf(m);
            if (!(t.contains('term') || t.contains('evergreen'))) continue;
            if (m.get('SellingFrequencyId') != null) continue;
            bad.add(modelRef(m));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-002'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' recurring selling model(s) missing billing frequency';
        dr.description = 'Term/Evergreen selling models require SellingFrequencyId for billing schedule generation.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM011(List<Map<String, Object>> models) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> m : models) {
            if (!isActive(m)) continue;
            if (!typeOf(m).contains('term')) continue;
            Object pt = m.get('PricingTerm');
            Decimal v = pt == null ? null : (Decimal) pt;
            if (v != null && v > 0) continue;
            bad.add(modelRef(m));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-011'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' term selling model(s) missing pricing term';
        dr.description = 'PricingTerm is required to calculate proration on term-based selling models.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM012(List<Map<String, Object>> models, List<Map<String, Object>> psmos) {
        Set<Id> inactiveModelIds = new Set<Id>();
        Map<Id, String> modelNameById = new Map<Id, String>();
        for (Map<String, Object> m : models) {
            modelNameById.put((Id) m.get('Id'), (String) m.get('Name'));
            if (!isActive(m)) inactiveModelIds.add((Id) m.get('Id'));
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> o : psmos) {
            if (o.containsKey('IsActive') && !Boolean.valueOf(o.get('IsActive'))) continue; // 22i
            Object mid = o.get('ProductSellingModelId');
            if (mid == null || !inactiveModelIds.contains((Id) mid)) continue;
            String label = 'Option → ' + (modelNameById.containsKey((Id) mid) ? modelNameById.get((Id) mid) : 'model') + ' (inactive)';
            bad.add(new SourceRecord('ProductSellingModelOption', (Id) o.get('Id'), label));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-012'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' active option(s) point at an inactive selling model';
        dr.description = 'Quoting these options will fail because their selling model is deactivated.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM019(List<Map<String, Object>> psmos) {
        Map<String, List<Map<String, Object>>> byKey = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> o : psmos) {
            if (o.containsKey('IsActive') && !Boolean.valueOf(o.get('IsActive'))) continue; // 22i
            Object pid = o.get('Product2Id'); Object mid = o.get('ProductSellingModelId');
            if (pid == null || mid == null) continue;
            String k = String.valueOf(pid) + '|' + String.valueOf(mid);
            if (!byKey.containsKey(k)) byKey.put(k, new List<Map<String, Object>>());
            byKey.get(k).add(o);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (String k : byKey.keySet()) {
            List<Map<String, Object>> grp = byKey.get(k);
            if (grp.size() <= 1) continue;
            for (Map<String, Object> o : grp) {
                bad.add(new SourceRecord('ProductSellingModelOption', (Id) o.get('Id'), 'Duplicate option'));
            }
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-019'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = bad.size() + ' duplicate selling-model option record(s)';
        dr.description = 'Multiple active options exist for the same (Product, SellingModel) pair.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(25, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM133(List<Map<String, Object>> models,
                                                List<Map<String, Object>> psmos,
                                                List<Map<String, Object>> pbes) {
        Set<Id> draftIds = new Set<Id>();
        Map<Id, String> nameById = new Map<Id, String>();
        for (Map<String, Object> m : models) {
            nameById.put((Id) m.get('Id'), (String) m.get('Name'));
            Object st = m.get('Status');
            if (st != null && String.valueOf(st) == 'Draft') draftIds.add((Id) m.get('Id'));
        }
        if (draftIds.isEmpty()) return new List<DetectorResult>();
        Set<Id> referenced = new Set<Id>();
        for (Map<String, Object> o : psmos) {
            if (o.containsKey('IsActive') && !Boolean.valueOf(o.get('IsActive'))) continue; // 22i
            Object mid = o.get('ProductSellingModelId');
            if (mid != null && draftIds.contains((Id) mid)) referenced.add((Id) mid);
        }
        for (Map<String, Object> e : pbes) {
            Boolean act = e.get('IsActive') == null ? true : Boolean.valueOf(e.get('IsActive'));
            if (!act) continue;
            Object mid = e.get('ProductSellingModelId');
            if (mid != null && draftIds.contains((Id) mid)) referenced.add((Id) mid);
        }
        if (referenced.isEmpty()) return new List<DetectorResult>();
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Id mid : referenced) {
            bad.add(new SourceRecord('ProductSellingModel', mid,
                nameById.containsKey(mid) ? nameById.get(mid) : 'Draft model'));
        }
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-133'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' draft selling model(s) referenced by active records';
        dr.description = 'Selling models in Draft status should not be wired into active options or pricebook entries.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }
}
