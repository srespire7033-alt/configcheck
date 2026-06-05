@isTest
private class AiAnalysisControllerTest {

    @isTest
    static void emptyOrgReturnsPlaceholder() {
        Test.startTest();
        AiAnalysisController.AnalysisDto dto = AiAnalysisController.getAnalysis();
        Test.stopTest();
        System.assertNotEquals(null, dto);
        System.assert(dto.headline.contains('Run a forensic scan'),
            'Empty-org headline should prompt for a scan');
        System.assertEquals(0, dto.topCategories.size());
    }

    @isTest
    static void buildsHeadlineAndCategories() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Completed', CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 0, FindingCount__c = 6
        );
        insert scan;

        List<ForensicFinding__c> findings = new List<ForensicFinding__c>();
        // 4 critical in Product Billing Config (ORD-FOR-001)
        for (Integer i = 0; i < 4; i++) {
            findings.add(new ForensicFinding__c(
                ForensicScan__c = scan.Id, DetectorId__c = 'ORD-FOR-001',
                PrimaryRecordId__c = 'rec' + i, Title__c = 'Order missing schedule',
                Description__c = 'No billing schedule',
                Severity__c = 'Critical', GapUsd__c = 5000,
                EntitledUsd__c = 5000, RealizedUsd__c = 0,
                Status__c = 'Open', DetectedAt__c = System.now()
            ));
        }
        // 2 critical in Bundle Integrity (PROV-FOR-002)
        for (Integer i = 0; i < 2; i++) {
            findings.add(new ForensicFinding__c(
                ForensicScan__c = scan.Id, DetectorId__c = 'PROV-FOR-002',
                PrimaryRecordId__c = 'bdl' + i, Title__c = 'Missing asset',
                Description__c = 'Sub has no asset',
                Severity__c = 'Critical', GapUsd__c = 2000,
                EntitledUsd__c = 2000, RealizedUsd__c = 0,
                Status__c = 'Open', DetectedAt__c = System.now()
            ));
        }
        // 1 critical + 1 warning in Quote Lines (QL-FOR-001)
        findings.add(new ForensicFinding__c(
            ForensicScan__c = scan.Id, DetectorId__c = 'QL-FOR-001',
            PrimaryRecordId__c = 'ql1', Title__c = 'Bundle zero',
            Description__c = 'Required option at $0',
            Severity__c = 'Critical', GapUsd__c = 800,
            EntitledUsd__c = 800, RealizedUsd__c = 0,
            Status__c = 'Open', DetectedAt__c = System.now()
        ));
        findings.add(new ForensicFinding__c(
            ForensicScan__c = scan.Id, DetectorId__c = 'QL-FOR-001',
            PrimaryRecordId__c = 'ql2', Title__c = 'Bundle zero 2',
            Description__c = 'Required option at $0',
            Severity__c = 'Warning', GapUsd__c = 400,
            EntitledUsd__c = 400, RealizedUsd__c = 0,
            Status__c = 'Open', DetectedAt__c = System.now()
        ));
        insert findings;

        Test.startTest();
        AiAnalysisController.AnalysisDto dto = AiAnalysisController.getAnalysis();
        Test.stopTest();

        System.assertEquals(7, dto.totalCritical, 'Total critical across all detectors');
        System.assertEquals(1, dto.totalWarning);
        System.assert(dto.headline.startsWith('Your org has 7 critical issue'), dto.headline);
        System.assert(dto.headline.contains('Product Billing Config'), dto.headline);
        System.assertEquals(3, dto.topCategories.size(), '3 distinct categories');
        // Top should be Product Billing Config (4 critical).
        System.assertEquals('Product Billing Config', dto.topCategories[0].label);
        System.assertEquals(4, dto.topCategories[0].criticalCount);
    }

    @isTest
    static void getCategoryIssuesGroupsBySeverity() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Completed', CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 0, FindingCount__c = 3
        );
        insert scan;

        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='QL-FOR-001',
                PrimaryRecordId__c='a', Title__c='C', Severity__c='Critical',
                GapUsd__c=1000, EntitledUsd__c=1000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='QL-FOR-001',
                PrimaryRecordId__c='b', Title__c='W', Severity__c='Warning',
                GapUsd__c=500, EntitledUsd__c=500, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='QL-FOR-001',
                PrimaryRecordId__c='c', Title__c='I', Severity__c='Info',
                GapUsd__c=100, EntitledUsd__c=100, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now())
        };

        Test.startTest();
        AiAnalysisController.CategoryIssuesDto out =
            AiAnalysisController.getCategoryIssues('Quote Lines');
        AiAnalysisController.CategoryIssuesDto empty =
            AiAnalysisController.getCategoryIssues('Nonexistent Label');
        AiAnalysisController.CategoryIssuesDto blank =
            AiAnalysisController.getCategoryIssues(null);
        Test.stopTest();

        System.assertEquals(3, out.totalCount);
        System.assertEquals(1, out.critical.size());
        System.assertEquals(1, out.warning.size());
        System.assertEquals(1, out.info.size());
        System.assertEquals(0, empty.totalCount);
        System.assertEquals(0, blank.critical.size(), 'Null label → empty result');
    }

    @isTest
    static void getIssuesByDetectorIdsGroupsBySeverity() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c='Completed', CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=3);
        insert scan;
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='ORD-FOR-001',
                PrimaryRecordId__c='a', Title__c='C', Severity__c='Critical',
                GapUsd__c=1000, EntitledUsd__c=1000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='ORD-FOR-001',
                PrimaryRecordId__c='b', Title__c='W', Severity__c='Warning',
                GapUsd__c=500, EntitledUsd__c=500, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='ORD-FOR-001',
                PrimaryRecordId__c='c', Title__c='I', Severity__c='Info',
                GapUsd__c=100, EntitledUsd__c=100, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now())
        };

        Test.startTest();
        AiAnalysisController.CategoryIssuesDto byIds =
            AiAnalysisController.getIssuesByDetectorIds(
                new List<String>{ 'ORD-FOR-001' }, 'Billing Config');
        AiAnalysisController.CategoryIssuesDto empty =
            AiAnalysisController.getIssuesByDetectorIds(new List<String>(), 'x');
        AiAnalysisController.CategoryIssuesDto nul =
            AiAnalysisController.getIssuesByDetectorIds(null, 'x');
        Test.stopTest();

        System.assertEquals(3, byIds.totalCount);
        System.assertEquals('Billing Config', byIds.categoryLabel);
        System.assertEquals(1, byIds.critical.size());
        System.assertEquals(1, byIds.warning.size());
        System.assertEquals(1, byIds.info.size());
        System.assertEquals(0, empty.totalCount);
        System.assertEquals(0, nul.totalCount, 'Null detectorIds → empty');
    }

    @isTest
    static void markFixedUpdatesStatus() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c='Completed', CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=1
        );
        insert scan;
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c=scan.Id, DetectorId__c='REN-001',
            PrimaryRecordId__c='r1', Title__c='X', Severity__c='Critical',
            GapUsd__c=1000, EntitledUsd__c=1000, RealizedUsd__c=0,
            Status__c='Open', DetectedAt__c=System.now()
        );
        insert f;
        Test.startTest();
        AiAnalysisController.markFixed(f.Id);
        AiAnalysisController.markFixed(null); // no-op branch
        Test.stopTest();
        ForensicFinding__c reloaded = [SELECT Status__c FROM ForensicFinding__c WHERE Id = :f.Id];
        System.assertEquals('Resolved', reloaded.Status__c);
    }
}
