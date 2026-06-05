/**
 * Covers DashboardController.getDashboardSummary() — exercises both
 * the empty path (no scans yet) and the populated path (a scan with
 * findings of each severity tier).
 */
@isTest
private class DashboardControllerTest {

    @isTest
    static void getDashboardSummary_emptyWhenNoScans() {
        DashboardController.SummaryDto dto = DashboardController.getDashboardSummary(null);
        System.assertNotEquals(null, dto);
        System.assertEquals(0, dto.scanCount);
        System.assertEquals(0, dto.findingCount);
        System.assertEquals(false, dto.hasForensicData);
        System.assertEquals(null, dto.latestScan);
    }

    @isTest
    static void getDashboardSummary_aggregatesSeverityCounts() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Completed',
            ProductType__c = 'CPQ',
            StartedAt__c = System.now(),
            CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 50000,
            FindingCount__c = 3
        );
        insert scan;

        List<ForensicFinding__c> findings = new List<ForensicFinding__c>();
        for (Integer i = 0; i < 2; i++) {
            findings.add(new ForensicFinding__c(
                ForensicScan__c = scan.Id,
                DetectorId__c = 'REN-001',
                Severity__c = 'Critical',
                EntitledUsd__c = 30000,
                RealizedUsd__c = 10000,
                GapUsd__c = 20000,
                Title__c = 'Critical finding ' + i,
                Status__c = 'Open',
                DetectedAt__c = System.now()
            ));
        }
        findings.add(new ForensicFinding__c(
            ForensicScan__c = scan.Id,
            DetectorId__c = 'REN-002',
            Severity__c = 'Warning',
            EntitledUsd__c = 5000,
            RealizedUsd__c = 1000,
            GapUsd__c = 4000,
            Title__c = 'Warning finding',
            Status__c = 'Open',
            DetectedAt__c = System.now()
        ));
        findings.add(new ForensicFinding__c(
            ForensicScan__c = scan.Id,
            DetectorId__c = 'DSC-FOR-001',
            Severity__c = 'Info',
            EntitledUsd__c = 500,
            RealizedUsd__c = 100,
            GapUsd__c = 400,
            Title__c = 'Info finding',
            Status__c = 'Open',
            DetectedAt__c = System.now()
        ));
        // Hidden finding should be excluded from severity counts + top list.
        findings.add(new ForensicFinding__c(
            ForensicScan__c = scan.Id,
            DetectorId__c = 'X',
            Severity__c = 'Critical',
            EntitledUsd__c = 1000,
            RealizedUsd__c = 0,
            GapUsd__c = 1000,
            Title__c = 'Hidden critical',
            Status__c = 'Open',
            DetectedAt__c = System.now(),
            HiddenAt__c = System.now()
        ));
        insert findings;

        Test.startTest();
        DashboardController.SummaryDto dto = DashboardController.getDashboardSummary(null);
        Test.stopTest();

        System.assertNotEquals(null, dto.latestScan);
        System.assertEquals(scan.Id, dto.latestScan.Id);
        System.assertEquals(1, dto.scanCount);
        System.assertEquals(2, dto.criticalCount, 'Hidden critical should be excluded');
        System.assertEquals(1, dto.warningCount);
        System.assertEquals(1, dto.infoCount);
        System.assertEquals(true, dto.hasForensicData);
        // Top findings sorted by gap desc, hidden excluded → 4 unhidden.
        System.assertEquals(4, dto.topFindings.size());
        System.assertEquals(20000, dto.topFindings[0].gapUsd);
    }

    @isTest
    static void getDashboardSummary_filtersByConnectedOrgId() {
        // Two ConnectedOrg__c rows, each with their own scan + findings.
        ConnectedOrg__c orgA = new ConnectedOrg__c(
            Name = 'Org A', InstanceUrl__c = 'https://a.my.salesforce.com',
            NamedCredentialName__c = 'NC_A', OrgType__c = 'Production',
            Status__c = 'Connected'
        );
        ConnectedOrg__c orgB = new ConnectedOrg__c(
            Name = 'Org B', InstanceUrl__c = 'https://b.my.salesforce.com',
            NamedCredentialName__c = 'NC_B', OrgType__c = 'Sandbox',
            Status__c = 'Connected'
        );
        insert new List<ConnectedOrg__c>{ orgA, orgB };

        ForensicScan__c scanA = new ForensicScan__c(
            ConnectedOrg__c = orgA.Id, Status__c = 'Completed',
            ProductType__c = 'CPQ', StartedAt__c = System.now().addDays(-2),
            CompletedAt__c = System.now().addDays(-2),
            TotalLeakageUsd__c = 100, FindingCount__c = 1
        );
        ForensicScan__c scanB = new ForensicScan__c(
            ConnectedOrg__c = orgB.Id, Status__c = 'Completed',
            ProductType__c = 'CPQ', StartedAt__c = System.now().addDays(-1),
            CompletedAt__c = System.now().addDays(-1),
            TotalLeakageUsd__c = 999, FindingCount__c = 5
        );
        insert new List<ForensicScan__c>{ scanA, scanB };

        // With no filter → returns latest globally (scanB, more recent).
        DashboardController.SummaryDto unfiltered =
            DashboardController.getDashboardSummary(null);
        System.assertEquals(scanB.Id, unfiltered.latestScan.Id, 'Unfiltered → latest global');

        // With orgA filter → returns scanA (older but matches the filter).
        DashboardController.SummaryDto filteredA =
            DashboardController.getDashboardSummary(orgA.Id);
        System.assertEquals(scanA.Id, filteredA.latestScan.Id, 'Filtered to orgA');
        System.assertEquals(1, filteredA.scanCount, 'Only orgA scans counted');

        // With orgB filter → returns scanB.
        DashboardController.SummaryDto filteredB =
            DashboardController.getDashboardSummary(orgB.Id);
        System.assertEquals(scanB.Id, filteredB.latestScan.Id, 'Filtered to orgB');
    }

    /**
     * Smoke tests for the connectedOrgId branch of the OTHER dashboard
     * methods. Each call just exercises the filtered SOQL path; the
     * unfiltered branch is covered by the existing tests.
     */
    @isTest
    static void allMethods_acceptConnectedOrgIdParam() {
        ConnectedOrg__c co = new ConnectedOrg__c(
            Name = 'Org X', InstanceUrl__c = 'https://x.my.salesforce.com',
            NamedCredentialName__c = 'NC_X', OrgType__c = 'Production',
            Status__c = 'Connected'
        );
        insert co;

        Test.startTest();
        // All call paths run with a valid connectedOrgId — these exercise
        // the connectedOrgId-non-null SOQL branches.
        System.assertNotEquals(null, DashboardController.getMatrixFindings(co.Id));
        System.assertNotEquals(null,
            DashboardController.getFindingsByCategory('revenue_leakage', co.Id));
        System.assertNotEquals(null, DashboardController.getSinceLastScan(co.Id));
        System.assertNotEquals(null, DashboardController.getScanTrend(10, co.Id));
        System.assertNotEquals(null, DashboardController.getScoreHistory(20, co.Id));
        Test.stopTest();
    }

    @isTest
    static void getScanTrend_returnsEmptyWhenNoScans() {
        List<DashboardController.ScanPoint> trend = DashboardController.getScanTrend(10, null);
        System.assertEquals(0, trend.size());
    }

    @isTest
    static void getScanTrend_returnsScansAscending() {
        // Seed 3 scans with explicit completion times. Insert in
        // reversed creation order so we know the ORDER BY in the
        // Apex method is what's doing the sorting, not insert order.
        ForensicScan__c s1 = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now().addDays(-10),
            CompletedAt__c = System.now().addDays(-10),
            TotalLeakageUsd__c = 100000, FindingCount__c = 5
        );
        ForensicScan__c s2 = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now().addDays(-5),
            CompletedAt__c = System.now().addDays(-5),
            TotalLeakageUsd__c = 80000, FindingCount__c = 4
        );
        ForensicScan__c s3 = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now(), CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 60000, FindingCount__c = 3
        );
        insert new List<ForensicScan__c>{ s3, s1, s2 };

        List<DashboardController.ScanPoint> trend = DashboardController.getScanTrend(10, null);
        System.assertEquals(3, trend.size());
        // Oldest first: s1 → s2 → s3
        System.assertEquals(100000, trend[0].totalUsd);
        System.assertEquals(80000, trend[1].totalUsd);
        System.assertEquals(60000, trend[2].totalUsd);
    }

    @isTest
    static void getFindingsByCategory_emptyWhenNoScans() {
        DashboardController.CategoryFindingsDto dto =
            DashboardController.getFindingsByCategory('revenue_leakage', null);
        System.assertEquals(0, dto.findingCount);
        System.assertEquals(0, dto.findings.size());
        System.assertEquals(0, dto.byDetector.size());
    }

    @isTest
    static void getFindingsByCategory_groupsByDetector() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now(), CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 100000, FindingCount__c = 4
        );
        insert scan;
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001', Severity__c='Critical',
                EntitledUsd__c=30000, RealizedUsd__c=10000, GapUsd__c=20000, Title__c='REN-001 #1',
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001', Severity__c='Warning',
                EntitledUsd__c=15000, RealizedUsd__c=5000, GapUsd__c=10000, Title__c='REN-001 #2',
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='QL-FOR-001', Severity__c='Critical',
                EntitledUsd__c=50000, RealizedUsd__c=0, GapUsd__c=50000, Title__c='QL-FOR-001 #1',
                Status__c='Open', DetectedAt__c=System.now()),
            // Pricing-category finding should NOT appear in revenue_leakage results.
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-002', Severity__c='Warning',
                EntitledUsd__c=8000, RealizedUsd__c=4000, GapUsd__c=4000, Title__c='REN-002 (pricing)',
                Status__c='Open', DetectedAt__c=System.now())
        };

        DashboardController.CategoryFindingsDto rl =
            DashboardController.getFindingsByCategory('revenue_leakage', null);
        System.assertEquals(3, rl.findingCount, 'REN-002 should be excluded');
        System.assertEquals(80000, rl.totalUsd);
        System.assertEquals(2, rl.byDetector.size(), '2 detectors in revenue_leakage');
        // Detector groups sorted by total $ desc — QL-FOR-001 (50K) first.
        System.assertEquals('QL-FOR-001', rl.byDetector[0].detectorId);
        System.assertEquals(50000, rl.byDetector[0].totalUsd);
        System.assertEquals('REN-001', rl.byDetector[1].detectorId);
        System.assertEquals(30000, rl.byDetector[1].totalUsd);

        DashboardController.CategoryFindingsDto pricing =
            DashboardController.getFindingsByCategory('pricing', null);
        System.assertEquals(1, pricing.findingCount);
        System.assertEquals('REN-002', pricing.byDetector[0].detectorId);
    }

    @isTest
    static void getSinceLastScan_emptyWhenNoScans() {
        DashboardController.SinceLastScanDto dto = DashboardController.getSinceLastScan(null);
        System.assertEquals(false, dto.hasPrior);
        System.assertEquals(0, dto.addedCount);
        System.assertEquals(0, dto.resolvedCount);
    }

    @isTest
    static void getSinceLastScan_computesDeltaAndDiff() {
        // Prior scan with 2 findings.
        ForensicScan__c prior = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now().addDays(-7),
            CompletedAt__c = System.now().addDays(-7),
            TotalLeakageUsd__c = 100000, FindingCount__c = 2
        );
        insert prior;
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=prior.Id, DetectorId__c='REN-001',
                Severity__c='Critical', EntitledUsd__c=70000, RealizedUsd__c=20000,
                GapUsd__c=50000, Title__c='Acme renewal', Status__c='Open',
                DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=prior.Id, DetectorId__c='REN-001',
                Severity__c='Warning', EntitledUsd__c=60000, RealizedUsd__c=10000,
                GapUsd__c=50000, Title__c='Globex renewal', Status__c='Open',
                DetectedAt__c=System.now())
        };

        // Latest scan: Acme is still present (carried over), Globex
        // was resolved, but a new Initech finding appeared.
        ForensicScan__c latest = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now(), CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 75000, FindingCount__c = 2
        );
        insert latest;
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=latest.Id, DetectorId__c='REN-001',
                Severity__c='Critical', EntitledUsd__c=70000, RealizedUsd__c=20000,
                GapUsd__c=50000, Title__c='Acme renewal', Status__c='Open',
                DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=latest.Id, DetectorId__c='QL-FOR-001',
                Severity__c='Warning', EntitledUsd__c=25000, RealizedUsd__c=0,
                GapUsd__c=25000, Title__c='Initech bundle', Status__c='Open',
                DetectedAt__c=System.now())
        };

        Test.startTest();
        DashboardController.SinceLastScanDto dto = DashboardController.getSinceLastScan(null);
        Test.stopTest();

        System.assertEquals(true, dto.hasPrior);
        System.assertEquals(75000, dto.latestTotal);
        System.assertEquals(100000, dto.priorTotal);
        System.assertEquals(-25000, dto.delta);
        System.assertEquals(1, dto.addedCount, 'Initech is new');
        System.assertEquals(1, dto.resolvedCount, 'Globex resolved');
        System.assertEquals(1, dto.newFindings.size());
        System.assertEquals('Initech bundle', dto.newFindings[0].title);
        System.assertEquals(1, dto.resolvedTitles.size());
        System.assertEquals('Globex renewal', dto.resolvedTitles[0]);
    }

    @isTest
    static void getRecoveryQueue_emptyWhenNoActions() {
        DashboardController.RecoveryQueueDto dto = DashboardController.getRecoveryQueue(null);
        System.assertEquals(0, dto.totalCount);
        System.assertEquals(0, dto.groups.size());
    }

    @isTest
    static void getRecoveryQueue_groupsByStatus() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now(), CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 100000, FindingCount__c = 4
        );
        insert scan;
        List<ForensicFinding__c> findings = new List<ForensicFinding__c>();
        for (Integer i = 0; i < 3; i++) {
            findings.add(new ForensicFinding__c(
                ForensicScan__c = scan.Id,
                DetectorId__c = 'REN-001',
                Severity__c = 'Warning',
                EntitledUsd__c = 10000, RealizedUsd__c = 5000, GapUsd__c = 5000,
                Title__c = 'Finding ' + i, Status__c = 'Open',
                DetectedAt__c = System.now()
            ));
        }
        insert findings;
        // Trigger enforces "new recovery actions must start in Pending"
        // — insert as Pending, then transition via update through the
        // state machine (Pending → Approved → Committed).
        RecoveryAction__c a1 = new RecoveryAction__c(
            ForensicFinding__c = findings[0].Id,
            ApprovalStatus__c = 'Pending', ProjectedReclaimUsd__c = 5000
        );
        RecoveryAction__c a2 = new RecoveryAction__c(
            ForensicFinding__c = findings[1].Id,
            ApprovalStatus__c = 'Pending', ProjectedReclaimUsd__c = 8000
        );
        RecoveryAction__c a3 = new RecoveryAction__c(
            ForensicFinding__c = findings[2].Id,
            ApprovalStatus__c = 'Pending', ProjectedReclaimUsd__c = 12000
        );
        insert new List<RecoveryAction__c>{ a1, a2, a3 };
        // Transition a2 → Approved.
        a2.ApprovalStatus__c = 'Approved';
        a2.ApprovedAt__c = System.now();
        update a2;
        // Transition a3 → Approved → Committed.
        a3.ApprovalStatus__c = 'Approved';
        a3.ApprovedAt__c = System.now();
        update a3;
        a3.ApprovalStatus__c = 'Committed';
        a3.CommittedAt__c = System.now();
        update a3;

        DashboardController.RecoveryQueueDto dto = DashboardController.getRecoveryQueue(null);
        System.assertEquals(3, dto.totalCount);
        System.assertEquals(25000, dto.totalProjectedUsd);
        System.assertEquals(3, dto.groups.size(), 'Pending + Approved + Committed groups');
        // Pending should be first per the seeded order.
        System.assertEquals('Pending', dto.groups[0].status);
        System.assertEquals(1, dto.groups[0].count);
        System.assertEquals(5000, dto.groups[0].projectedUsd);
    }

    @isTest
    static void getScanTrend_honorsLimitClamp() {
        for (Integer i = 0; i < 3; i++) {
            insert new ForensicScan__c(
                Status__c = 'Completed', ProductType__c = 'CPQ',
                StartedAt__c = System.now(), CompletedAt__c = System.now(),
                TotalLeakageUsd__c = 1000, FindingCount__c = 1
            );
        }
        // null → defaults to 10 (still works)
        System.assertEquals(3, DashboardController.getScanTrend(null, null).size());
        // explicit 2 → only 2 returned
        System.assertEquals(2, DashboardController.getScanTrend(2, null).size());
        // over 50 → clamped to default 10 (so 3 here)
        System.assertEquals(3, DashboardController.getScanTrend(999, null).size());
    }
}
