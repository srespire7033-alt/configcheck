/** Phase 22c-3 — Orchestration: ARM-045..048, ARM-171. */
public with sharing class ArmOrchestrationChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubSteps;
    @TestVisible static List<Map<String, Object>> testStubGroups;
    @TestVisible static List<Map<String, Object>> testStubTaskRules;
    @TestVisible static List<Map<String, Object>> testStubScenarios;
    @TestVisible static List<Map<String, Object>> testStubDeps;

    public String getDetectorId() { return 'ARM-ORCH-BUNDLE'; }
    public String getLabel() { return 'ARM Orchestration checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> steps, groups, taskRules, scenarios, deps;
        Boolean usingStubs = (testStubSteps != null || testStubGroups != null
            || testStubTaskRules != null || testStubScenarios != null || testStubDeps != null);
        if (usingStubs) {
            steps     = testStubSteps     != null ? testStubSteps     : new List<Map<String, Object>>();
            groups    = testStubGroups    != null ? testStubGroups    : new List<Map<String, Object>>();
            taskRules = testStubTaskRules != null ? testStubTaskRules : new List<Map<String, Object>>();
            scenarios = testStubScenarios != null ? testStubScenarios : new List<Map<String, Object>>();
            deps      = testStubDeps      != null ? testStubDeps      : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('FulfillmentStepDefinition')) return results;
            // Phase 22i — schema-tolerant queries. ProductFulfillmentScenario.Status
            // is missing on older RC releases; fall back to a query without Status
            // (ARM-048 then trusts the in-memory "Status != Active" guard against
            // the missing field — treating it as null → not Active → flagged.
            // For older orgs this still surfaces non-Active scenarios via the
            // looser query, just without distinguishing Draft from Inactive.)
            steps = OrgQueryService.queryWithFallback(ctx,
                'SELECT Id, Name, FulfillmentStepDefinitionGroupId FROM FulfillmentStepDefinition LIMIT 5000', null);
            groups = (ctx.isRemote() || SchemaUtil.hasObject('FulfillmentStepDefinitionGroup'))
                ? OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Name FROM FulfillmentStepDefinitionGroup LIMIT 5000', null)
                : new List<Map<String, Object>>();
            taskRules = (ctx.isRemote() || SchemaUtil.hasObject('FulfillmentTaskAssignmentRule'))
                ? OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Name, Status, AssignedToId FROM FulfillmentTaskAssignmentRule LIMIT 5000', null)
                : new List<Map<String, Object>>();
            scenarios = (ctx.isRemote() || SchemaUtil.hasObject('ProductFulfillmentScenario'))
                ? OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Name, Status FROM ProductFulfillmentScenario LIMIT 5000',
                    'SELECT Id, Name FROM ProductFulfillmentScenario LIMIT 5000')
                : new List<Map<String, Object>>();
            deps = (ctx.isRemote() || SchemaUtil.hasObject('FulfillmentStepDependencyDef'))
                ? OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, FulfillmentStepDefinitionId, DependsOnStepDefinitionId FROM FulfillmentStepDependencyDef LIMIT 5000', null)
                : new List<Map<String, Object>>();
        }
        if (DetectorCatalogController.isActive('ARM-045')) results.addAll(evaluateARM045(steps));
        if (DetectorCatalogController.isActive('ARM-046')) results.addAll(evaluateARM046(groups, steps));
        if (DetectorCatalogController.isActive('ARM-047')) results.addAll(evaluateARM047(taskRules));
        if (DetectorCatalogController.isActive('ARM-048')) results.addAll(evaluateARM048(scenarios));
        if (DetectorCatalogController.isActive('ARM-171')) results.addAll(evaluateARM171(deps));
        return results;
    }

    @TestVisible static List<Map<String, Object>> safeQ(DetectorContext ctx, String soql) {
        try { return OrgQueryService.query(ctx, soql); }
        catch (Exception e) { return new List<Map<String, Object>>(); }
    }

    @TestVisible
    static List<DetectorResult> evaluateARM045(List<Map<String, Object>> steps) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> s : steps) {
            if (s.get('FulfillmentStepDefinitionGroupId') != null) continue;
            bad.add(new SourceRecord('FulfillmentStepDefinition', (Id) s.get('Id'), String.valueOf(s.get('Name'))));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-045'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' fulfillment step(s) without group';
        dr.description = 'Steps must belong to a group to be sequenced.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM046(List<Map<String, Object>> groups, List<Map<String, Object>> steps) {
        Set<Id> usedGroups = new Set<Id>();
        for (Map<String, Object> s : steps) {
            Object g = s.get('FulfillmentStepDefinitionGroupId');
            if (g != null) usedGroups.add((Id) g);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> g : groups) {
            if (usedGroups.contains((Id) g.get('Id'))) continue;
            bad.add(new SourceRecord('FulfillmentStepDefinitionGroup', (Id) g.get('Id'), String.valueOf(g.get('Name'))));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-046'; dr.severity = 'Info'; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = bad.size() + ' empty fulfillment step group(s)';
        dr.description = 'Step groups with no member steps add maintenance noise.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM047(List<Map<String, Object>> rules) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : rules) {
            if (String.valueOf(r.get('Status')) != 'Active') continue;
            if (r.get('AssignedToId') != null) continue;
            bad.add(new SourceRecord('FulfillmentTaskAssignmentRule', (Id) r.get('Id'), String.valueOf(r.get('Name'))));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-047'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' active task rule(s) without assignee';
        dr.description = 'Tasks created from these rules have no owner — they\'ll route to defaults.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM048(List<Map<String, Object>> scenarios) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> s : scenarios) {
            if (String.valueOf(s.get('Status')) == 'Active') continue;
            bad.add(new SourceRecord('ProductFulfillmentScenario', (Id) s.get('Id'),
                String.valueOf(s.get('Name')) + ' (' + String.valueOf(s.get('Status')) + ')'));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-048'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' fulfillment scenario(s) not Active';
        dr.description = 'Inactive scenarios cannot orchestrate provisioning.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM171(List<Map<String, Object>> deps) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> d : deps) {
            Object src = d.get('FulfillmentStepDefinitionId');
            Object tgt = d.get('DependsOnStepDefinitionId');
            Boolean broken = (tgt == null) || (src != null && String.valueOf(src) == String.valueOf(tgt));
            if (!broken) continue;
            bad.add(new SourceRecord('FulfillmentStepDependencyDef', (Id) d.get('Id'),
                tgt == null ? 'Null target' : 'Self-reference'));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-171'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = bad.size() + ' broken fulfillment dependency(s)';
        dr.description = 'Dependencies that self-reference or have null targets break orchestration.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }
}
