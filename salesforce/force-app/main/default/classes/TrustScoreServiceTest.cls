/**
 * Phase 15c — Trust Scores tests.
 */
@IsTest
private class TrustScoreServiceTest {

    private static ForensicScan__c newScan() {
        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now(), CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 0, FindingCount__c = 0
        );
        insert s;
        return s;
    }

    private static ForensicFinding__c addFinding(Id scanId, String detector, String status) {
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c = scanId, DetectorId__c = detector,
            Severity__c = 'Warning', Title__c = detector + ' finding',
            Status__c = status, DetectedAt__c = System.now(),
            GapUsd__c = 100, RecoverabilityScore__c = 0.8
        );
        insert f;
        return f;
    }

    @IsTest
    static void computeScore_returns_null_below_min_sample() {
        System.assertEquals(null, TrustScoreService.computeScore(4, 0, 0, 0));
        System.assertEquals(null, TrustScoreService.computeScore(null, 0, 0, 0));
    }

    @IsTest
    static void computeScore_perfect_history_returns_one() {
        // 10 findings, 0 suppressed, 10 recovered, 0 regressed.
        // recoveryRate=1.0, suppressionRate=0.0 → 0.7*1 + 0.3*1 = 1.0
        System.assertEquals(1.0, TrustScoreService.computeScore(10, 0, 10, 0));
    }

    @IsTest
    static void computeScore_all_regressed_floors_low() {
        // 10 findings, 0 suppressed, 0 recovered, 10 regressed.
        // recoveryRate=0, suppressionRate=0 → 0.7*0 + 0.3*1 = 0.30
        System.assertEquals(0.30, TrustScoreService.computeScore(10, 0, 0, 10));
    }

    @IsTest
    static void computeScore_high_suppression_drops_score() {
        // 10 findings, 8 suppressed, 2 recovered, 0 regressed.
        // recoveryRate=1, suppressionRate=0.8 → 0.7*1 + 0.3*0.2 = 0.76
        System.assertEquals(0.76, TrustScoreService.computeScore(10, 8, 2, 0));
    }

    @IsTest
    static void recompute_upserts_one_row_per_detector() {
        ForensicScan__c s = newScan();
        for (Integer i = 0; i < 6; i++) addFinding(s.Id, 'REN-001', 'Open');
        for (Integer i = 0; i < 3; i++) addFinding(s.Id, 'DSC-FOR-001', 'Open');

        Test.startTest();
        Integer n = TrustScoreService.recompute();
        Test.stopTest();

        System.assertEquals(2, n);
        Map<String, TrustScore__c> byKey = new Map<String, TrustScore__c>();
        for (TrustScore__c t : [SELECT Id, DetectorId__c, FindingCount__c, Score__c, LastComputedAt__c FROM TrustScore__c]) {
            byKey.put(t.DetectorId__c, t);
        }
        System.assertEquals(6, byKey.get('REN-001').FindingCount__c);
        System.assertNotEquals(null, byKey.get('REN-001').Score__c, 'REN-001 has 6 findings ≥ MIN_SAMPLE');
        System.assertEquals(3, byKey.get('DSC-FOR-001').FindingCount__c);
        System.assertEquals(null, byKey.get('DSC-FOR-001').Score__c, 'DSC-FOR-001 has 3 findings < MIN_SAMPLE → null score');
    }

    @IsTest
    static void recompute_idempotent_updates_existing_rows() {
        ForensicScan__c s = newScan();
        for (Integer i = 0; i < 6; i++) addFinding(s.Id, 'REN-001', 'Open');

        TrustScoreService.recompute();
        TrustScore__c before1 = [SELECT Id, LastComputedAt__c FROM TrustScore__c WHERE DetectorId__c = 'REN-001' LIMIT 1];

        // Add more findings, recompute again — same row should update.
        for (Integer i = 0; i < 4; i++) addFinding(s.Id, 'REN-001', 'Open');
        TrustScoreService.recompute();

        List<TrustScore__c> after1 = [SELECT Id, FindingCount__c FROM TrustScore__c WHERE DetectorId__c = 'REN-001'];
        System.assertEquals(1, after1.size(), 'Should still be one row, not duplicated');
        System.assertEquals(10, after1[0].FindingCount__c);
        System.assertEquals(before1.Id, after1[0].Id);
    }

    @IsTest
    static void recompute_counts_suppressed_findings() {
        ForensicScan__c s = newScan();
        for (Integer i = 0; i < 5; i++) addFinding(s.Id, 'REN-002', 'Open');
        for (Integer i = 0; i < 3; i++) addFinding(s.Id, 'REN-002', 'False Positive');

        TrustScoreService.recompute();
        TrustScore__c t = [SELECT FindingCount__c, SuppressedCount__c
                          FROM TrustScore__c WHERE DetectorId__c = 'REN-002' LIMIT 1];
        System.assertEquals(8, t.FindingCount__c);
        System.assertEquals(3, t.SuppressedCount__c);
    }

    @IsTest
    static void getAllScores_returns_sorted_list() {
        ForensicScan__c s = newScan();
        for (Integer i = 0; i < 6; i++) addFinding(s.Id, 'AAA-001', 'Open');
        for (Integer i = 0; i < 6; i++) addFinding(s.Id, 'BBB-001', 'False Positive');
        TrustScoreService.recompute();

        List<TrustScore__c> scores = TrustScoreService.getAllScores();
        System.assertEquals(2, scores.size());
        // AAA has 0% suppression → higher score; should come first.
        System.assertEquals('AAA-001', scores[0].DetectorId__c);
    }

    @IsTest
    static void recompute_zero_findings_emits_zero_rows() {
        Integer n = TrustScoreService.recompute();
        System.assertEquals(0, n);
    }
}
