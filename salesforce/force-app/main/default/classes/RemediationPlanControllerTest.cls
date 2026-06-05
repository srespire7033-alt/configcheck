@isTest
private class RemediationPlanControllerTest {

    @isTest
    static void emptyOrgReturnsDefault() {
        Test.startTest();
        RemediationPlanController.PlanDto dto = RemediationPlanController.getPlan(null);
        Test.stopTest();
        System.assertNotEquals(null, dto);
        System.assertEquals(100, dto.currentScore);
        System.assertEquals(0, dto.totalAnnualLeakage);
        System.assertEquals(0, dto.phases.size());
    }

    @isTest
    static void bucketsByEffortAndOrdersByRecovered() {
        ForensicScan__c scan = new ForensicScan__c(Status__c='Completed',
            CompletedAt__c=System.now(), TotalLeakageUsd__c=0, FindingCount__c=4,
            HealthScore__c=71);
        insert scan;
        // REN-003 (low effort), REN-001 (medium), ORD-FOR-001 (high), OPP-FOR-001 (low)
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-003',
                Title__c='a', Severity__c='Warning', GapUsd__c=50000,
                EntitledUsd__c=50000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
                Title__c='b', Severity__c='Critical', GapUsd__c=100000,
                EntitledUsd__c=100000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='ORD-FOR-001',
                Title__c='c', Severity__c='Critical', GapUsd__c=200000,
                EntitledUsd__c=200000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='OPP-FOR-001',
                Title__c='d', Severity__c='Info', GapUsd__c=10000,
                EntitledUsd__c=10000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now())
        };

        Test.startTest();
        RemediationPlanController.PlanDto dto = RemediationPlanController.getPlan(null);
        Test.stopTest();

        System.assertEquals(71, dto.currentScore);
        System.assertEquals(360000, dto.totalAnnualLeakage);
        System.assertEquals(3, dto.phases.size(), 'All 3 phases populated');
        // Phase 1 (Highest ROI / low effort): REN-003 + OPP-FOR-001, sorted REN-003 first (50K > 10K)
        RemediationPlanController.Phase p1 = dto.phases[0];
        System.assertEquals(1, p1.phaseNum);
        System.assertEquals(2, p1.steps.size());
        System.assertEquals('REN-003', p1.steps[0].detectorId);
        System.assertEquals(60000, p1.totalRecovered);
        // Phase 2 (Core / medium): REN-001
        RemediationPlanController.Phase p2 = dto.phases[1];
        System.assertEquals(1, p2.steps.size());
        System.assertEquals('REN-001', p2.steps[0].detectorId);
        // Phase 3 (Strategic / high): ORD-FOR-001
        RemediationPlanController.Phase p3 = dto.phases[2];
        System.assertEquals(1, p3.steps.size());
        System.assertEquals('ORD-FOR-001', p3.steps[0].detectorId);
        System.assert(p3.steps[0].recommendation.contains('Charge Type'),
            'Detector-specific fix prose surfaces');
    }
}
