/**
 * Covers ExecutiveReportController — exercises three paths:
 *   1. No scans → controller initializes safely with null scan
 *   2. Latest scan auto-resolved when no scanId param
 *   3. scanId URL param honored when present
 */
@isTest
private class ExecutiveReportControllerTest {

    @isTest
    static void controller_emptyWhenNoScans() {
        Test.setCurrentPage(Page.ExecutiveReport);
        ExecutiveReportController ctrl = new ExecutiveReportController();
        System.assertEquals(null, ctrl.scan);
        System.assertEquals(0, ctrl.findings.size());
        System.assertEquals(0, ctrl.detectorGroups.size());
    }

    @isTest
    static void controller_loadsLatestScanWhenNoParam() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now(), CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 75000, FindingCount__c = 3
        );
        insert scan;
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(
                ForensicScan__c = scan.Id, DetectorId__c = 'REN-001',
                Severity__c = 'Critical', EntitledUsd__c = 50000,
                RealizedUsd__c = 10000, GapUsd__c = 40000,
                RecoverabilityScore__c = 0.85,
                Title__c = 'Acme renewal uplift suppressed',
                Description__c = 'Detailed finding description',
                Status__c = 'Open', DetectedAt__c = System.now()
            ),
            new ForensicFinding__c(
                ForensicScan__c = scan.Id, DetectorId__c = 'REN-001',
                Severity__c = 'Warning', EntitledUsd__c = 20000,
                RealizedUsd__c = 5000, GapUsd__c = 15000,
                RecoverabilityScore__c = 0.7,
                Title__c = 'Globex renewal uplift suppressed',
                Status__c = 'Open', DetectedAt__c = System.now()
            ),
            new ForensicFinding__c(
                ForensicScan__c = scan.Id, DetectorId__c = 'QL-FOR-001',
                Severity__c = 'Info', EntitledUsd__c = 5000,
                RealizedUsd__c = 0, GapUsd__c = 5000,
                RecoverabilityScore__c = 0.9,
                Title__c = 'Bundle option at zero',
                Status__c = 'Open', DetectedAt__c = System.now()
            )
        };

        Test.setCurrentPage(Page.ExecutiveReport);
        Test.startTest();
        ExecutiveReportController ctrl = new ExecutiveReportController();
        Test.stopTest();

        System.assertNotEquals(null, ctrl.scan);
        System.assertEquals(scan.Id, ctrl.scan.Id);
        System.assertEquals(3, ctrl.findings.size());
        // Severity counts from all unhidden findings.
        System.assertEquals(1, ctrl.criticalCount);
        System.assertEquals(1, ctrl.warningCount);
        System.assertEquals(1, ctrl.infoCount);
        // 2 detector buckets (REN-001 and QL-FOR-001).
        System.assertEquals(2, ctrl.detectorGroups.size());
        // REN-001 should sort first ($55K total vs $5K for QL-FOR-001).
        System.assertEquals('REN-001', ctrl.detectorGroups[0].detectorId);
        System.assertEquals(55000, ctrl.detectorGroups[0].totalUsd);
        System.assertEquals('Renewal uplift suppressed', ctrl.detectorGroups[0].label);
    }

    @isTest
    static void controller_honorsScanIdUrlParam() {
        // Seed two scans; param should pick the older one explicitly,
        // proving the param wins over the auto-latest fallback.
        ForensicScan__c older = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now().addDays(-7),
            CompletedAt__c = System.now().addDays(-7),
            TotalLeakageUsd__c = 30000, FindingCount__c = 1
        );
        ForensicScan__c newer = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now(), CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 90000, FindingCount__c = 2
        );
        insert new List<ForensicScan__c>{ older, newer };

        PageReference pg = Page.ExecutiveReport;
        pg.getParameters().put('scanId', older.Id);
        Test.setCurrentPage(pg);

        ExecutiveReportController ctrl = new ExecutiveReportController();
        System.assertNotEquals(null, ctrl.scan);
        System.assertEquals(older.Id, ctrl.scan.Id, 'URL param should override latest-fallback');
    }

    // ── Phase 22g — Health Score headline + category breakdown ──

    @isTest
    static void healthScore_andCategoryBreakdown_loadFromScan() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now(), CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 50000, FindingCount__c = 4,
            HealthScore__c = 52,
            CategoryScoresJson__c = '{"revenue_leakage":80,"pricing":64,"governance":0}'
        );
        insert scan;

        Test.setCurrentPage(Page.ExecutiveReport);
        ExecutiveReportController ctrl = new ExecutiveReportController();
        System.assertEquals(52, ctrl.healthScore);
        System.assertEquals('warn', ctrl.healthTone, '52 should be warn (50-79)');
        System.assertEquals(3, ctrl.categoryScores.size());
        // First entry should be the WORST (governance, 0) per ascending sort
        System.assertEquals('governance', ctrl.categoryScores[0].key);
        System.assertEquals(0, ctrl.categoryScores[0].score);
        System.assertEquals('bad', ctrl.categoryScores[0].tone);
        // Last entry should be the BEST (revenue_leakage, 80)
        System.assertEquals('revenue_leakage', ctrl.categoryScores[2].key);
        System.assertEquals('good', ctrl.categoryScores[2].tone);
        System.assertEquals('Revenue Leakage', ctrl.categoryScores[2].label,
            'Friendly label should Title-Case underscored keys');
    }

    @isTest
    static void healthTone_appliesGradient() {
        // Score 30 → bad
        ForensicScan__c s1 = new ForensicScan__c(
            Status__c='Completed', ProductType__c='CPQ',
            StartedAt__c=System.now(), CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=0, HealthScore__c=30
        );
        insert s1;
        PageReference pg = Page.ExecutiveReport;
        pg.getParameters().put('scanId', s1.Id);
        Test.setCurrentPage(pg);
        ExecutiveReportController c1 = new ExecutiveReportController();
        System.assertEquals('bad', c1.healthTone);

        // Score 92 → good
        ForensicScan__c s2 = new ForensicScan__c(
            Status__c='Completed', ProductType__c='CPQ',
            StartedAt__c=System.now(), CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=0, HealthScore__c=92
        );
        insert s2;
        pg.getParameters().put('scanId', s2.Id);
        Test.setCurrentPage(pg);
        ExecutiveReportController c2 = new ExecutiveReportController();
        System.assertEquals('good', c2.healthTone);
    }

    @isTest
    static void parseCategoryScores_handlesNullBlankMalformed() {
        // null → empty list
        System.assertEquals(0,
            ExecutiveReportController.parseCategoryScores(null).size());
        // blank → empty list
        System.assertEquals(0,
            ExecutiveReportController.parseCategoryScores('   ').size());
        // malformed JSON → empty list (caught)
        System.assertEquals(0,
            ExecutiveReportController.parseCategoryScores('not-json').size());
        // valid → 1 entry
        System.assertEquals(1,
            ExecutiveReportController.parseCategoryScores('{"governance":42}').size());
    }

    @isTest
    static void friendlyCategoryLabel_handlesEdgeCases() {
        System.assertEquals('Uncategorized',
            ExecutiveReportController.friendlyCategoryLabel(null));
        System.assertEquals('Uncategorized',
            ExecutiveReportController.friendlyCategoryLabel('   '));
        System.assertEquals('Uncategorized',
            ExecutiveReportController.friendlyCategoryLabel('__uncategorized__'));
        System.assertEquals('Governance',
            ExecutiveReportController.friendlyCategoryLabel('governance'));
        System.assertEquals('Revenue Leakage',
            ExecutiveReportController.friendlyCategoryLabel('revenue_leakage'));
        System.assertEquals('Arm Billing Policies',
            ExecutiveReportController.friendlyCategoryLabel('arm_billing_policies'));
    }
}
