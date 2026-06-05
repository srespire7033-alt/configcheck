@isTest
private class IssuesControllerTest {

    @isTest
    static void normalizeTitleStripsEmbeddedRecordNames() {
        // Verbatim from prod data — verifies the dedup behavior.
        System.assertEquals('Order activated with no billing schedule',
            IssuesController.normalizeTitle('Order 00000739 activated with no billing schedule'));
        System.assertEquals('Order activated with no billing schedule',
            IssuesController.normalizeTitle('Order 00000740 activated with no billing schedule'));
        // Strips both "Q-00187" and "61d" → "Nd"
        System.assertEquals('Renewal Quote Nd past contract end — still in Draft (USD 65K)',
            IssuesController.normalizeTitle('Renewal Quote Q-00187 61d past contract end — still in Draft (USD 65K)'));
        System.assertEquals('Quote expired Nd ago — no renewal opened',
            IssuesController.normalizeTitle('Quote Q-00004 expired 7d ago — no renewal opened'));
        System.assertEquals('—', IssuesController.normalizeTitle(null));
        System.assertEquals('—', IssuesController.normalizeTitle(''));
    }

    @isTest
    static void topIssueGroupsCollapsesSimilarTitles() {
        ForensicScan__c scan = new ForensicScan__c(Status__c='Completed',
            CompletedAt__c=System.now(), TotalLeakageUsd__c=0, FindingCount__c=3);
        insert scan;
        // Three findings with different order numbers but same template — should collapse to 1 member
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='ORD-FOR-001',
                PrimaryRecordId__c='r1', Title__c='Order 00000739 activated with no billing schedule',
                Severity__c='Warning', GapUsd__c=15000, EntitledUsd__c=15000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='ORD-FOR-001',
                PrimaryRecordId__c='r2', Title__c='Order 00000740 activated with no billing schedule',
                Severity__c='Info', GapUsd__c=1500, EntitledUsd__c=1500, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='ORD-FOR-001',
                PrimaryRecordId__c='r3', Title__c='Order 00000741 activated with no billing schedule',
                Severity__c='Info', GapUsd__c=1500, EntitledUsd__c=1500, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now())
        };
        Test.startTest();
        List<IssuesController.IssueGroup> groups = IssuesController.getTopIssueGroups(5, null);
        Test.stopTest();
        System.assertEquals(1, groups.size());
        System.assertEquals(1, groups[0].relatedCount, '3 unique order titles collapse to 1 normalized member');
        System.assertEquals(3, groups[0].totalAffected);
        System.assertEquals('Order activated with no billing schedule', groups[0].headlineTitle);
    }

    @isTest
    static void getTopIssuesReturnsEmptyWithNoScans() {
        Test.startTest();
        List<IssuesController.IssueRow> rows = IssuesController.getTopIssues(10);
        Test.stopTest();
        System.assertEquals(0, rows.size());
    }

    @isTest
    static void getTopIssuesSortsBySeverityThenGap() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c='Completed', CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=3
        );
        insert scan;
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
                Severity__c='Info', GapUsd__c=99999, EntitledUsd__c=99999, RealizedUsd__c=0,
                Title__c='Info big', Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
                Severity__c='Critical', GapUsd__c=100, EntitledUsd__c=100, RealizedUsd__c=0,
                Title__c='Crit small', Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-002',
                Severity__c='Critical', GapUsd__c=5000, EntitledUsd__c=5000, RealizedUsd__c=0,
                Title__c='Crit big', Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
                Severity__c='Warning', GapUsd__c=2000, EntitledUsd__c=2000, RealizedUsd__c=0,
                Title__c='Warn mid', Status__c='Open', DetectedAt__c=System.now())
        };

        Test.startTest();
        List<IssuesController.IssueRow> rows = IssuesController.getTopIssues(10);
        Test.stopTest();

        System.assertEquals(4, rows.size());
        // Crit big should be first, Crit small second, Warn mid third, Info last
        System.assertEquals('Crit big', rows[0].title, 'Critical with biggest gap is #1');
        System.assertEquals('Critical', rows[1].severity);
        System.assertEquals('Warning', rows[2].severity);
        System.assertEquals('Info', rows[3].severity);
        // Category label should be human-readable
        System.assertEquals('Pricing Discipline', rows[0].categoryLabel);
    }

    @isTest
    static void getIssueDetailReturnsAffectedRecord() {
        // Seed a Product2 record so PrimaryRecordId__c resolves.
        Product2 prod = new Product2(Name = 'Sample Product', IsActive = true);
        insert prod;

        ForensicScan__c scan = new ForensicScan__c(
            Status__c='Completed', CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=1
        );
        insert scan;
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c=scan.Id, DetectorId__c='ORD-FOR-001',
            Severity__c='Critical', GapUsd__c=1500,
            EntitledUsd__c=1500, RealizedUsd__c=0,
            Title__c='Missing config', Description__c='No billing rule',
            PrimaryRecordId__c=prod.Id, PrimaryRecordType__c='Product2',
            Status__c='Open', DetectedAt__c=System.now()
        );
        insert f;

        Test.startTest();
        IssuesController.IssueDetailDto detail = IssuesController.getIssueDetail(f.Id);
        IssuesController.IssueDetailDto nullCase = IssuesController.getIssueDetail(null);
        Test.stopTest();

        System.assertNotEquals(null, detail);
        System.assertEquals(f.Id, detail.id);
        System.assertEquals('Product Billing Config', detail.categoryLabel);
        System.assert(detail.recommendedFix.contains('Charge Type'),
            'Detector-specific fix prose should be returned');
        System.assertEquals(1, detail.affectedRecords.size());
        System.assertEquals('Sample Product', detail.affectedRecords[0].name);
        System.assertEquals(null, nullCase, 'Null id → null');
    }

    @isTest
    static void getTopIssueGroupsLimitsAndGroupsByCategory() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c='Completed', CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=8);
        insert scan;
        List<ForensicFinding__c> fs = new List<ForensicFinding__c>();
        // 5 findings in Product Billing Config (ORD-FOR-001), 3 distinct titles
        for (Integer i = 0; i < 3; i++) {
            fs.add(new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='ORD-FOR-001',
                PrimaryRecordId__c='r'+i, Title__c='Missing charge type',
                Severity__c='Critical', GapUsd__c=1000, EntitledUsd__c=1000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()));
        }
        fs.add(new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='ORD-FOR-001',
            PrimaryRecordId__c='ra', Title__c='Missing tax rule',
            Severity__c='Critical', GapUsd__c=900, EntitledUsd__c=900, RealizedUsd__c=0,
            Status__c='Open', DetectedAt__c=System.now()));
        fs.add(new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='ORD-FOR-001',
            PrimaryRecordId__c='rb', Title__c='Missing billing rule',
            Severity__c='Critical', GapUsd__c=800, EntitledUsd__c=800, RealizedUsd__c=0,
            Status__c='Open', DetectedAt__c=System.now()));
        // 1 in QL-FOR-001
        fs.add(new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='QL-FOR-001',
            PrimaryRecordId__c='qa', Title__c='Bundle zero',
            Severity__c='Warning', GapUsd__c=500, EntitledUsd__c=500, RealizedUsd__c=0,
            Status__c='Open', DetectedAt__c=System.now()));
        insert fs;

        Test.startTest();
        List<IssuesController.IssueGroup> groups = IssuesController.getTopIssueGroups(5, null);
        Test.stopTest();

        System.assertEquals(2, groups.size(), 'Two distinct categories');
        IssuesController.IssueGroup pbc = groups[0];
        System.assertEquals('Product Billing Config', pbc.categoryLabel);
        System.assertEquals(5, pbc.totalAffected);
        System.assertEquals(3, pbc.relatedCount, '3 distinct titles roll up');
        System.assertEquals('Critical', pbc.severity);
    }

    @isTest
    static void getAllIssuesFiltersAndSearches() {
        ForensicScan__c scan = new ForensicScan__c(Status__c='Completed', CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=3);
        insert scan;
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
                Title__c='Renewal off price', Description__c='Below list',
                Severity__c='Critical', GapUsd__c=1000, EntitledUsd__c=1000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
                Title__c='Bundle gap', Description__c='Missing option',
                Severity__c='Warning', GapUsd__c=500, EntitledUsd__c=500, RealizedUsd__c=0,
                Status__c='Resolved', DetectedAt__c=System.now())
        };

        Test.startTest();
        List<IssuesController.IssueRow> all = IssuesController.getAllIssues(null, null, null, null);
        List<IssuesController.IssueRow> critsOnly = IssuesController.getAllIssues(
            new List<String>{'Critical'}, null, null, null);
        List<IssuesController.IssueRow> openOnly = IssuesController.getAllIssues(
            null, new List<String>{'Open'}, null, null);
        List<IssuesController.IssueRow> searched = IssuesController.getAllIssues(
            null, null, 'Renewal', null);
        Test.stopTest();

        System.assertEquals(2, all.size());
        System.assertEquals(1, critsOnly.size());
        System.assertEquals(1, openOnly.size());
        System.assertEquals(1, searched.size());
        System.assertEquals('Renewal off price', searched[0].title);
    }

    @isTest
    static void bulkUpdateAppliesAndCreatesSuppressions() {
        ForensicScan__c scan = new ForensicScan__c(Status__c='Completed', CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=2);
        insert scan;
        ForensicFinding__c f1 = new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
            PrimaryRecordId__c='r1', Title__c='X', Severity__c='Critical',
            GapUsd__c=100, EntitledUsd__c=100, RealizedUsd__c=0,
            Status__c='Open', DetectedAt__c=System.now());
        ForensicFinding__c f2 = new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-002',
            PrimaryRecordId__c='r2', Title__c='Y', Severity__c='Warning',
            GapUsd__c=50, EntitledUsd__c=50, RealizedUsd__c=0,
            Status__c='Open', DetectedAt__c=System.now());
        insert new List<ForensicFinding__c>{ f1, f2 };

        Test.startTest();
        IssuesController.bulkUpdateStatus(new List<Id>{ f1.Id, f2.Id }, 'False Positive');
        IssuesController.bulkUpdateStatus(null, 'Resolved');         // no-op
        IssuesController.bulkUpdateStatus(new List<Id>{}, 'Resolved'); // no-op
        Boolean threw = false;
        try { IssuesController.bulkUpdateStatus(new List<Id>{ f1.Id }, 'Bogus'); }
        catch (AuraHandledException e) { threw = true; }
        Test.stopTest();

        System.assert(threw, 'Bogus status throws');
        List<ForensicFinding__c> updated = [SELECT Status__c FROM ForensicFinding__c WHERE Id IN :new List<Id>{f1.Id, f2.Id}];
        for (ForensicFinding__c f : updated) System.assertEquals('False Positive', f.Status__c);
        List<ForensicSuppression__c> sups = [SELECT Id FROM ForensicSuppression__c];
        System.assertEquals(2, sups.size(), 'One suppression per finding');
    }

    @isTest
    static void updateStatusCreatesSuppressionIdempotent() {
        ForensicScan__c scan = new ForensicScan__c(Status__c='Completed', CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=1);
        insert scan;
        ForensicFinding__c f = new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
            PrimaryRecordId__c='r1', Title__c='X', Severity__c='Critical',
            GapUsd__c=100, EntitledUsd__c=100, RealizedUsd__c=0,
            Status__c='Open', DetectedAt__c=System.now());
        insert f;
        Test.startTest();
        IssuesController.updateStatus(f.Id, 'False Positive');
        IssuesController.updateStatus(f.Id, 'False Positive'); // second call must not duplicate
        Test.stopTest();
        System.assertEquals(1, [SELECT COUNT() FROM ForensicSuppression__c WHERE DetectorId__c='REN-001'],
            'Suppression must be idempotent');
    }

    @isTest
    static void updateStatusFlipsValue() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c='Completed', CompletedAt__c=System.now(),
            TotalLeakageUsd__c=0, FindingCount__c=1);
        insert scan;
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c=scan.Id, DetectorId__c='REN-001',
            Severity__c='Critical', GapUsd__c=100,
            EntitledUsd__c=100, RealizedUsd__c=0,
            Title__c='x', Status__c='Open', DetectedAt__c=System.now()
        );
        insert f;

        Test.startTest();
        IssuesController.updateStatus(f.Id, 'Acknowledged');
        IssuesController.updateStatus(null, 'Resolved'); // no-op branch
        IssuesController.updateStatus(f.Id, '');          // no-op branch
        Boolean threw = false;
        try {
            IssuesController.updateStatus(f.Id, 'Bogus');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'Bogus status should throw AuraHandledException');
        ForensicFinding__c reloaded = [SELECT Status__c FROM ForensicFinding__c WHERE Id = :f.Id];
        System.assertEquals('Acknowledged', reloaded.Status__c);
    }
}
