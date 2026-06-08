/**
 * Phase 22a-3 — Bundle of 4 checks on SBQQ__ConfigurationAttribute__c.
 *
 *   CA-001 — Hidden AND Required attribute (impossible to configure)
 *   CA-002 — Attribute with no TargetField (selection isn't persisted)
 *   CA-003 — Duplicate attribute Name on same product
 *   CA-004 — Required attribute without DefaultField (UX friction)
 *
 * SOQL budget: 1 query.
 */
public with sharing class ConfigurationAttributeChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'CA-BUNDLE'; }
    public String getLabel() { return 'Configuration Attribute health checks'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__ConfigurationAttribute__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] CA-BUNDLE: SBQQ__ConfigurationAttribute__c not present.');
                return results;
            }
            String soql =
                'SELECT Id, Name, SBQQ__Product__c, SBQQ__Product__r.Name, ' +
                '  SBQQ__Required__c, SBQQ__Hidden__c, ' +
                '  SBQQ__TargetField__c, SBQQ__DefaultField__c ' +
                'FROM SBQQ__ConfigurationAttribute__c LIMIT 5000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] CA-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        Boolean runCA001 = DetectorCatalogController.isActive('CA-001');
        Boolean runCA002 = DetectorCatalogController.isActive('CA-002');
        Boolean runCA003 = DetectorCatalogController.isActive('CA-003');
        Boolean runCA004 = DetectorCatalogController.isActive('CA-004');

        // CA-001 migrated to CustomDetector__mdt (Phase 24g).
        // if (runCA001) results.addAll(evaluateCA001(rows));
        if (runCA002) results.addAll(evaluateCA002(rows));
        if (runCA003) results.addAll(evaluateCA003(rows));
        if (runCA004) results.addAll(evaluateCA004(rows));
        return results;
    }

    // ── helpers ────────────────────────────────────────────────────

    static String productName(Map<String, Object> attr) {
        Object o = attr.get('SBQQ__Product__r');
        if (o != null && o instanceof Map<String, Object>) {
            Object n = ((Map<String, Object>) o).get('Name');
            if (n != null) return String.valueOf(n);
        }
        Object pid = attr.get('SBQQ__Product__c');
        return (pid == null) ? 'Unknown' : String.valueOf(pid);
    }

    static SourceRecord attrRef(Map<String, Object> attr) {
        return new SourceRecord('SBQQ__ConfigurationAttribute__c',
            (Id) attr.get('Id'), (String) attr.get('Name'));
    }

    static String s(Map<String, Object> m, String key) {
        Object o = m.get(key);
        return (o == null) ? null : String.valueOf(o);
    }

    // ── CA-001: Hidden AND Required ───────────────────────────────

    @TestVisible
    static List<DetectorResult> evaluateCA001(List<Map<String, Object>> attrs) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> a : attrs) {
            if (!Boolean.valueOf(a.get('SBQQ__Required__c'))) continue;
            if (!Boolean.valueOf(a.get('SBQQ__Hidden__c'))) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'CA-001';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Critical');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.95;
            r.title = 'Attribute "' + (String) a.get('Name') + '" is both hidden and required';
            r.description = '"' + (String) a.get('Name') + '" on product "' + productName(a) +
                '" is marked as Required but also Hidden. Users cannot see or fill in a hidden field, making it impossible to configure the product.';
            r.primaryRecord = attrRef(a);
            out.add(r);
        }
        return out;
    }

    // ── CA-002: no TargetField (group by product) ─────────────────

    @TestVisible
    static List<DetectorResult> evaluateCA002(List<Map<String, Object>> attrs) {
        Map<Id, List<Map<String, Object>>> byProduct = new Map<Id, List<Map<String, Object>>>();
        for (Map<String, Object> a : attrs) {
            if (!String.isBlank(s(a, 'SBQQ__TargetField__c'))) continue;
            Object pObj = a.get('SBQQ__Product__c');
            if (pObj == null) continue;
            Id pid = (Id) pObj;
            if (!byProduct.containsKey(pid)) byProduct.put(pid, new List<Map<String, Object>>());
            byProduct.get(pid).add(a);
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (Id pid : byProduct.keySet()) {
            List<Map<String, Object>> bad = byProduct.get(pid);
            String pname = productName(bad[0]);
            List<String> names = new List<String>();
            for (Map<String, Object> a : bad) names.add('"' + (String) a.get('Name') + '"');
            DetectorResult r = new DetectorResult();
            r.detectorId = 'CA-002';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = bad.size() + ' attribute(s) on "' + pname + '" missing target field';
            r.description = String.join(names, ', ') + ' on product "' + pname +
                '" have no Target Field set. The user\'s selection in the configurator won\'t be saved anywhere.';
            r.primaryRecord = attrRef(bad[0]);
            for (Integer i = 1; i < bad.size(); i++) r.supportingRecords.add(attrRef(bad[i]));
            out.add(r);
        }
        return out;
    }

    // ── CA-003: duplicate (Product, Name) ─────────────────────────

    @TestVisible
    static List<DetectorResult> evaluateCA003(List<Map<String, Object>> attrs) {
        Map<String, List<Map<String, Object>>> byKey = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> a : attrs) {
            Object pObj = a.get('SBQQ__Product__c');
            if (pObj == null) continue;
            String key = String.valueOf(pObj) + '|' + s(a, 'Name');
            if (!byKey.containsKey(key)) byKey.put(key, new List<Map<String, Object>>());
            byKey.get(key).add(a);
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (String key : byKey.keySet()) {
            List<Map<String, Object>> bucket = byKey.get(key);
            if (bucket.size() < 2) continue;
            String pname = productName(bucket[0]);
            String attrName = s(bucket[0], 'Name');
            DetectorResult r = new DetectorResult();
            r.detectorId = 'CA-003';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.95;
            r.title = 'Duplicate attribute "' + attrName + '" on "' + pname + '"';
            r.description = 'Product "' + pname + '" has ' + bucket.size() +
                ' configuration attributes all named "' + attrName +
                '". This creates confusion in the configurator and may cause values to overwrite each other.';
            r.primaryRecord = attrRef(bucket[0]);
            for (Integer i = 1; i < bucket.size(); i++) r.supportingRecords.add(attrRef(bucket[i]));
            out.add(r);
        }
        return out;
    }

    // ── CA-004: Required + not Hidden + no DefaultField ───────────

    @TestVisible
    static List<DetectorResult> evaluateCA004(List<Map<String, Object>> attrs) {
        Map<Id, List<Map<String, Object>>> byProduct = new Map<Id, List<Map<String, Object>>>();
        for (Map<String, Object> a : attrs) {
            if (!Boolean.valueOf(a.get('SBQQ__Required__c'))) continue;
            if (Boolean.valueOf(a.get('SBQQ__Hidden__c'))) continue;
            if (!String.isBlank(s(a, 'SBQQ__DefaultField__c'))) continue;
            Object pObj = a.get('SBQQ__Product__c');
            if (pObj == null) continue;
            Id pid = (Id) pObj;
            if (!byProduct.containsKey(pid)) byProduct.put(pid, new List<Map<String, Object>>());
            byProduct.get(pid).add(a);
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (Id pid : byProduct.keySet()) {
            List<Map<String, Object>> bad = byProduct.get(pid);
            String pname = productName(bad[0]);
            List<String> names = new List<String>();
            for (Map<String, Object> a : bad) names.add('"' + (String) a.get('Name') + '"');
            DetectorResult r = new DetectorResult();
            r.detectorId = 'CA-004';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Info');
            r.gapUsd = 0;
            r.recoverabilityScore = 1.0;
            r.title = bad.size() + ' required attribute(s) on "' + pname + '" without defaults';
            r.description = String.join(names, ', ') + ' on "' + pname +
                '" are required but have no default value. Users must manually fill these every time.';
            r.primaryRecord = attrRef(bad[0]);
            for (Integer i = 1; i < bad.size(); i++) r.supportingRecords.add(attrRef(bad[i]));
            out.add(r);
        }
        return out;
    }
}
