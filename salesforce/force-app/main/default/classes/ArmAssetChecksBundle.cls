/** Phase 22c-3 — Asset/AssetStatePeriod/AssetRelationship: ARM-031..035. */
public with sharing class ArmAssetChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubAssets;
    @TestVisible static List<Map<String, Object>> testStubStatePeriods;
    @TestVisible static List<Map<String, Object>> testStubRelations;

    public String getDetectorId() { return 'ARM-ASSET-BUNDLE'; }
    public String getLabel() { return 'ARM Asset health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> assets, periods, rels;
        Boolean usingStubs = (testStubAssets != null || testStubStatePeriods != null || testStubRelations != null);
        if (usingStubs) {
            assets  = testStubAssets       != null ? testStubAssets       : new List<Map<String, Object>>();
            periods = testStubStatePeriods != null ? testStubStatePeriods : new List<Map<String, Object>>();
            rels    = testStubRelations    != null ? testStubRelations    : new List<Map<String, Object>>();
        } else {
            // Gate on AssetStatePeriod (RC-only) — Asset itself is universal.
            if (!ctx.isRemote() && !SchemaUtil.hasObject('AssetStatePeriod')) return results;
            try {
                String endDateField = SchemaUtil.hasField('Asset', 'CurrentLifecycleEndDate')
                    ? ', CurrentLifecycleEndDate' : '';
                assets = OrgQueryService.query(ctx,
                    'SELECT Id, Name, Status' + endDateField + ' FROM Asset LIMIT 10000');
                periods = OrgQueryService.query(ctx,
                    'SELECT Id, AssetId, IsCurrent, Quantity FROM AssetStatePeriod LIMIT 10000');
                rels = SchemaUtil.hasObject('AssetRelationship')
                    ? OrgQueryService.query(ctx,
                        'SELECT Id, AssetId, RelatedAssetId, RelatedAsset.Status FROM AssetRelationship LIMIT 10000')
                    : new List<Map<String, Object>>();
            } catch (Exception e) { return results; }
        }
        if (DetectorCatalogController.isActive('ARM-031')) results.addAll(evaluateARM031(assets, periods));
        if (DetectorCatalogController.isActive('ARM-032')) results.addAll(evaluateARM032(assets));
        if (DetectorCatalogController.isActive('ARM-033')) results.addAll(evaluateARM033(rels));
        if (DetectorCatalogController.isActive('ARM-034')) results.addAll(evaluateARM034(periods));
        if (DetectorCatalogController.isActive('ARM-035')) results.addAll(evaluateARM035(periods));
        return results;
    }

    static Date parseD(Object o) {
        if (o == null) return null;
        if (o instanceof Date) return (Date) o;
        String s = String.valueOf(o);
        if (s.length() >= 10) s = s.substring(0, 10);
        try { return Date.valueOf(s); } catch (Exception e) { return null; }
    }
    static Set<String> ACTIVE_ASSET_STATUSES = new Set<String>{ 'Active', 'Shipped', 'Installed' };

    @TestVisible
    static List<DetectorResult> evaluateARM031(List<Map<String, Object>> assets, List<Map<String, Object>> periods) {
        Set<Id> assetsWithPeriod = new Set<Id>();
        for (Map<String, Object> p : periods) {
            Object aid = p.get('AssetId');
            if (aid != null) assetsWithPeriod.add((Id) aid);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> a : assets) {
            if (!ACTIVE_ASSET_STATUSES.contains(String.valueOf(a.get('Status')))) continue;
            if (assetsWithPeriod.contains((Id) a.get('Id'))) continue;
            bad.add(new SourceRecord('Asset', (Id) a.get('Id'), String.valueOf(a.get('Name'))));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-031'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' active asset(s) without state period';
        dr.description = 'Assets in active state should have at least one AssetStatePeriod row for revenue accounting.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(25, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM032(List<Map<String, Object>> assets) {
        Date td = Date.today();
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> a : assets) {
            if (String.valueOf(a.get('Status')) != 'Active') continue;
            Date ed = parseD(a.get('CurrentLifecycleEndDate'));
            if (ed == null || !(ed < td)) continue;
            bad.add(new SourceRecord('Asset', (Id) a.get('Id'),
                String.valueOf(a.get('Name')) + ' (ended ' + ed + ')'));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-032'; dr.severity = 'Info'; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = bad.size() + ' active asset(s) past lifecycle end date';
        dr.description = 'These assets should be moved to a terminal state or have their dates extended.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(25, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM033(List<Map<String, Object>> rels) {
        Set<String> bad_statuses = new Set<String>{ 'Cancelled', 'Expired', 'Terminated' };
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> r : rels) {
            Object related = r.get('RelatedAssetId');
            String relStatus = null;
            Object relAsset = r.get('RelatedAsset');
            if (relAsset instanceof Map<String, Object>) {
                Object st = ((Map<String, Object>) relAsset).get('Status');
                if (st != null) relStatus = String.valueOf(st);
            }
            if (related != null && (relStatus == null || !bad_statuses.contains(relStatus))) continue;
            bad.add(new SourceRecord('AssetRelationship', (Id) r.get('Id'),
                related == null ? 'Null target' : ('Target ' + relStatus)));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-033'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' orphan asset relationship(s)';
        dr.description = 'AssetRelationship rows point to null or terminal-status assets.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(25, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM034(List<Map<String, Object>> periods) {
        Map<Id, Integer> currentByAsset = new Map<Id, Integer>();
        for (Map<String, Object> p : periods) {
            if (!Boolean.valueOf(p.get('IsCurrent'))) continue;
            Object aid = p.get('AssetId');
            if (aid == null) continue;
            currentByAsset.put((Id) aid,
                (currentByAsset.containsKey((Id) aid) ? currentByAsset.get((Id) aid) : 0) + 1);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Id aid : currentByAsset.keySet()) {
            if (currentByAsset.get(aid) <= 1) continue;
            bad.add(new SourceRecord('Asset', aid, 'Asset (' + currentByAsset.get(aid) + ' current periods)'));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-034'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = bad.size() + ' asset(s) with multiple current state periods';
        dr.description = 'Each asset should have exactly one IsCurrent=true AssetStatePeriod at a time.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(25, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM035(List<Map<String, Object>> periods) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : periods) {
            if (!Boolean.valueOf(p.get('IsCurrent'))) continue;
            Object q = p.get('Quantity');
            Decimal dq = q == null ? null : (Decimal) q;
            if (dq != null && dq != 0) continue;
            bad.add(new SourceRecord('AssetStatePeriod', (Id) p.get('Id'), 'Zero quantity'));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-035'; dr.severity = 'Info'; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = bad.size() + ' current asset state period(s) with zero quantity';
        dr.description = 'Current state periods with null/zero quantity may indicate billing-schedule issues.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(25, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }
}
