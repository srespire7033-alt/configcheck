/**
 * Phase 22b-1 — Bundle of 10 Billing checks on `blng__BillingRule__c`
 * and `Product2` (with the 3 billing-relationship lookups).
 *
 * Co-located because BR-001 / BR-003 need product config data, and
 * PBC-006 needs rule activity flags — a single Product2 query with
 * relationship fields powers all 10 checks.
 *
 *   BR-001  — Active products referencing inactive billing rules
 *   BR-002  — Active billing rules with no GL Treatment
 *   BR-003  — Billing rules not referenced by any product (orphan)
 *   BR-004  — Duplicate billing rule names
 *   PBC-001 — Active product with no billing rule
 *   PBC-002 — Active product with no revenue recognition rule
 *   PBC-003 — Active product with no tax rule
 *   PBC-004 — Active product with no SBQQ__ChargeType__c
 *   PBC-005 — Recurring product with no SBQQ__BillingFrequency__c
 *   PBC-006 — Product references an inactive billing / rev-rec / tax rule
 *
 * SOQL budget: 3 queries
 *   1. Product2 (selective relationship fields, gated per field presence)
 *   2. blng__BillingRule__c
 *   3. blng__GLTreatment__c (gated on object presence)
 *
 * Surface gate: `blng__BillingRule__c` is the proxy for "Salesforce Billing
 * installed". When absent, the bundle skips cleanly.
 */
public with sharing class BillingRuleBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubProducts;
    @TestVisible static List<Map<String, Object>> testStubRules;
    @TestVisible static List<Map<String, Object>> testStubGlTreatments;

    public String getDetectorId() { return 'BR-BUNDLE'; }
    public String getLabel() { return 'Billing Rule + Product Billing Config checks'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ+Billing', 'ARM' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> products;
        List<Map<String, Object>> rules;
        List<Map<String, Object>> glTreatments;

        if (testStubProducts != null || testStubRules != null || testStubGlTreatments != null) {
            products = (testStubProducts != null) ? testStubProducts : new List<Map<String, Object>>();
            rules = (testStubRules != null) ? testStubRules : new List<Map<String, Object>>();
            glTreatments = (testStubGlTreatments != null) ? testStubGlTreatments : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('blng__BillingRule__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] BR-BUNDLE: blng__BillingRule__c not present.');
                return results;
            }
            products = queryProducts(ctx);
            rules = queryRules(ctx);
            glTreatments = querySafe(ctx,
                SchemaUtil.hasObject('blng__GLTreatment__c'),
                'SELECT Id, blng__GLRule__c FROM blng__GLTreatment__c LIMIT 5000');
            if (products == null || rules == null) return results; // hard failure
            if (glTreatments == null) glTreatments = new List<Map<String, Object>>();
        }

        Boolean runBR001  = DetectorCatalogController.isActive('BR-001');
        Boolean runBR002  = DetectorCatalogController.isActive('BR-002');
        Boolean runBR003  = DetectorCatalogController.isActive('BR-003');
        Boolean runBR004  = DetectorCatalogController.isActive('BR-004');
        Boolean runPBC001 = DetectorCatalogController.isActive('PBC-001');
        Boolean runPBC002 = DetectorCatalogController.isActive('PBC-002');
        Boolean runPBC003 = DetectorCatalogController.isActive('PBC-003');
        Boolean runPBC004 = DetectorCatalogController.isActive('PBC-004');
        Boolean runPBC005 = DetectorCatalogController.isActive('PBC-005');
        Boolean runPBC006 = DetectorCatalogController.isActive('PBC-006');

        if (runBR001)  results.addAll(evaluateBR001(products, rules));
        if (runBR002)  results.addAll(evaluateBR002(rules, glTreatments));
        if (runBR003)  results.addAll(evaluateBR003(products, rules));
        if (runBR004)  results.addAll(evaluateBR004(rules));
        if (runPBC001) results.addAll(evaluatePBC001(products));
        if (runPBC002) results.addAll(evaluatePBC002(products));
        if (runPBC003) results.addAll(evaluatePBC003(products));
        if (runPBC004) results.addAll(evaluatePBC004(products));
        if (runPBC005) results.addAll(evaluatePBC005(products));
        if (runPBC006) results.addAll(evaluatePBC006(products));
        return results;
    }

    // ── data fetch ────────────────────────────────────────────────

    @TestVisible
    static List<Map<String, Object>> queryProducts(DetectorContext ctx) {
        // Build SELECT conditionally based on field presence. Older
        // Billing / CPQ versions may lack the SBQQ__ fields.
        Boolean hasChargeType = SchemaUtil.hasField('Product2', 'SBQQ__ChargeType__c');
        Boolean hasBillingFreq = SchemaUtil.hasField('Product2', 'SBQQ__BillingFrequency__c');
        Boolean hasBillingRule = SchemaUtil.hasField('Product2', 'blng__BillingRule__c');
        Boolean hasRevRecRule = SchemaUtil.hasField('Product2', 'blng__RevenueRecognitionRule__c');
        Boolean hasTaxRule = SchemaUtil.hasField('Product2', 'blng__TaxRule__c');

        if (!hasBillingRule) {
            // Without blng__BillingRule__c on Product2 the whole bundle
            // is meaningless. Return empty so callers see no findings.
            return new List<Map<String, Object>>();
        }
        String soql = 'SELECT Id, Name, IsActive'
            + ', blng__BillingRule__c, blng__BillingRule__r.blng__Active__c'
            + (hasRevRecRule ? ', blng__RevenueRecognitionRule__c, blng__RevenueRecognitionRule__r.blng__Active__c' : '')
            + (hasTaxRule    ? ', blng__TaxRule__c, blng__TaxRule__r.blng__Active__c' : '')
            + (hasChargeType ? ', SBQQ__ChargeType__c' : '')
            + (hasBillingFreq ? ', SBQQ__BillingFrequency__c' : '')
            + ' FROM Product2 WHERE IsActive = true LIMIT 5000';
        try { return OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] BR-BUNDLE products: ' + e.getMessage());
            return null;
        }
    }

    @TestVisible
    static List<Map<String, Object>> queryRules(DetectorContext ctx) {
        try {
            return OrgQueryService.query(ctx,
                'SELECT Id, Name, blng__Active__c FROM blng__BillingRule__c LIMIT 5000');
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] BR-BUNDLE rules: ' + e.getMessage());
            return null;
        }
    }

    static List<Map<String, Object>> querySafe(DetectorContext ctx, Boolean enabled, String soql) {
        if (!enabled) return null;
        try { return OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] BR-BUNDLE optional query: ' + e.getMessage());
            return new List<Map<String, Object>>();
        }
    }

    // ── helpers ────────────────────────────────────────────────────

    static Boolean activeOrNull(Map<String, Object> rec) {
        // TS truthy: !r.blng__Active__c → both false AND null match.
        Object v = rec.get('blng__Active__c');
        return v == null || Boolean.valueOf(v) == false;
    }

    static SourceRecord prodRef(Map<String, Object> p) {
        return new SourceRecord('Product2', (Id) p.get('Id'), (String) p.get('Name'));
    }
    static SourceRecord ruleRef(Map<String, Object> r) {
        return new SourceRecord('blng__BillingRule__c', (Id) r.get('Id'), (String) r.get('Name'));
    }

    /** Build an aggregated finding with capped supportingRecords. */
    static DetectorResult agg(String detectorId, String severity, String title, String description,
                               List<SourceRecord> refs, Decimal recovScore) {
        DetectorResult r = new DetectorResult();
        r.detectorId = detectorId;
        r.severity = severity;
        r.gapUsd = 0;
        r.recoverabilityScore = recovScore;
        r.title = title;
        r.description = description;
        if (refs != null && !refs.isEmpty()) {
            r.primaryRecord = refs[0];
            Integer cap = Math.min(50, refs.size());
            for (Integer i = 1; i < cap; i++) r.supportingRecords.add(refs[i]);
        }
        return r;
    }

    // ── BR-001: active products → inactive billing rule ────────────

    @TestVisible
    static List<DetectorResult> evaluateBR001(List<Map<String, Object>> products, List<Map<String, Object>> rules) {
        Set<Id> inactiveRuleIds = new Set<Id>();
        for (Map<String, Object> r : rules) {
            if (activeOrNull(r)) inactiveRuleIds.add((Id) r.get('Id'));
        }
        List<SourceRecord> affected = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            Object br = p.get('blng__BillingRule__c');
            if (br == null) continue;
            if (inactiveRuleIds.contains((Id) br)) affected.add(prodRef(p));
        }
        if (affected.isEmpty()) return new List<DetectorResult>();
        return new List<DetectorResult>{ agg('BR-001', 'Critical',
            'Inactive billing rules assigned to active products',
            affected.size() + ' active product(s) reference inactive billing rules. This will block invoice generation.',
            affected, 0.9) };
    }

    // ── BR-002: active billing rules with no GL Treatment ──────────

    @TestVisible
    static List<DetectorResult> evaluateBR002(List<Map<String, Object>> rules, List<Map<String, Object>> glTreatments) {
        if (glTreatments == null) return new List<DetectorResult>();
        Set<Id> rulesWithTreatments = new Set<Id>();
        for (Map<String, Object> t : glTreatments) {
            Object gr = t.get('blng__GLRule__c');
            if (gr != null) rulesWithTreatments.add((Id) gr);
        }
        List<SourceRecord> missing = new List<SourceRecord>();
        for (Map<String, Object> r : rules) {
            if (activeOrNull(r)) continue; // active = NOT null AND NOT false
            if (rulesWithTreatments.contains((Id) r.get('Id'))) continue;
            missing.add(ruleRef(r));
        }
        if (missing.isEmpty()) return new List<DetectorResult>();
        return new List<DetectorResult>{ agg('BR-002', 'Critical',
            'Active billing rules missing GL treatment',
            missing.size() + ' active billing rule(s) have no GL treatment. Revenue will not be posted to the general ledger.',
            missing, 0.85) };
    }

    // ── BR-003: orphan billing rules ───────────────────────────────

    @TestVisible
    static List<DetectorResult> evaluateBR003(List<Map<String, Object>> products, List<Map<String, Object>> rules) {
        Set<Id> usedRuleIds = new Set<Id>();
        for (Map<String, Object> p : products) {
            Object br = p.get('blng__BillingRule__c');
            if (br != null) usedRuleIds.add((Id) br);
        }
        List<SourceRecord> orphans = new List<SourceRecord>();
        for (Map<String, Object> r : rules) {
            if (!usedRuleIds.contains((Id) r.get('Id'))) orphans.add(ruleRef(r));
        }
        if (orphans.isEmpty()) return new List<DetectorResult>();
        return new List<DetectorResult>{ agg('BR-003', 'Info',
            'Unused billing rules found',
            orphans.size() + ' billing rule(s) are not referenced by any product. These may be legacy or test rules.',
            orphans, 1.0) };
    }

    // ── BR-004: duplicate billing rule names ───────────────────────

    @TestVisible
    static List<DetectorResult> evaluateBR004(List<Map<String, Object>> rules) {
        Map<String, List<Map<String, Object>>> byName = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> r : rules) {
            String name = (String) r.get('Name');
            if (String.isBlank(name)) continue;
            if (!byName.containsKey(name)) byName.put(name, new List<Map<String, Object>>());
            byName.get(name).add(r);
        }
        Integer dupNames = 0;
        List<SourceRecord> allDupes = new List<SourceRecord>();
        for (String name : byName.keySet()) {
            List<Map<String, Object>> bucket = byName.get(name);
            if (bucket.size() < 2) continue;
            dupNames++;
            for (Map<String, Object> r : bucket) allDupes.add(ruleRef(r));
        }
        if (dupNames == 0) return new List<DetectorResult>();
        return new List<DetectorResult>{ agg('BR-004', 'Warning',
            'Duplicate billing rule names detected',
            dupNames + ' billing rule name(s) have duplicates. This causes confusion when assigning rules to products.',
            allDupes, 0.95) };
    }

    // ── PBC-001..005: null lookup checks on Product2 ───────────────

    @TestVisible
    static List<DetectorResult> evaluatePBC001(List<Map<String, Object>> products) {
        return nullLookupPBC(products, 'blng__BillingRule__c', 'PBC-001', 'Critical',
            'Active products missing billing rule',
            ' active product(s) have no billing rule assigned. Invoices will not be generated.',
            0.85);
    }

    @TestVisible
    static List<DetectorResult> evaluatePBC002(List<Map<String, Object>> products) {
        return nullLookupPBC(products, 'blng__RevenueRecognitionRule__c', 'PBC-002', 'Critical',
            'Active products missing revenue recognition rule',
            ' active product(s) have no revenue recognition rule. Revenue will not be recognized.',
            0.85);
    }

    @TestVisible
    static List<DetectorResult> evaluatePBC003(List<Map<String, Object>> products) {
        return nullLookupPBC(products, 'blng__TaxRule__c', 'PBC-003', 'Critical',
            'Active products missing tax rule',
            ' active product(s) have no tax rule assigned.',
            0.85);
    }

    @TestVisible
    static List<DetectorResult> evaluatePBC004(List<Map<String, Object>> products) {
        return nullLookupPBC(products, 'SBQQ__ChargeType__c', 'PBC-004', 'Critical',
            'Active products missing charge type',
            ' active product(s) have no charge type set. Billing cannot process them.',
            0.9);
    }

    static List<DetectorResult> nullLookupPBC(List<Map<String, Object>> products,
            String fieldKey, String detectorId, String severity, String title, String descSuffix, Decimal recov) {
        List<SourceRecord> missing = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            if (p.get(fieldKey) == null) missing.add(prodRef(p));
        }
        if (missing.isEmpty()) return new List<DetectorResult>();
        return new List<DetectorResult>{ agg(detectorId, severity, title,
            missing.size() + descSuffix, missing, recov) };
    }

    // ── PBC-005: Recurring + no BillingFrequency ──────────────────

    @TestVisible
    static List<DetectorResult> evaluatePBC005(List<Map<String, Object>> products) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            Object ct = p.get('SBQQ__ChargeType__c');
            if (ct == null || String.valueOf(ct) != 'Recurring') continue;
            if (p.get('SBQQ__BillingFrequency__c') != null) continue;
            bad.add(prodRef(p));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        return new List<DetectorResult>{ agg('PBC-005', 'Warning',
            'Recurring products without billing frequency',
            bad.size() + ' recurring product(s) have no billing frequency set.',
            bad, 0.95) };
    }

    // ── PBC-006: product → inactive rule (strict false) ───────────

    @TestVisible
    static List<DetectorResult> evaluatePBC006(List<Map<String, Object>> products) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : products) {
            if (anyRelatedRuleInactive(p)) bad.add(prodRef(p));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        return new List<DetectorResult>{ agg('PBC-006', 'Warning',
            'Products referencing inactive rules',
            bad.size() + ' active product(s) have at least one inactive billing, revenue recognition, or tax rule assigned.',
            bad, 0.9) };
    }

    /** STRICT-FALSE semantics — only counts when relationship is set AND
     *  related Active = false. Null Active or null relationship is OK. */
    static Boolean anyRelatedRuleInactive(Map<String, Object> p) {
        return isRelStrictlyInactive(p, 'blng__BillingRule__c', 'blng__BillingRule__r')
            || isRelStrictlyInactive(p, 'blng__RevenueRecognitionRule__c', 'blng__RevenueRecognitionRule__r')
            || isRelStrictlyInactive(p, 'blng__TaxRule__c', 'blng__TaxRule__r');
    }

    static Boolean isRelStrictlyInactive(Map<String, Object> p, String idField, String relField) {
        if (p.get(idField) == null) return false;
        Object relObj = p.get(relField);
        if (relObj == null || !(relObj instanceof Map<String, Object>)) return false;
        Object active = ((Map<String, Object>) relObj).get('blng__Active__c');
        return active != null && Boolean.valueOf(active) == false;
    }
}
