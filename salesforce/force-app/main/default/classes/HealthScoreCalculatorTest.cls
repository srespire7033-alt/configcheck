/**
 * Exercises HealthScoreCalculator: sqrt-curve compute, cap, fallback,
 * computeAndStore persistence, and (Phase 22e) per-category bucket
 * sub-scoring with JSON persistence.
 */
@isTest
private class HealthScoreCalculatorTest {

    @isTest
    static void compute_appliesSqrtCurve() {
        // 13 crit + 5 warn + 5 info → raw 29 → 4·sqrt(29) ≈ 21.5 → 78
        System.assertEquals(78, HealthScoreCalculator.compute(13, 5, 5));
    }

    @isTest
    static void compute_messyOrgStaysAboveZero() {
        Integer score = HealthScoreCalculator.compute(100, 100, 100);
        System.assert(score > 0, 'Should not clamp to 0 — got ' + score);
        System.assert(score < 50, 'Should still indicate "broken" — got ' + score);
    }

    @isTest
    static void compute_capPreventsRunawayPenalty() {
        Integer score = HealthScoreCalculator.compute(1000, 1000, 1000);
        System.assert(score >= 28 && score <= 33, 'Expected floor ~30, got ' + score);
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
        // 5 crit + 2 warn = raw 11 → 4·sqrt(11) ≈ 13.3 → 86
        System.assertEquals(86, HealthScoreCalculator.computeWithFormula(
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
        // Headline: 2 crit + 1 warn → raw 4.5 → penalty 4·sqrt(4.5) ≈ 8.49 → 91
        System.assertEquals(91, after.HealthScore__c);
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
