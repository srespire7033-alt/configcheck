/**
 * Exercises HealthScoreCalculator: sqrt-curve compute, cap, fallback,
 * computeAndStore persistence, and (Phase 22e) per-category bucket
 * sub-scoring with JSON persistence.
 */
@isTest
private class HealthScoreCalculatorTest {

    @isTest
    static void compute_appliesLinearPenalty() {
        // Phase 24c — Vercel linear: 13·2 + 5·0.5 + 5·0.1 = 29 → 100-29 = 71
        System.assertEquals(71, HealthScoreCalculator.compute(13, 5, 5));
    }

    @isTest
    static void compute_messyOrgClampsToFloor() {
        // 100 crit alone = 200 penalty, capped at 300 → score 0. That's
        // the intended Vercel behavior: a wrecked org reads 0.
        Integer score = HealthScoreCalculator.compute(100, 100, 100);
        System.assertEquals(0, score, 'Penalty 250 (capped 300) → floor 0');
    }

    @isTest
    static void compute_capPreventsRunawayPenalty() {
        Integer score = HealthScoreCalculator.compute(1000, 1000, 1000);
        // Penalty 2600 → capped 300 → score 0. Cap still prevents
        // negative scores; just lands at 0 vs ~30 under the old sqrt.
        System.assertEquals(0, score);
    }

    @isTest
    static void compute_returnsHundredForZeroFindings() {
        System.assertEquals(100, HealthScoreCalculator.compute(0, 0, 0));
    }

    @isTest
    static void compute_handlesNullInputs() {
        System.assertEquals(100, HealthScoreCalculator.compute(null, null, null));
    }

    @isTest
    static void compute_fallsBackWhenFormulaMissing() {
        // Phase 24c — linear: 5·2 + 2·0.5 = 11 → 100-11 = 89
        System.assertEquals(89, HealthScoreCalculator.computeWithFormula(
            'NonExistentFormula', 5, 2, 0
        ));
    }

    @isTest
    static void computeAndStore_persistsHeadlineAndCategoryJson() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now(), CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 0, FindingCount__c = 3
        );
        insert scan;
        // PB-001 has Category__c='governance' in Detector__mdt;
        // mixing detector IDs lets us assert per-category aggregation.
        insert new List<ForensicFinding__c>{
            f(scan.Id, 'PB-001', 'Critical'),
            f(scan.Id, 'PB-001', 'Critical'),
            f(scan.Id, 'PB-001', 'Warning')
        };

        Test.startTest();
        HealthScoreCalculator.computeAndStore(scan.Id);
        Test.stopTest();

        ForensicScan__c after = [
            SELECT HealthScore__c, CategoryScoresJson__c
            FROM ForensicScan__c WHERE Id = :scan.Id
        ];
        // Phase 24k — detector-aware linear. Three findings all share
        // detectorId PB-001 (2 Critical + 1 Warning), so:
        //   distinct critical detectors = 1, distinct warning = 1
        //   penalty = 1·2 + 1·0.5 = 2.5 → score = 100 - 2.5 = 97.5,
        //   intValue() truncates to 97.
        System.assertEquals(97, after.HealthScore__c);
        System.assert(String.isNotBlank(after.CategoryScoresJson__c),
            'CategoryScoresJson__c should be populated');
        Map<String, Object> parsed = (Map<String, Object>)
            JSON.deserializeUntyped(after.CategoryScoresJson__c);
        System.assert(!parsed.isEmpty(), 'Should have at least one category');
    }

    @isTest
    static void computeCategoryScores_appliesBucketWeights() {
        // PB-001 (governance) with 2 critical + 1 warning →
        //   cat_score = 100 - 2*15 - 1*5 = 65
        ForensicScan__c scan = new ForensicScan__c(
            Status__c='Completed', ProductType__c='CPQ',
            StartedAt__c=System.now(), CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=3
        );
        insert scan;
        insert new List<ForensicFinding__c>{
            f(scan.Id, 'PB-001', 'Critical'),
            f(scan.Id, 'PB-001', 'Critical'),
            f(scan.Id, 'PB-001', 'Warning')
        };
        Map<String, Integer> cs = HealthScoreCalculator.computeCategoryScores(scan.Id);
        System.assertNotEquals(0, cs.size(), 'Map should be populated');
        // PB-001 Category__c = 'governance' per its mdt record.
        System.assert(cs.containsKey('governance'),
            'Expected key "governance", got: ' + cs.keySet());
        System.assertEquals(65, cs.get('governance'),
            'Expected 100 - 2*15 - 1*5 = 65, got ' + cs.get('governance'));
    }

    @isTest
    static void computeCategoryScores_returnsEmptyForBlankScan() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c='Completed', ProductType__c='CPQ',
            StartedAt__c=System.now(), CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=0
        );
        insert scan;
        Map<String, Integer> cs = HealthScoreCalculator.computeCategoryScores(scan.Id);
        System.assertEquals(0, cs.size(), 'Empty scan → empty map');
    }

    @isTest
    static void computeCategoryScores_clampsToZeroOnHighVolume() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c='Completed', ProductType__c='CPQ',
            StartedAt__c=System.now(), CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=50
        );
        insert scan;
        List<ForensicFinding__c> fs = new List<ForensicFinding__c>();
        for (Integer i = 0; i < 10; i++) fs.add(f(scan.Id, 'PB-001', 'Critical'));
        insert fs;
        Map<String, Integer> cs = HealthScoreCalculator.computeCategoryScores(scan.Id);
        // 10 crit × 15 = 150 deduction → clamped to 0
        System.assertEquals(0, cs.get('governance'),
            'Should clamp to 0 — got ' + cs.get('governance'));
    }

    @isTest
    static void computeCategoryScores_uncategorizedBucket() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c='Completed', ProductType__c='CPQ',
            StartedAt__c=System.now(), CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=1
        );
        insert scan;
        insert f(scan.Id, 'NON-EXISTENT-DETECTOR-Z9', 'Critical');
        Map<String, Integer> cs = HealthScoreCalculator.computeCategoryScores(scan.Id);
        System.assert(cs.containsKey('__uncategorized__'),
            'Findings with unknown detector should land in __uncategorized__');
    }

    @isTest
    static void computeAndStore_handlesNullScanId() {
        HealthScoreCalculator.computeAndStore(null);
        System.assert(true);
    }

    @isTest
    static void computeCategoryScores_handlesNullScanId() {
        Map<String, Integer> cs = HealthScoreCalculator.computeCategoryScores(null);
        System.assertEquals(0, cs.size());
    }

    private static ForensicFinding__c f(Id scanId, String detId, String sev) {
        return new ForensicFinding__c(
            ForensicScan__c = scanId, DetectorId__c = detId, Severity__c = sev,
            EntitledUsd__c = 1, RealizedUsd__c = 0, GapUsd__c = 1,
            Title__c = detId + '/' + sev, Status__c = 'Open', DetectedAt__c = System.now()
        );
    }
}
