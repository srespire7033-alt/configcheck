/**
 * Phase 22c-2 — Rate cards + Pricing procedures + Decision tables (7 checks).
 *
 *   ARM-021 — Active rate card with no entries (warning)
 *   ARM-022 — Rate card entry with no/zero price (warning)
 *   ARM-023 — Expired rate card still active (info)
 *   ARM-006 — Pricing procedure missing UsageType (warning)
 *            (Apex re-queries ExpressionSet WITHOUT the UsageType filter the
 *             SaaS bulk query has, which would otherwise mask this check.)
 *   ARM-027 — Multiple active pricing procedures (info)
 *   ARM-008 — Decision tables not Active (warning)
 *   ARM-029 — All decision tables are Draft (warning)
 */
public with sharing class ArmRateCardProcedureChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRateCards;
    @TestVisible static List<Map<String, Object>> testStubRateCardEntries;
    @TestVisible static List<Map<String, Object>> testStubExpressionSetsAll;
    @TestVisible static List<Map<String, Object>> testStubDecisionTables;

    public String getDetectorId() { return 'ARM-PRICING-BUNDLE'; }
    public String getLabel() { return 'ARM Rate Card + Procedure + Decision Table checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> rateCards;
        List<Map<String, Object>> rateCardEntries;
        List<Map<String, Object>> procedures;
        List<Map<String, Object>> dts;
        Boolean usingStubs = (testStubRateCards != null || testStubRateCardEntries != null
            || testStubExpressionSetsAll != null || testStubDecisionTables != null);
        if (usingStubs) {
            rateCards       = testStubRateCards          != null ? testStubRateCards          : new List<Map<String, Object>>();
            rateCardEntries = testStubRateCardEntries    != null ? testStubRateCardEntries    : new List<Map<String, Object>>();
            procedures      = testStubExpressionSetsAll  != null ? testStubExpressionSetsAll  : new List<Map<String, Object>>();
            dts             = testStubDecisionTables     != null ? testStubDecisionTables     : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('RateCard')
                && !SchemaUtil.hasObject('ExpressionSet')
                && !SchemaUtil.hasObject('DecisionTable')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] ARM-PRICING-BUNDLE: no RC pricing surface.');
                return results;
            }
            // Phase 22i — local hasObject check doesn't tell us about the
            // remote target org's schema. Use queryWithFallback with
            // loose=null so missing-object failures return empty cleanly
            // (older RC releases may not have RateCardEntry as a separate
            // queryable type). Remote scans always attempt; local scans
            // still benefit from the hasObject pre-gate.
            // Phase 23z-6 — use minimal universal field set. RateCard
            // schema varies across releases; EffectiveFrom + EffectiveTo
            // are present in all versions we've seen. evaluateARM021/023
            // now infer "active" from the effective window when IsActive
            // isn't returned (it'll be null in the row map).
            rateCards = (ctx.isRemote() || SchemaUtil.hasObject('RateCard'))
                ? OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, Name, EffectiveFrom, EffectiveTo FROM RateCard LIMIT 5000', null)
                : new List<Map<String, Object>>();
            rateCardEntries = (ctx.isRemote() || SchemaUtil.hasObject('RateCardEntry'))
                ? OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, RateCardId, Price FROM RateCardEntry LIMIT 10000', null)
                : new List<Map<String, Object>>();
            procedures = (ctx.isRemote() || SchemaUtil.hasObject('ExpressionSet'))
                ? OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, ApiName, UsageType FROM ExpressionSet LIMIT 5000', null)
                : new List<Map<String, Object>>();
            dts = (ctx.isRemote() || SchemaUtil.hasObject('DecisionTable'))
                ? OrgQueryService.queryWithFallback(ctx,
                    'SELECT Id, MasterLabel, Status FROM DecisionTable LIMIT 5000', null)
                : new List<Map<String, Object>>();
        }

        if (DetectorCatalogController.isActive('ARM-021')) results.addAll(evaluateARM021(rateCards, rateCardEntries));
        if (DetectorCatalogController.isActive('ARM-022')) results.addAll(evaluateARM022(rateCardEntries, rateCards));
        if (DetectorCatalogController.isActive('ARM-023')) results.addAll(evaluateARM023(rateCards));
        if (DetectorCatalogController.isActive('ARM-006')) results.addAll(evaluateARM006(procedures));
        if (DetectorCatalogController.isActive('ARM-027')) results.addAll(evaluateARM027(procedures));
        if (DetectorCatalogController.isActive('ARM-008')) results.addAll(evaluateARM008(dts));
        if (DetectorCatalogController.isActive('ARM-029')) results.addAll(evaluateARM029(dts));
        return results;
    }

    static Date parseD(Object o) {
        if (o == null) return null;
        if (o instanceof Date) return (Date) o;
        String s = String.valueOf(o);
        if (s.length() >= 10) s = s.substring(0, 10);
        try { return Date.valueOf(s); } catch (Exception e) { return null; }
    }

    @TestVisible
    static List<DetectorResult> evaluateARM021(List<Map<String, Object>> cards, List<Map<String, Object>> entries) {
        Set<Id> cardsWithEntries = new Set<Id>();
        for (Map<String, Object> e : entries) {
            Object cid = e.get('RateCardId');
            if (cid != null) cardsWithEntries.add((Id) cid);
        }
        // Phase 23z-6 — some orgs don't surface RateCard.IsActive in
        // describe (it may be a system field or behind a flag). Fall back
        // to checking EffectiveFrom <= today < EffectiveTo (or no end).
        Date today = Date.today();
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> c : cards) {
            Boolean isActive;
            Object iaRaw = c.get('IsActive');
            if (iaRaw != null) {
                isActive = Boolean.valueOf(iaRaw);
            } else {
                Date eFrom = parseD(c.get('EffectiveFrom'));
                Date eTo   = parseD(c.get('EffectiveTo'));
                isActive = (eFrom == null || !(eFrom > today))
                        && (eTo   == null || !(eTo   < today));
            }
            if (!isActive) continue;
            if (cardsWithEntries.contains((Id) c.get('Id'))) continue;
            bad.add(new SourceRecord('RateCard', (Id) c.get('Id'), (String) c.get('Name')));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-021', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-021'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' active rate card(s) with no entries');
            dr.description = 'Rate cards without entries cannot price anything.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM022(List<Map<String, Object>> entries, List<Map<String, Object>> cards) {
        Map<Id, String> cardNames = new Map<Id, String>();
        for (Map<String, Object> c : cards) cardNames.put((Id) c.get('Id'), (String) c.get('Name'));
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> e : entries) {
            Object pr = e.get('Price');
            Decimal v = pr == null ? null : (Decimal) pr;
            if (v != null && v != 0) continue;
            String label = cardNames.containsKey((Id) e.get('RateCardId'))
                ? cardNames.get((Id) e.get('RateCardId')) : 'Entry';
            bad.add(new SourceRecord('RateCardEntry', (Id) e.get('Id'), label));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-022', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-022'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' rate card entry(s) with no price');
            dr.description = 'Entries with null or zero price will not produce revenue.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM023(List<Map<String, Object>> cards) {
        Date td = Date.today();
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> c : cards) {
            // Phase 23z-6 — IsActive may be null when the org's RC version
            // doesn't expose it; treat as active when null and infer from
            // effective window.
            Object iaRaw = c.get('IsActive');
            Boolean isActive = iaRaw == null ? true : Boolean.valueOf(iaRaw);
            if (!isActive) continue;
            // Older RC: EffectiveEndDate; newer RC: EffectiveTo.
            Date ed = parseD(c.get('EffectiveEndDate'));
            if (ed == null) ed = parseD(c.get('EffectiveTo'));
            if (ed == null || !(ed < td)) continue;
            bad.add(new SourceRecord('RateCard', (Id) c.get('Id'), (String) c.get('Name') + ' (ended ' + ed + ')'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-023', 'Info');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-023'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
            dr.title = '"' + dsr.name + '" — ' + (' rate card(s) past end date but active');
            dr.description = 'Deactivate rate cards once they expire.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM006(List<Map<String, Object>> procs) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : procs) {
            Object ut = p.get('UsageType');
            if (ut != null && !String.isBlank(String.valueOf(ut))) continue;
            bad.add(new SourceRecord('ExpressionSet', (Id) p.get('Id'),
                p.get('ApiName') == null ? 'Procedure' : (String) p.get('ApiName')));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-006', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-006'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' pricing procedure(s) without UsageType');
            dr.description = 'ExpressionSet records without UsageType won\'t route to the pricing engine.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM027(List<Map<String, Object>> procs) {
        List<Map<String, Object>> pricing = new List<Map<String, Object>>();
        for (Map<String, Object> p : procs) {
            if (String.valueOf(p.get('UsageType')) == 'Pricing') pricing.add(p);
        }
        if (pricing.size() <= 1) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-027'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = pricing.size() + ' pricing procedures defined';
        dr.description = 'Multiple active pricing procedures may produce non-deterministic results.';
        dr.primaryRecord = new SourceRecord('ExpressionSet', (Id) pricing[0].get('Id'),
            (String) pricing[0].get('ApiName'));
        Integer cap = Math.min(5, pricing.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(
            new SourceRecord('ExpressionSet', (Id) pricing[i].get('Id'), (String) pricing[i].get('ApiName')));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM008(List<Map<String, Object>> dts) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> d : dts) {
            String st = String.valueOf(d.get('Status'));
            if (st == 'Active') continue;
            bad.add(new SourceRecord('DecisionTable', (Id) d.get('Id'),
                String.valueOf(d.get('MasterLabel')) + ' (' + st + ')'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-008', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-008'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' decision table(s) not Active');
            dr.description = 'Decision tables in Draft/Inactive status will not be evaluated by the engine.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM029(List<Map<String, Object>> dts) {
        if (dts.isEmpty()) return new List<DetectorResult>();
        for (Map<String, Object> d : dts) if (String.valueOf(d.get('Status')) == 'Active') return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-029'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = dts.size() + ' decision table(s) — none active';
        dr.description = 'Every decision table in this org is Draft/Inactive. Pricing/eligibility logic will be skipped.';
        dr.primaryRecord = new SourceRecord('DecisionTable', (Id) dts[0].get('Id'), String.valueOf(dts[0].get('MasterLabel')));
        for (Integer i = 1; i < dts.size(); i++) dr.supportingRecords.add(
            new SourceRecord('DecisionTable', (Id) dts[i].get('Id'), String.valueOf(dts[i].get('MasterLabel'))));
        return new List<DetectorResult>{ dr };
    }
}
