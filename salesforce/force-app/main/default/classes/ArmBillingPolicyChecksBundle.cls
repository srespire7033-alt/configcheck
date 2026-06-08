/** Phase 22c-3 — Billing policies: ARM-190, ARM-191, ARM-193. Phase 22c-4 adds ARM-192. */
public with sharing class ArmBillingPolicyChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubPolicies;
    @TestVisible static List<Map<String, Object>> testStubArrangements;
    @TestVisible static List<Map<String, Object>> testStubArrangementLines;
    @TestVisible static List<Map<String, Object>> testStubRetryRuleSets;
    @TestVisible static List<Map<String, Object>> testStubMilestonePlans;     // 192
    @TestVisible static List<Map<String, Object>> testStubMilestonePlanItems; // 192

    public String getDetectorId() { return 'ARM-BILLPOL-BUNDLE'; }
    public String getLabel() { return 'ARM Billing Policy checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> policies, arrs, lines, retries, plans, planItems;
        Boolean usingStubs = (testStubPolicies != null || testStubArrangements != null
            || testStubArrangementLines != null || testStubRetryRuleSets != null
            || testStubMilestonePlans != null || testStubMilestonePlanItems != null);
        if (usingStubs) {
            policies  = testStubPolicies            != null ? testStubPolicies            : new List<Map<String, Object>>();
            arrs      = testStubArrangements        != null ? testStubArrangements        : new List<Map<String, Object>>();
            lines     = testStubArrangementLines    != null ? testStubArrangementLines    : new List<Map<String, Object>>();
            retries   = testStubRetryRuleSets       != null ? testStubRetryRuleSets       : new List<Map<String, Object>>();
            plans     = testStubMilestonePlans      != null ? testStubMilestonePlans      : new List<Map<String, Object>>();
            planItems = testStubMilestonePlanItems  != null ? testStubMilestonePlanItems  : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('BillingPolicy')
                && !SchemaUtil.hasObject('BillingArrangement')
                && !SchemaUtil.hasObject('PaymentRetryRuleSet')) return results;
            policies = SchemaUtil.hasObject('BillingPolicy')
                ? OrgQueryService.queryWithFallback(ctx, 'SELECT Id, Name, Status, BillingTreatmentSelection, DefaultBillingTreatmentId, DefaultBillingTreatment.Status FROM BillingPolicy LIMIT 5000', null)
                : new List<Map<String, Object>>();
            arrs = SchemaUtil.hasObject('BillingArrangement')
                ? OrgQueryService.queryWithFallback(ctx, 'SELECT Id, Name, Status FROM BillingArrangement LIMIT 5000', null)
                : new List<Map<String, Object>>();
            lines = SchemaUtil.hasObject('BillingArrangementLine')
                ? OrgQueryService.queryWithFallback(ctx, 'SELECT Id, BillingArrangementId FROM BillingArrangementLine LIMIT 10000', null)
                : new List<Map<String, Object>>();
            retries = SchemaUtil.hasObject('PaymentRetryRuleSet')
                ? OrgQueryService.queryWithFallback(ctx, 'SELECT Id, Name, Status, IsOrgDefault FROM PaymentRetryRuleSet LIMIT 5000', null)
                : new List<Map<String, Object>>();
            plans = SchemaUtil.hasObject('BillingMilestonePlan')
                ? OrgQueryService.queryWithFallback(ctx, 'SELECT Id, Name, Status, DefaultBillingTreatmentId, DefaultBillingTreatment.Status FROM BillingMilestonePlan LIMIT 5000', null)
                : new List<Map<String, Object>>();
            planItems = SchemaUtil.hasObject('BillingMilestonePlanItem')
                ? OrgQueryService.queryWithFallback(ctx, 'SELECT Id, BillingMilestonePlanId FROM BillingMilestonePlanItem LIMIT 10000', null)
                : new List<Map<String, Object>>();
        }
        if (DetectorCatalogController.isActive('ARM-190')) results.addAll(evaluateARM190(policies));
        if (DetectorCatalogController.isActive('ARM-191')) results.addAll(evaluateARM191(arrs, lines));
        if (DetectorCatalogController.isActive('ARM-192')) results.addAll(evaluateARM192(plans, planItems));
        if (DetectorCatalogController.isActive('ARM-193')) results.addAll(evaluateARM193(retries));
        return results;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM192(List<Map<String, Object>> plans, List<Map<String, Object>> items) {
        Set<Id> plansWithItems = new Set<Id>();
        for (Map<String, Object> i : items) {
            Object pid = i.get('BillingMilestonePlanId');
            if (pid != null) plansWithItems.add((Id) pid);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : plans) {
            if (String.valueOf(p.get('Status')) != 'Active') continue;
            Boolean badPlan = !plansWithItems.contains((Id) p.get('Id'));
            if (!badPlan) {
                Object treat = p.get('DefaultBillingTreatment');
                if (treat instanceof Map<String, Object>) {
                    Object st = ((Map<String, Object>) treat).get('Status');
                    if (st != null && String.valueOf(st) != 'Active') badPlan = true;
                }
            }
            if (!badPlan) continue;
            bad.add(new SourceRecord('BillingMilestonePlan', (Id) p.get('Id'), String.valueOf(p.get('Name'))));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-192'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = bad.size() + ' active milestone plan(s) with no items or inactive default treatment';
        dr.description = 'Milestone plans must have at least one item AND an Active DefaultBillingTreatment.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }


    @TestVisible
    static List<DetectorResult> evaluateARM190(List<Map<String, Object>> policies) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : policies) {
            if (String.valueOf(p.get('Status')) != 'Active') continue;
            if (String.valueOf(p.get('BillingTreatmentSelection')) != 'Default') continue;
            Boolean missing = p.get('DefaultBillingTreatmentId') == null;
            if (!missing) {
                Object treat = p.get('DefaultBillingTreatment');
                if (treat instanceof Map<String, Object>) {
                    Object st = ((Map<String, Object>) treat).get('Status');
                    missing = (st == null || String.valueOf(st) != 'Active');
                }
            }
            if (!missing) continue;
            bad.add(new SourceRecord('BillingPolicy', (Id) p.get('Id'), String.valueOf(p.get('Name'))));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-190'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = bad.size() + ' active billing polic(ies) without active default treatment';
        dr.description = 'Default-selection policies need an active DefaultBillingTreatment.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM191(List<Map<String, Object>> arrs, List<Map<String, Object>> lines) {
        Set<Id> withLines = new Set<Id>();
        for (Map<String, Object> l : lines) {
            Object aid = l.get('BillingArrangementId');
            if (aid != null) withLines.add((Id) aid);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> a : arrs) {
            if (String.valueOf(a.get('Status')) != 'Active') continue;
            if (withLines.contains((Id) a.get('Id'))) continue;
            bad.add(new SourceRecord('BillingArrangement', (Id) a.get('Id'), String.valueOf(a.get('Name'))));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-191'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = bad.size() + ' active billing arrangement(s) without lines';
        dr.description = 'Arrangements without lines cannot generate invoices.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM193(List<Map<String, Object>> retries) {
        List<Map<String, Object>> orgDefaults = new List<Map<String, Object>>();
        for (Map<String, Object> r : retries) {
            if (String.valueOf(r.get('Status')) != 'Active') continue;
            if (!Boolean.valueOf(r.get('IsOrgDefault'))) continue;
            orgDefaults.add(r);
        }
        if (orgDefaults.size() <= 1) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-193'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = orgDefaults.size() + ' active org-default payment retry rule sets';
        dr.description = 'Only one PaymentRetryRuleSet should be both Active and IsOrgDefault.';
        dr.primaryRecord = new SourceRecord('PaymentRetryRuleSet', (Id) orgDefaults[0].get('Id'),
            String.valueOf(orgDefaults[0].get('Name')));
        for (Integer i = 1; i < orgDefaults.size(); i++) dr.supportingRecords.add(
            new SourceRecord('PaymentRetryRuleSet', (Id) orgDefaults[i].get('Id'),
                String.valueOf(orgDefaults[i].get('Name'))));
        return new List<DetectorResult>{ dr };
    }
}
