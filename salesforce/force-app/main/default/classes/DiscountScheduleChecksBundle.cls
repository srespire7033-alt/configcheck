/**
 * Phase 22a-4 — 4 checks on SBQQ__DiscountSchedule__c (+ tier child).
 *
 *   DS-001 — Tier ranges overlap within a schedule (critical)
 *   DS-002 — Gaps between tiers (warning)
 *   DS-003 — Negative discount values (warning)
 *   DS-004 — Schedules with no tiers (info, aggregated)
 *
 * SOQL: 1 (parent + child subquery).
 */
public with sharing class DiscountScheduleChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'DS-BUNDLE'; }
    public String getLabel() { return 'Discount Schedule health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__DiscountSchedule__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] DS-BUNDLE: SBQQ__DiscountSchedule__c not present.');
                return results;
            }
            String soql =
                'SELECT Id, Name, ' +
                '  (SELECT Id, Name, SBQQ__LowerBound__c, SBQQ__UpperBound__c, SBQQ__Discount__c ' +
                '   FROM SBQQ__DiscountTiers__r ORDER BY SBQQ__LowerBound__c ASC NULLS LAST) ' +
                'FROM SBQQ__DiscountSchedule__c LIMIT 5000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] DS-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        Boolean runDS001 = DetectorCatalogController.isActive('DS-001');
        Boolean runDS002 = DetectorCatalogController.isActive('DS-002');
        Boolean runDS003 = DetectorCatalogController.isActive('DS-003');
        Boolean runDS004 = DetectorCatalogController.isActive('DS-004');

        if (runDS001) results.addAll(evaluateDS001(rows));
        if (runDS002) results.addAll(evaluateDS002(rows));
        if (runDS003) results.addAll(evaluateDS003(rows));
        if (runDS004) results.addAll(evaluateDS004(rows));
        return results;
    }

    static List<Map<String, Object>> tiersOf(Map<String, Object> sched) {
        Object o = sched.get('SBQQ__DiscountTiers__r');
        if (o == null) return new List<Map<String, Object>>();
        Object recs = ((Map<String, Object>) o).get('records');
        if (recs == null) return new List<Map<String, Object>>();
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Object r : (List<Object>) recs) out.add((Map<String, Object>) r);
        return out;
    }
    static Decimal num(Map<String, Object> tier, String key) {
        Object v = tier.get(key);
        return (v == null) ? null : Decimal.valueOf(String.valueOf(v));
    }
    static SourceRecord schedRef(Map<String, Object> s) {
        return new SourceRecord('SBQQ__DiscountSchedule__c', (Id) s.get('Id'), (String) s.get('Name'));
    }
    static SourceRecord tierRef(Map<String, Object> t) {
        return new SourceRecord('SBQQ__DiscountTier__c', (Id) t.get('Id'), (String) t.get('Name'));
    }

    // ── DS-001: pairwise overlap ──────────────────────────────────

    @TestVisible
    static List<DetectorResult> evaluateDS001(List<Map<String, Object>> schedules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> sched : schedules) {
            List<Map<String, Object>> tiers = tiersOf(sched);
            if (tiers.size() < 2) continue;
            for (Integer i = 0; i < tiers.size(); i++) {
                Map<String, Object> a = tiers[i];
                Decimal aLo = num(a, 'SBQQ__LowerBound__c');
                Decimal aHi = num(a, 'SBQQ__UpperBound__c');
                if (aLo == null || aHi == null) continue;
                for (Integer j = i + 1; j < tiers.size(); j++) {
                    Map<String, Object> b = tiers[j];
                    Decimal bLo = num(b, 'SBQQ__LowerBound__c');
                    Decimal bHi = num(b, 'SBQQ__UpperBound__c');
                    if (bLo == null || bHi == null) continue;
                    if (aLo < bHi && bLo < aHi) {
                        DetectorResult r = new DetectorResult();
                        r.detectorId = 'DS-001';
                        r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Critical');
                        r.gapUsd = 0;
                        r.recoverabilityScore = 0.9;
                        r.title = 'Overlapping discount tiers in "' + (String) sched.get('Name') + '"';
                        r.description = 'Tier "' + (String) a.get('Name') + '" (' + aLo + '-' + aHi +
                            ') overlaps with Tier "' + (String) b.get('Name') + '" (' + bLo + '-' + bHi +
                            '). Quantities in the overlap range may get the wrong discount.';
                        r.primaryRecord = schedRef(sched);
                        r.supportingRecords.add(tierRef(a));
                        r.supportingRecords.add(tierRef(b));
                        out.add(r);
                    }
                }
            }
        }
        return out;
    }

    // ── DS-002: gaps between adjacent tiers (sorted) ──────────────

    @TestVisible
    static List<DetectorResult> evaluateDS002(List<Map<String, Object>> schedules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> sched : schedules) {
            List<Map<String, Object>> tiers = tiersOf(sched);
            if (tiers.size() < 2) continue;
            for (Integer i = 0; i < tiers.size() - 1; i++) {
                Map<String, Object> currentTier = tiers[i];
                Map<String, Object> nextTier = tiers[i + 1];
                Decimal curHi = num(currentTier, 'SBQQ__UpperBound__c');
                Decimal nextLo = num(nextTier, 'SBQQ__LowerBound__c');
                if (curHi == null || nextLo == null) continue;
                if (curHi >= nextLo) continue;
                DetectorResult r = new DetectorResult();
                r.detectorId = 'DS-002';
                r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
                r.gapUsd = 0;
                r.recoverabilityScore = 0.9;
                r.title = 'Discount tier gap in "' + (String) sched.get('Name') + '"';
                r.description = 'No tier covers quantities ' + curHi + ' to ' + nextLo +
                    '. Quantities in this range will receive zero discount.';
                r.primaryRecord = schedRef(sched);
                r.supportingRecords.add(tierRef(currentTier));
                r.supportingRecords.add(tierRef(nextTier));
                out.add(r);
            }
        }
        return out;
    }

    // ── DS-003: negative tier discount ────────────────────────────

    @TestVisible
    static List<DetectorResult> evaluateDS003(List<Map<String, Object>> schedules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> sched : schedules) {
            for (Map<String, Object> tier : tiersOf(sched)) {
                Decimal d = num(tier, 'SBQQ__Discount__c');
                if (d == null || d >= 0) continue;
                DetectorResult r = new DetectorResult();
                r.detectorId = 'DS-003';
                r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
                r.gapUsd = 0;
                r.recoverabilityScore = 0.95;
                r.title = 'Negative discount in "' + (String) sched.get('Name') + '"';
                r.description = 'Tier "' + (String) tier.get('Name') + '" applies ' + d +
                    '% (a surcharge, not a discount). This increases the price instead of reducing it.';
                r.primaryRecord = schedRef(sched);
                r.supportingRecords.add(tierRef(tier));
                out.add(r);
            }
        }
        return out;
    }

    // ── DS-004: schedules with no tiers ──────────────────────────

    @TestVisible
    static List<DetectorResult> evaluateDS004(List<Map<String, Object>> schedules) {
        List<SourceRecord> empties = new List<SourceRecord>();
        for (Map<String, Object> sched : schedules) {
            if (tiersOf(sched).isEmpty()) empties.add(schedRef(sched));
        }
        if (empties.isEmpty()) return new List<DetectorResult>();
        List<String> names = new List<String>();
        for (SourceRecord sr : empties) names.add('"' + sr.name + '"');
        DetectorResult r = new DetectorResult();
        r.detectorId = 'DS-004';
        r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Info');
        r.gapUsd = 0;
        r.recoverabilityScore = 1.0;
        r.title = empties.size() + ' discount schedule(s) with no tiers';
        r.description = String.join(names, ', ') + ' exist but have no discount tiers configured.';
        r.primaryRecord = empties[0];
        Integer cap = Math.min(50, empties.size());
        for (Integer i = 1; i < cap; i++) r.supportingRecords.add(empties[i]);
        return new List<DetectorResult>{ r };
    }
}
