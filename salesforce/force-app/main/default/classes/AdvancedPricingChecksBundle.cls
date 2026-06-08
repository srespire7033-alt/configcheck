/**
 * Phase 22a-4 — 5 checks on Product2 (+ ProductOption, PricebookEntry).
 *
 *   AP-001 — MDQ Block product missing subscription setup (critical)
 *   AP-002 — Percent-Of-Total product not in any bundle (warning)
 *   AP-003 — Cost-priced product with no PricebookEntry (warning)
 *   AP-004 — Recurring product without billing frequency (warning)
 *   AP-005 — Multiple pricing methods in use (info, aggregated org-wide)
 *
 * SOQL: 3 (Product2, ProductOption, PricebookEntry).
 */
public with sharing class AdvancedPricingChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubProducts;
    @TestVisible static Set<Id> testStubOptionChildIds;
    @TestVisible static Set<Id> testStubPbeProductIds;

    public String getDetectorId() { return 'AP-BUNDLE'; }
    public String getLabel() { return 'Advanced Pricing health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> products;
        Set<Id> optionChildIds;
        Set<Id> pbeProductIds;

        if (testStubProducts != null || testStubOptionChildIds != null || testStubPbeProductIds != null) {
            products = (testStubProducts != null) ? testStubProducts : new List<Map<String, Object>>();
            optionChildIds = (testStubOptionChildIds != null) ? testStubOptionChildIds : new Set<Id>();
            pbeProductIds = (testStubPbeProductIds != null) ? testStubPbeProductIds : new Set<Id>();
        } else {
            // Need at least one SBQQ Product2 field. If they're all
            // missing this bundle is meaningless.
            Boolean hasPricingMethod = SchemaUtil.hasField('Product2', 'SBQQ__PricingMethod__c');
            if (!ctx.isRemote() && !hasPricingMethod) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] AP-BUNDLE: SBQQ__PricingMethod__c not on Product2.');
                return results;
            }
            String soql = 'SELECT Id, Name, IsActive, SBQQ__PricingMethod__c, ' +
                'SBQQ__SubscriptionType__c, SBQQ__SubscriptionPricing__c, ' +
                'SBQQ__ChargeType__c, SBQQ__BillingFrequency__c ' +
                'FROM Product2 WHERE IsActive = true LIMIT 5000';
            try { products = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] AP-BUNDLE products: ' + e.getMessage());
                return results;
            }
            optionChildIds = new Set<Id>();
            try {
                for (Map<String, Object> row : OrgQueryService.query(ctx,
                    'SELECT SBQQ__OptionalSKU__c FROM SBQQ__ProductOption__c WHERE SBQQ__OptionalSKU__c != null LIMIT 10000')) {
                    Object id = row.get('SBQQ__OptionalSKU__c');
                    if (id != null) optionChildIds.add((Id) id);
                }
            } catch (Exception e) { /* options optional */ }
            pbeProductIds = new Set<Id>();
            try {
                for (Map<String, Object> row : OrgQueryService.query(ctx,
                    'SELECT Product2Id FROM PricebookEntry LIMIT 50000')) {
                    Object id = row.get('Product2Id');
                    if (id != null) pbeProductIds.add((Id) id);
                }
            } catch (Exception e) { /* PBE absent is unusual */ }
        }

        Boolean runAP001 = DetectorCatalogController.isActive('AP-001');
        Boolean runAP002 = DetectorCatalogController.isActive('AP-002');
        Boolean runAP003 = DetectorCatalogController.isActive('AP-003');
        Boolean runAP004 = DetectorCatalogController.isActive('AP-004');
        Boolean runAP005 = DetectorCatalogController.isActive('AP-005');

        if (runAP001) results.addAll(evaluateAP001(products));
        if (runAP002) results.addAll(evaluateAP002(products, optionChildIds));
        if (runAP003) results.addAll(evaluateAP003(products, pbeProductIds));
        if (runAP004) results.addAll(evaluateAP004(products));
        if (runAP005) results.addAll(evaluateAP005(products));
        return results;
    }

    static String s(Map<String, Object> m, String key) {
        Object o = m.get(key);
        return (o == null) ? null : String.valueOf(o);
    }
    static SourceRecord prodRef(Map<String, Object> p) {
        return new SourceRecord('Product2', (Id) p.get('Id'), (String) p.get('Name'));
    }

    // ── AP-001: MDQ Block missing subscription fields ─────────────

    @TestVisible
    static List<DetectorResult> evaluateAP001(List<Map<String, Object>> products) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> p : products) {
            if (s(p, 'SBQQ__PricingMethod__c') != 'Block') continue;
            List<String> missing = new List<String>();
            if (String.isBlank(s(p, 'SBQQ__SubscriptionType__c'))) missing.add('Subscription Type');
            if (String.isBlank(s(p, 'SBQQ__SubscriptionPricing__c'))) missing.add('Subscription Pricing');
            if (String.isBlank(s(p, 'SBQQ__ChargeType__c'))) missing.add('Charge Type');
            if (missing.isEmpty()) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'AP-001';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Critical');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = 'MDQ product "' + (String) p.get('Name') + '" missing ' + String.join(missing, ', ');
            r.description = '"' + (String) p.get('Name') + '" uses Block (MDQ) pricing but is missing: ' +
                String.join(missing, ', ') + '. MDQ requires proper subscription configuration to create pricing segments.';
            r.primaryRecord = prodRef(p);
            out.add(r);
        }
        return out;
    }

    // ── AP-002: Percent Of Total not in any bundle ────────────────

    @TestVisible
    static List<DetectorResult> evaluateAP002(List<Map<String, Object>> products, Set<Id> optionChildIds) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> p : products) {
            if (s(p, 'SBQQ__PricingMethod__c') != 'Percent Of Total') continue;
            if (optionChildIds.contains((Id) p.get('Id'))) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'AP-002';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = '"' + (String) p.get('Name') + '" uses Percent of Total but isn\'t a bundle option';
            r.description = '"' + (String) p.get('Name') + '" has Pricing Method = "Percent Of Total" but is not configured as an option in any bundle. ' +
                'Percent of Total only works within a bundle context where there is a parent total to calculate against.';
            r.primaryRecord = prodRef(p);
            out.add(r);
        }
        return out;
    }

    // ── AP-003: Cost-priced product with no PricebookEntry ────────

    @TestVisible
    static List<DetectorResult> evaluateAP003(List<Map<String, Object>> products, Set<Id> pbeProductIds) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> p : products) {
            if (s(p, 'SBQQ__PricingMethod__c') != 'Cost') continue;
            if (pbeProductIds.contains((Id) p.get('Id'))) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'AP-003';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = 'Cost-priced product "' + (String) p.get('Name') + '" has no price book entry';
            r.description = '"' + (String) p.get('Name') + '" uses Cost pricing method but has no price book entry. ' +
                'Without a base price, cost-plus margin calculations will result in $0.';
            r.primaryRecord = prodRef(p);
            out.add(r);
        }
        return out;
    }

    // ── AP-004: Recurring + no BillingFrequency ───────────────────

    @TestVisible
    static List<DetectorResult> evaluateAP004(List<Map<String, Object>> products) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> p : products) {
            if (s(p, 'SBQQ__ChargeType__c') != 'Recurring') continue;
            if (!String.isBlank(s(p, 'SBQQ__BillingFrequency__c'))) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'AP-004';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.95;
            r.title = 'Recurring product "' + (String) p.get('Name') + '" has no billing frequency';
            r.description = '"' + (String) p.get('Name') + '" has Charge Type "Recurring" but no Billing Frequency set. ' +
                'CPQ cannot determine how often to bill the customer.';
            r.primaryRecord = prodRef(p);
            out.add(r);
        }
        return out;
    }

    // ── AP-005: ≥3 distinct pricing methods in use (org-wide) ─────

    @TestVisible
    static List<DetectorResult> evaluateAP005(List<Map<String, Object>> products) {
        Set<String> methods = new Set<String>();
        for (Map<String, Object> p : products) {
            String pm = s(p, 'SBQQ__PricingMethod__c');
            if (!String.isBlank(pm)) methods.add(pm);
        }
        if (methods.size() < 3) return new List<DetectorResult>();
        List<String> sorted = new List<String>(methods);
        sorted.sort();
        DetectorResult r = new DetectorResult();
        r.detectorId = 'AP-005';
        r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Info');
        r.gapUsd = 0;
        r.recoverabilityScore = 1.0;
        r.title = methods.size() + ' pricing methods in use: ' + String.join(sorted, ', ');
        r.description = 'Active products use ' + methods.size() + ' different pricing methods: ' +
            String.join(sorted, ', ') + '. Multiple pricing methods add complexity to the pricing model.';
        // No primary record — org-wide finding. Use first product if any.
        if (!products.isEmpty()) r.primaryRecord = prodRef(products[0]);
        return new List<DetectorResult>{ r };
    }
}
