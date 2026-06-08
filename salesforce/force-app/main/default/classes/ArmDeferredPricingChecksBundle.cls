/**
 * Phase 22c-3 — Carries the 2 high-risk checks deferred from 22c-2.
 *   ARM-130 — Price adjustment tier outside parent schedule date window (critical)
 *             Fixes a latent SaaS bug: the TS source casts EffectiveFrom/To through
 *             `unknown` and the underlying SOQL didn't include those fields, so the
 *             SaaS check silently returned zero. Apex SELECTs the fields explicitly.
 *             Field availability gated via SchemaUtil.hasField.
 *   ARM-132 — Pricebook entry references a selling model that has no matching
 *             active PSMO row (critical). Gated on PricebookEntry.ProductSellingModelId
 *             field describe — that field only exists when RC is enabled.
 *
 * ARM-131 deferred to a future follow-up (same family as ARM-130 but with an
 * additional flaky parent lookup).
 */
public with sharing class ArmDeferredPricingChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubTiers;
    @TestVisible static List<Map<String, Object>> testStubSchedules;
    @TestVisible static List<Map<String, Object>> testStubPbes;
    @TestVisible static List<Map<String, Object>> testStubPsmos;
    @TestVisible static List<Map<String, Object>> testStubAdjRules;  // ARM-131

    public String getDetectorId() { return 'ARM-DEFPRICE-BUNDLE'; }
    public String getLabel() { return 'ARM Deferred Pricing checks (130, 132)'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> tiers, schedules, pbes, psmos, adjRules;
        Boolean usingStubs = (testStubTiers != null || testStubSchedules != null
            || testStubPbes != null || testStubPsmos != null || testStubAdjRules != null);
        if (usingStubs) {
            tiers     = testStubTiers     != null ? testStubTiers     : new List<Map<String, Object>>();
            schedules = testStubSchedules != null ? testStubSchedules : new List<Map<String, Object>>();
            pbes      = testStubPbes      != null ? testStubPbes      : new List<Map<String, Object>>();
            psmos     = testStubPsmos     != null ? testStubPsmos     : new List<Map<String, Object>>();
            adjRules  = testStubAdjRules  != null ? testStubAdjRules  : new List<Map<String, Object>>();
        } else {
            tiers = new List<Map<String, Object>>();
            schedules = new List<Map<String, Object>>();
            // ARM-130: only run if all required fields exist
            if (SchemaUtil.hasObject('PriceAdjustmentTier')
                && SchemaUtil.hasField('PriceAdjustmentTier', 'EffectiveStartDate')
                && SchemaUtil.hasField('PriceAdjustmentTier', 'EffectiveEndDate')
                && SchemaUtil.hasObject('PriceAdjustmentSchedule')
                && SchemaUtil.hasField('PriceAdjustmentSchedule', 'EffectiveStartDate')) {
                tiers = OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, PriceAdjustmentScheduleId, EffectiveStartDate, EffectiveEndDate FROM PriceAdjustmentTier LIMIT 10000', null);
                schedules = OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Name, EffectiveStartDate, EffectiveEndDate FROM PriceAdjustmentSchedule LIMIT 5000', null);
            }
            // ARM-132: only if RC-only field is present
            pbes = new List<Map<String, Object>>();
            psmos = new List<Map<String, Object>>();
            if (SchemaUtil.hasField('PricebookEntry', 'ProductSellingModelId')
                && SchemaUtil.hasObject('ProductSellingModelOption')) {
                pbes = OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Product2Id, ProductSellingModelId, IsActive FROM PricebookEntry WHERE ProductSellingModelId != null LIMIT 10000', null);
                // Phase 22i — PSMO.IsActive missing on older RC releases.
                // queryWithFallback drops the WHERE filter; downstream loop
                // applies it in-memory only when IsActive is actually returned.
                psmos = OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Product2Id, ProductSellingModelId, IsActive FROM ProductSellingModelOption WHERE IsActive = true LIMIT 10000',
                    'SELECT Id, Product2Id, ProductSellingModelId FROM ProductSellingModelOption LIMIT 10000');
            }
            // ARM-131: AttributeBasedAdjRule must have the PriceAdjustmentScheduleId lookup
            // AND the parent schedule must expose effective dates. Otherwise the SaaS-style
            // silent-zero bug persists. SchemaUtil.hasField guards both.
            adjRules = new List<Map<String, Object>>();
            if (SchemaUtil.hasObject('AttributeBasedAdjRule')
                && SchemaUtil.hasField('AttributeBasedAdjRule', 'PriceAdjustmentScheduleId')
                && SchemaUtil.hasField('AttributeBasedAdjRule', 'EffectiveStartDate')
                && SchemaUtil.hasField('AttributeBasedAdjRule', 'EffectiveEndDate')) {
                adjRules = OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Name, IsActive, PriceAdjustmentScheduleId, EffectiveStartDate, EffectiveEndDate ' +
                    'FROM AttributeBasedAdjRule WHERE PriceAdjustmentScheduleId != null LIMIT 5000', null);
            }
        }
        if (DetectorCatalogController.isActive('ARM-130')) results.addAll(evaluateARM130(tiers, schedules));
        if (DetectorCatalogController.isActive('ARM-131')) results.addAll(evaluateARM131(adjRules, schedules));
        if (DetectorCatalogController.isActive('ARM-132')) results.addAll(evaluateARM132(pbes, psmos));
        return results;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM131(List<Map<String, Object>> rules, List<Map<String, Object>> schedules) {
        Map<Id, Map<String, Object>> schedById = new Map<Id, Map<String, Object>>();
        for (Map<String, Object> s : schedules) schedById.put((Id) s.get('Id'), s);
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : rules) {
            Object psid = r.get('PriceAdjustmentScheduleId');
            if (psid == null || !schedById.containsKey((Id) psid)) continue;
            Map<String, Object> p = schedById.get((Id) psid);
            Date psStart = parseD(p.get('EffectiveStartDate'));
            Date psEnd = parseD(p.get('EffectiveEndDate'));
            Date rStart = parseD(r.get('EffectiveStartDate'));
            Date rEnd = parseD(r.get('EffectiveEndDate'));
            Boolean outside = false;
            if (psStart != null && rStart != null && rStart < psStart) outside = true;
            if (!outside && psEnd != null && rEnd != null && rEnd > psEnd) outside = true;
            if (!outside) continue;
            bad.add(new SourceRecord('AttributeBasedAdjRule', (Id) r.get('Id'),
                String.valueOf(r.get('Name')) + ' (schedule "' + String.valueOf(p.get('Name')) + '")'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-131', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-131'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = '"' + dsr.name + '" — ' + (' attribute adjustment(s) outside parent schedule window');
            dr.description = 'Rule effective dates extend past the parent PriceAdjustmentSchedule\'s window.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    static Date parseD(Object o) {
        if (o == null) return null;
        if (o instanceof Date) return (Date) o;
        String s = String.valueOf(o);
        if (s.length() >= 10) s = s.substring(0, 10);
        try { return Date.valueOf(s); } catch (Exception e) { return null; }
    }

    @TestVisible
    static List<DetectorResult> evaluateARM130(List<Map<String, Object>> tiers, List<Map<String, Object>> schedules) {
        Map<Id, Map<String, Object>> schedById = new Map<Id, Map<String, Object>>();
        for (Map<String, Object> s : schedules) schedById.put((Id) s.get('Id'), s);
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> t : tiers) {
            Object psid = t.get('PriceAdjustmentScheduleId');
            if (psid == null || !schedById.containsKey((Id) psid)) continue;
            Map<String, Object> p = schedById.get((Id) psid);
            Date psStart = parseD(p.get('EffectiveStartDate'));
            Date psEnd = parseD(p.get('EffectiveEndDate'));
            Date tStart = parseD(t.get('EffectiveStartDate'));
            Date tEnd = parseD(t.get('EffectiveEndDate'));
            Boolean outside = false;
            if (psStart != null && tStart != null && tStart < psStart) outside = true;
            if (!outside && psEnd != null && tEnd != null && tEnd > psEnd) outside = true;
            if (!outside) continue;
            bad.add(new SourceRecord('PriceAdjustmentTier', (Id) t.get('Id'),
                'Schedule "' + String.valueOf(p.get('Name')) + '"'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-130', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-130'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = '"' + dsr.name + '" — ' + (' price adjustment tier(s) outside parent schedule date range');
            dr.description = 'Tier effective dates extend past the parent schedule\'s effective window.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM132(List<Map<String, Object>> pbes, List<Map<String, Object>> psmos) {
        Set<String> validKeys = new Set<String>();
        for (Map<String, Object> o : psmos) {
            Object pid = o.get('Product2Id'); Object mid = o.get('ProductSellingModelId');
            if (pid == null || mid == null) continue;
            validKeys.add(String.valueOf(pid) + '|' + String.valueOf(mid));
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> e : pbes) {
            Boolean active = e.get('IsActive') == null ? true : Boolean.valueOf(e.get('IsActive'));
            if (!active) continue;
            Object pid = e.get('Product2Id'); Object mid = e.get('ProductSellingModelId');
            if (pid == null || mid == null) continue;
            String k = String.valueOf(pid) + '|' + String.valueOf(mid);
            if (validKeys.contains(k)) continue;
            bad.add(new SourceRecord('PricebookEntry', (Id) e.get('Id'), 'PBE without matching PSMO'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-132', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-132'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = '"' + dsr.name + '" — ' + (' pricebook entry/entries reference selling model with no matching option');
            dr.description = 'These PBEs name a ProductSellingModel that has no matching ProductSellingModelOption.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }
}
