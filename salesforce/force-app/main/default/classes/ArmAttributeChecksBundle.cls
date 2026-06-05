/**
 * Phase 22c-1 — ARM attribute checks (4 — includes ARM-004 from arm_attribute_pricing).
 *
 *   ARM-004 — Attribute adjustment rule without effective dates (warning)
 *   ARM-024 — Picklist attribute without values (critical)
 *   ARM-025 — Required attribute without default (warning)
 *   ARM-026 — Active attribute in inactive category (warning)
 */
public with sharing class ArmAttributeChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRules;
    @TestVisible static List<Map<String, Object>> testStubDefs;
    @TestVisible static List<Map<String, Object>> testStubValues;
    @TestVisible static List<Map<String, Object>> testStubCategories;

    public String getDetectorId() { return 'ARM-ATTR-BUNDLE'; }
    public String getLabel() { return 'ARM Attribute health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> rules;
        List<Map<String, Object>> defs;
        List<Map<String, Object>> values;
        List<Map<String, Object>> categories;
        Boolean usingStubs = (testStubRules != null || testStubDefs != null
            || testStubValues != null || testStubCategories != null);
        if (usingStubs) {
            rules      = testStubRules      != null ? testStubRules      : new List<Map<String, Object>>();
            defs       = testStubDefs       != null ? testStubDefs       : new List<Map<String, Object>>();
            values     = testStubValues     != null ? testStubValues     : new List<Map<String, Object>>();
            categories = testStubCategories != null ? testStubCategories : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('AttributeDefinition')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] ARM-ATTR-BUNDLE: AttributeDefinition not present.');
                return results;
            }
            try {
                rules = SchemaUtil.hasObject('AttributeBasedAdjRule')
                    ? OrgQueryService.query(ctx,
                        'SELECT Id, Name, IsActive, EffectiveStartDate, EffectiveEndDate ' +
                        'FROM AttributeBasedAdjRule LIMIT 5000')
                    : new List<Map<String, Object>>();
                defs = OrgQueryService.query(ctx,
                    'SELECT Id, Name, Code, DataType, IsActive, IsRequired, DefaultValue, AttributeCategoryId ' +
                    'FROM AttributeDefinition LIMIT 5000');
                values = SchemaUtil.hasObject('AttributePicklistValue')
                    ? OrgQueryService.query(ctx,
                        'SELECT Id, AttributeDefinitionId FROM AttributePicklistValue LIMIT 10000')
                    : new List<Map<String, Object>>();
                categories = SchemaUtil.hasObject('AttributeCategory')
                    ? OrgQueryService.query(ctx,
                        'SELECT Id, Name, IsActive FROM AttributeCategory LIMIT 5000')
                    : new List<Map<String, Object>>();
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] ARM-ATTR-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        if (DetectorCatalogController.isActive('ARM-004')) results.addAll(evaluateARM004(rules));
        if (DetectorCatalogController.isActive('ARM-024')) results.addAll(evaluateARM024(defs, values));
        if (DetectorCatalogController.isActive('ARM-025')) results.addAll(evaluateARM025(defs));
        if (DetectorCatalogController.isActive('ARM-026')) results.addAll(evaluateARM026(defs, categories));
        return results;
    }

    static Boolean isActive(Map<String, Object> m) { return Boolean.valueOf(m.get('IsActive')); }

    @TestVisible
    static List<DetectorResult> evaluateARM004(List<Map<String, Object>> rules) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            if (r.get('EffectiveStartDate') != null || r.get('EffectiveEndDate') != null) continue;
            bad.add(new SourceRecord('AttributeBasedAdjRule', (Id) r.get('Id'), (String) r.get('Name')));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-004'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' attribute rule(s) without effective dates';
        dr.description = 'Rules without effective dates fire indefinitely — silent revenue leakage risk.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM024(List<Map<String, Object>> defs, List<Map<String, Object>> values) {
        Set<Id> defsWithValue = new Set<Id>();
        for (Map<String, Object> v : values) {
            Object did = v.get('AttributeDefinitionId');
            if (did != null) defsWithValue.add((Id) did);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> d : defs) {
            if (!isActive(d)) continue;
            String dt = d.get('DataType') == null ? '' : String.valueOf(d.get('DataType')).toLowerCase();
            if (!dt.contains('picklist')) continue;
            if (defsWithValue.contains((Id) d.get('Id'))) continue;
            bad.add(new SourceRecord('AttributeDefinition', (Id) d.get('Id'), (String) d.get('Name')));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-024'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' picklist attribute(s) with no values';
        dr.description = 'Picklist attributes without AttributePicklistValue rows cannot be selected at runtime.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM025(List<Map<String, Object>> defs) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> d : defs) {
            if (!isActive(d)) continue;
            if (!Boolean.valueOf(d.get('IsRequired'))) continue;
            Object v = d.get('DefaultValue');
            if (v != null && !String.isBlank(String.valueOf(v))) continue;
            bad.add(new SourceRecord('AttributeDefinition', (Id) d.get('Id'), (String) d.get('Name')));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-025'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' required attribute(s) without default value';
        dr.description = 'Required attributes should have a default to avoid blocking sales reps.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM026(List<Map<String, Object>> defs, List<Map<String, Object>> categories) {
        Set<Id> inactiveCats = new Set<Id>();
        for (Map<String, Object> c : categories) if (!isActive(c)) inactiveCats.add((Id) c.get('Id'));
        if (inactiveCats.isEmpty()) return new List<DetectorResult>();
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> d : defs) {
            if (!isActive(d)) continue;
            Object cid = d.get('AttributeCategoryId');
            if (cid == null || !inactiveCats.contains((Id) cid)) continue;
            bad.add(new SourceRecord('AttributeDefinition', (Id) d.get('Id'), (String) d.get('Name')));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-026'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' active attribute(s) in inactive categor(ies)';
        dr.description = 'Active attribute definitions belong to deactivated AttributeCategory records.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }
}
