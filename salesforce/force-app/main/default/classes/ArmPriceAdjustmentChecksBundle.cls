/**
 * Phase 22c-2 — ARM price adjustment + attribute pricing (4 checks).
 *
 *   ARM-003 — Overlapping price adjustment tiers (warning)
 *   ARM-016 — Active schedule with no tiers (warning)
 *   ARM-017 — Tier with reversed bounds (critical)
 *   ARM-020 — Expired attribute rule still active (info)
 *
 * ARM-130 / ARM-131 deferred to 22c-3 (need schema gaps fixed +
 * release-variant FieldDescribe gates).
 */
public with sharing class ArmPriceAdjustmentChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubSchedules;
    @TestVisible static List<Map<String, Object>> testStubTiers;
    @TestVisible static List<Map<String, Object>> testStubRules;

    public String getDetectorId() { return 'ARM-PADJ-BUNDLE'; }
    public String getLabel() { return 'ARM Price Adjustment checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> schedules;
        List<Map<String, Object>> tiers;
        List<Map<String, Object>> rules;
        Boolean usingStubs = (testStubSchedules != null || testStubTiers != null || testStubRules != null);
        if (usingStubs) {
            schedules = testStubSchedules != null ? testStubSchedules : new List<Map<String, Object>>();
            tiers     = testStubTiers     != null ? testStubTiers     : new List<Map<String, Object>>();
            rules     = testStubRules     != null ? testStubRules     : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('PriceAdjustmentSchedule')
                && !SchemaUtil.hasObject('AttributeBasedAdjRule')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] ARM-PADJ-BUNDLE: pricing surface absent.');
                return results;
            }
            schedules = querySchedules(ctx);
            tiers = queryTiers(ctx);
            rules = queryRules(ctx);
        }

        if (DetectorCatalogController.isActive('ARM-003')) results.addAll(evaluateARM003(tiers, schedules));
        if (DetectorCatalogController.isActive('ARM-016')) results.addAll(evaluateARM016(schedules, tiers));
        if (DetectorCatalogController.isActive('ARM-017')) results.addAll(evaluateARM017(tiers, schedules));
        if (DetectorCatalogController.isActive('ARM-020')) results.addAll(evaluateARM020(rules));
        return results;
    }

    @TestVisible static List<Map<String, Object>> querySchedules(DetectorContext ctx) {
        if (!SchemaUtil.hasObject('PriceAdjustmentSchedule')) return new List<Map<String, Object>>();
        try {
            return OrgQueryService.query(ctx, 'SELECT Id, Name, IsActive FROM PriceAdjustmentSchedule LIMIT 5000');
        } catch (Exception e) { return new List<Map<String, Object>>(); }
    }
    @TestVisible static List<Map<String, Object>> queryTiers(DetectorContext ctx) {
        if (!SchemaUtil.hasObject('PriceAdjustmentTier')) return new List<Map<String, Object>>();
        try {
            return OrgQueryService.query(ctx,
                'SELECT Id, PriceAdjustmentScheduleId, LowerBound, UpperBound FROM PriceAdjustmentTier LIMIT 10000');
        } catch (Exception e) { return new List<Map<String, Object>>(); }
    }
    @TestVisible static List<Map<String, Object>> queryRules(DetectorContext ctx) {
        if (!SchemaUtil.hasObject('AttributeBasedAdjRule')) return new List<Map<String, Object>>();
        try {
            return OrgQueryService.query(ctx,
                'SELECT Id, Name, IsActive, EffectiveEndDate FROM AttributeBasedAdjRule LIMIT 5000');
        } catch (Exception e) { return new List<Map<String, Object>>(); }
    }

    static Date parseD(Object o) {
        if (o == null) return null;
        if (o instanceof Date) return (Date) o;
        String s = String.valueOf(o);
        if (s.length() >= 10) s = s.substring(0, 10);
        try { return Date.valueOf(s); } catch (Exception e) { return null; }
    }

    @TestVisible
    static List<DetectorResult> evaluateARM003(List<Map<String, Object>> tiers, List<Map<String, Object>> schedules) {
        Map<Id, String> nameById = new Map<Id, String>();
        for (Map<String, Object> s : schedules) nameById.put((Id) s.get('Id'), (String) s.get('Name'));
        Map<Id, List<Map<String, Object>>> byParent = new Map<Id, List<Map<String, Object>>>();
        for (Map<String, Object> t : tiers) {
            Object pid = t.get('PriceAdjustmentScheduleId');
            if (pid == null) continue;
            if (!byParent.containsKey((Id) pid)) byParent.put((Id) pid, new List<Map<String, Object>>());
            byParent.get((Id) pid).add(t);
        }
        Set<Id> badScheduleIds = new Set<Id>();
        for (Id pid : byParent.keySet()) {
            List<Map<String, Object>> grp = sortByLower(byParent.get(pid));
            for (Integer i = 0; i < grp.size() - 1 && !badScheduleIds.contains(pid); i++) {
                Decimal currUpper = toDec(grp[i].get('UpperBound'));
                Decimal nextLower = toDec(grp[i + 1].get('LowerBound'));
                if (currUpper == null) currUpper = 999999999.0;
                if (nextLower == null) nextLower = 0;
                if (currUpper > nextLower) badScheduleIds.add(pid);
            }
        }
        if (badScheduleIds.isEmpty()) return new List<DetectorResult>();
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Id pid : badScheduleIds) {
            bad.add(new SourceRecord('PriceAdjustmentSchedule', pid,
                nameById.containsKey(pid) ? nameById.get(pid) : 'Schedule'));
        }
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-003'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' schedule(s) with overlapping tiers';
        dr.description = 'Overlapping quantity ranges cause ambiguous discount application.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    static Decimal toDec(Object o) { return o == null ? null : (Decimal) o; }
    static List<Map<String, Object>> sortByLower(List<Map<String, Object>> raw) {
        List<Map<String, Object>> sorted = new List<Map<String, Object>>(raw);
        for (Integer i = 1; i < sorted.size(); i++) {
            Map<String, Object> key = sorted[i];
            Decimal keyV = toDec(key.get('LowerBound')); if (keyV == null) keyV = 0;
            Integer j = i - 1;
            while (j >= 0) {
                Decimal jV = toDec(sorted[j].get('LowerBound')); if (jV == null) jV = 0;
                if (jV <= keyV) break;
                sorted[j + 1] = sorted[j];
                j--;
            }
            sorted[j + 1] = key;
        }
        return sorted;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM016(List<Map<String, Object>> schedules, List<Map<String, Object>> tiers) {
        Set<Id> hasTier = new Set<Id>();
        for (Map<String, Object> t : tiers) {
            Object pid = t.get('PriceAdjustmentScheduleId');
            if (pid != null) hasTier.add((Id) pid);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> s : schedules) {
            if (!Boolean.valueOf(s.get('IsActive'))) continue;
            if (hasTier.contains((Id) s.get('Id'))) continue;
            bad.add(new SourceRecord('PriceAdjustmentSchedule', (Id) s.get('Id'), (String) s.get('Name')));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-016'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' active price schedule(s) with no tiers';
        dr.description = 'Schedules without tier rows produce no adjustment at runtime.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM017(List<Map<String, Object>> tiers, List<Map<String, Object>> schedules) {
        Map<Id, String> nameById = new Map<Id, String>();
        for (Map<String, Object> s : schedules) nameById.put((Id) s.get('Id'), (String) s.get('Name'));
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> t : tiers) {
            Decimal lo = toDec(t.get('LowerBound'));
            Decimal hi = toDec(t.get('UpperBound'));
            if (lo == null || hi == null) continue;
            if (!(lo > hi)) continue;
            String label = (nameById.containsKey((Id) t.get('PriceAdjustmentScheduleId'))
                ? nameById.get((Id) t.get('PriceAdjustmentScheduleId')) : 'Schedule')
                + ' (Lower ' + lo + ', Upper ' + hi + ')';
            bad.add(new SourceRecord('PriceAdjustmentTier', (Id) t.get('Id'), label));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-017'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = bad.size() + ' tier(s) with reversed quantity bounds';
        dr.description = 'LowerBound exceeds UpperBound — the tier can never match.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM020(List<Map<String, Object>> rules) {
        Date td = Date.today();
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : rules) {
            if (!Boolean.valueOf(r.get('IsActive'))) continue;
            Date ed = parseD(r.get('EffectiveEndDate'));
            if (ed == null || !(ed < td)) continue;
            bad.add(new SourceRecord('AttributeBasedAdjRule', (Id) r.get('Id'),
                (String) r.get('Name') + ' (ended ' + ed + ')'));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-020'; dr.severity = 'Info'; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = bad.size() + ' attribute rule(s) past their end date';
        dr.description = 'These rules continue to apply because they were not deactivated after expiring.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }
}
