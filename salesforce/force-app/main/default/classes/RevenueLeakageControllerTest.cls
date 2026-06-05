@isTest
private class RevenueLeakageControllerTest {

    @isTest
    static void emptyOrgReturnsZeros() {
        Test.startTest();
        RevenueLeakageController.LeakageDto dto = RevenueLeakageController.getLeakage();
        Test.stopTest();
        System.assertEquals(0, dto.totalVerifiedUsd);
        System.assertEquals(0, dto.findingCount);
        System.assertEquals('low', dto.confidence);
        System.assertEquals(0, dto.biggestLeaks.size());
        System.assertEquals(0, dto.themes.size(), 'No scan → no themes at all');
    }

    @isTest
    static void bucketsByThemeAndPopulatesTopThree() {
        ForensicScan__c scan = new ForensicScan__c(Status__c='Completed',
            CompletedAt__c=System.now(), TotalLeakageUsd__c=0, FindingCount__c=12);
        insert scan;
        List<ForensicFinding__c> fs = new List<ForensicFinding__c>();
        // 4 renewals findings
        for (Integer i = 0; i < 4; i++) {
            fs.add(new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
                Title__c='Renewal '+i, Severity__c='Critical', GapUsd__c=10000 - i*1000,
                EntitledUsd__c=10000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()));
        }
        // 2 discounting
        for (Integer i = 0; i < 2; i++) {
            fs.add(new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='DSC-FOR-001',
                Title__c='Discount '+i, Severity__c='Warning', GapUsd__c=3000,
                EntitledUsd__c=3000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()));
        }
        // 1 in "other" (no matching theme - use a detector not in any theme)
        fs.add(new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='OPP-FOR-001',
            Title__c='Opp gap', Severity__c='Info', GapUsd__c=500,
            EntitledUsd__c=500, RealizedUsd__c=0,
            Status__c='Open', DetectedAt__c=System.now()));
        insert fs;

        Test.startTest();
        RevenueLeakageController.LeakageDto dto = RevenueLeakageController.getLeakage();
        Test.stopTest();

        System.assertEquals(7, dto.findingCount);
        // 5 named themes + 1 "other" because OPP-FOR-001 isn't in any named theme
        System.assertEquals(6, dto.themes.size());
        // Renewals theme should have 4 findings, top 3 only in list
        RevenueLeakageController.Theme renewals = dto.themes[0];
        System.assertEquals('Renewals', renewals.label);
        System.assertEquals(4, renewals.count);
        System.assertEquals(3, renewals.topThree.size());
        System.assertEquals(1, renewals.moreCount);
        // Biggest leaks top 5 sorted by gap desc — first one is 10000
        System.assertEquals(5, dto.biggestLeaks.size());
        System.assertEquals(10000, dto.biggestLeaks[0].gapUsd);
        // Effort decoration applied
        System.assertEquals('medium', renewals.topThree[0].effort);
    }

    @isTest
    static void estimatedFormulaAppliesToPipelineDetectorsOnly() {
        // No Opportunity seed — relies on default median ($10K) and 0 cap.
        ForensicScan__c scan = new ForensicScan__c(Status__c='Completed',
            CompletedAt__c=System.now(), TotalLeakageUsd__c=0, FindingCount__c=3);
        insert scan;
        // 2 REN-003 with 0 gap (pipeline) → should get estimated $
        // 1 REN-001 with $1000 gap (verified) → no estimated
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-003',
                Title__c='A', Severity__c='Warning', GapUsd__c=0,
                EntitledUsd__c=0, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-003',
                Title__c='B', Severity__c='Warning', GapUsd__c=0,
                EntitledUsd__c=0, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
                Title__c='C', Severity__c='Critical', GapUsd__c=1000,
                EntitledUsd__c=1000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now())
        };

        Test.startTest();
        RevenueLeakageController.LeakageDto dto = RevenueLeakageController.getLeakage();
        Test.stopTest();

        System.assertEquals(1000, dto.totalVerifiedUsd);
        // estimated = 2 × 10000 (default median) × 0.10 × 4 = 8000; no cap (baseline=0)
        System.assertEquals(8000, dto.estimatedUsd);
        System.assertEquals(9000, dto.totalUsd);
    }

    @isTest
    static void confidenceTiers() {
        ForensicScan__c scan = new ForensicScan__c(Status__c='Completed',
            CompletedAt__c=System.now(), TotalLeakageUsd__c=0, FindingCount__c=15);
        insert scan;
        List<ForensicFinding__c> fs = new List<ForensicFinding__c>();
        for (Integer i = 0; i < 15; i++) {
            fs.add(new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
                Title__c='r'+i, Severity__c='Info', GapUsd__c=100,
                EntitledUsd__c=100, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()));
        }
        insert fs;
        Test.startTest();
        RevenueLeakageController.LeakageDto dto = RevenueLeakageController.getLeakage();
        Test.stopTest();
        System.assertEquals('medium', dto.confidence, '15 findings → medium');
    }
}
