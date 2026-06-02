/**
 * Exercises every code path in FindingsListController. Uses only our
 * own custom objects (no CPQ dependency), so coverage is 100%
 * reproducible without SBQQ__ installed.
 */
@isTest
private class FindingsListControllerTest {

    private static ForensicScan__c seedScan(String status) {
        ForensicScan__c s = new ForensicScan__c(
            Status__c = status,
            ProductType__c = 'CPQ',
            StartedAt__c = System.now(),
            CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 5000,
            FindingCount__c = 3
        );
        insert s;
        return s;
    }

    private static ForensicFinding__c seedFinding(Id scanId, String detectorId, Decimal gap, Boolean hidden) {
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c = scanId,
            DetectorId__c = detectorId,
            Severity__c = (gap > 10000 ? 'Critical' : 'Warning'),
            EntitledUsd__c = gap + 1000,
            RealizedUsd__c = 1000,
            GapUsd__c = gap,
            RecoverabilityScore__c = 0.8,
            Title__c = 'Test ' + detectorId,
            Description__c = 'desc',
            Status__c = 'Open',
            DetectedAt__c = System.now(),
            HiddenAt__c = hidden ? System.now() : null,
            PrimaryRecordType__c = 'Account',
            PrimaryRecordId__c = UserInfo.getUserId()
        );
        insert f;
        return f;
    }

    @isTest
    static void getLatestScan_returnsNullWhenNoScans() {
        ForensicScan__c s = FindingsListController.getLatestScan();
        System.assertEquals(null, s);
    }

    @isTest
    static void getLatestScan_returnsLatestCompletedScan() {
        ForensicScan__c s1 = seedScan('Completed');
        s1.StartedAt__c = System.now().addDays(-5);
        update s1;
        ForensicScan__c s2 = seedScan('Completed');
        ForensicScan__c s3 = seedScan('Running'); // should be ignored

        ForensicScan__c latest = FindingsListController.getLatestScan();
        System.assertNotEquals(null, latest);
        System.assertEquals(s2.Id, latest.Id);
    }

    @isTest
    static void getLatestScan_includesPartialStatus() {
        seedScan('Partial');
        ForensicScan__c latest = FindingsListController.getLatestScan();
        System.assertNotEquals(null, latest, 'Partial scans should be returned');
    }

    @isTest
    static void getFindings_returnsEmptyWhenScanIdNull() {
        List<FindingsListController.FindingRow> rows = FindingsListController.getFindings(null, false);
        System.assertEquals(0, rows.size());
    }

    @isTest
    static void getFindings_excludesHiddenByDefault() {
        ForensicScan__c scan = seedScan('Completed');
        seedFinding(scan.Id, 'REN-001', 5000, false);
        seedFinding(scan.Id, 'REN-002', 3000, true);  // hidden

        List<FindingsListController.FindingRow> rows = FindingsListController.getFindings(scan.Id, false);
        System.assertEquals(1, rows.size());
        System.assertEquals('REN-001', rows[0].detectorId);
    }

    @isTest
    static void getFindings_includesHiddenWhenRequested() {
        ForensicScan__c scan = seedScan('Completed');
        seedFinding(scan.Id, 'REN-001', 5000, false);
        seedFinding(scan.Id, 'REN-002', 3000, true);

        List<FindingsListController.FindingRow> rows = FindingsListController.getFindings(scan.Id, true);
        System.assertEquals(2, rows.size());
    }

    @isTest
    static void getFindings_ordersByGapDesc() {
        ForensicScan__c scan = seedScan('Completed');
        seedFinding(scan.Id, 'REN-001', 1000, false);
        seedFinding(scan.Id, 'REN-002', 8000, false);
        seedFinding(scan.Id, 'DSC-FOR-001', 3000, false);

        List<FindingsListController.FindingRow> rows = FindingsListController.getFindings(scan.Id, false);
        System.assertEquals(3, rows.size());
        System.assertEquals(8000, rows[0].gapUsd);
        System.assertEquals(3000, rows[1].gapUsd);
        System.assertEquals(1000, rows[2].gapUsd);
    }

    @isTest
    static void getFindingDetail_throwsWhenIdNull() {
        try {
            FindingsListController.getFindingDetail(null);
            System.assert(false, 'Should have thrown');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
    }

    @isTest
    static void getFindingDetail_throwsWhenFindingNotFound() {
        try {
            FindingsListController.getFindingDetail(UserInfo.getUserId());
            System.assert(false, 'Should have thrown');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
    }

    @isTest
    static void getFindingDetail_returnsFullDetail() {
        ForensicScan__c scan = seedScan('Completed');
        ForensicFinding__c f = seedFinding(scan.Id, 'REN-001', 5000, false);

        // Add an attribution trace
        AttributionTrace__c t = new AttributionTrace__c(
            ForensicFinding__c = f.Id,
            RootCauseClass__c = 'C',
            ReasonCode__c = 'manual_override',
            Confidence__c = 0.8
        );
        insert t;

        // Add a recovery action
        RecoveryAction__c a = new RecoveryAction__c(
            ForensicFinding__c = f.Id,
            ApprovalStatus__c = 'Pending',
            ProjectedReclaimUsd__c = 5000
        );
        insert a;

        FindingsListController.FindingDetail detail = FindingsListController.getFindingDetail(f.Id);
        System.assertNotEquals(null, detail);
        System.assertEquals(f.Id, detail.finding.id);
        System.assertEquals('REN-001', detail.finding.detectorId);
        System.assertEquals(1, detail.traces.size());
        System.assertNotEquals(null, detail.recoveryAction);
        System.assertEquals('Pending', detail.recoveryAction.ApprovalStatus__c);
    }

    @isTest
    static void getFindingDetail_handlesNoTracesOrActions() {
        ForensicScan__c scan = seedScan('Completed');
        ForensicFinding__c f = seedFinding(scan.Id, 'REN-001', 5000, false);

        FindingsListController.FindingDetail detail = FindingsListController.getFindingDetail(f.Id);
        System.assertEquals(0, detail.traces.size());
        System.assertEquals(null, detail.recoveryAction);
    }

    @isTest
    static void hideFinding_togglesOnOff() {
        ForensicScan__c scan = seedScan('Completed');
        ForensicFinding__c f = seedFinding(scan.Id, 'REN-001', 5000, false);

        // First call hides
        Boolean isHidden = FindingsListController.hideFinding(f.Id);
        System.assertEquals(true, isHidden);
        ForensicFinding__c after = [SELECT HiddenAt__c FROM ForensicFinding__c WHERE Id = :f.Id];
        System.assertNotEquals(null, after.HiddenAt__c);

        // Second call unhides
        isHidden = FindingsListController.hideFinding(f.Id);
        System.assertEquals(false, isHidden);
        after = [SELECT HiddenAt__c FROM ForensicFinding__c WHERE Id = :f.Id];
        System.assertEquals(null, after.HiddenAt__c);
    }

    @isTest
    static void bulkHide_returnsZeroForEmptyOrNull() {
        System.assertEquals(0, FindingsListController.bulkHide(null));
        System.assertEquals(0, FindingsListController.bulkHide(new List<Id>()));
    }

    @isTest
    static void bulkHide_hidesUnhiddenFindings() {
        ForensicScan__c scan = seedScan('Completed');
        ForensicFinding__c f1 = seedFinding(scan.Id, 'REN-001', 5000, false);
        ForensicFinding__c f2 = seedFinding(scan.Id, 'REN-002', 3000, false);
        ForensicFinding__c f3 = seedFinding(scan.Id, 'DSC-FOR-001', 2000, true); // already hidden

        Integer hidden = FindingsListController.bulkHide(new List<Id>{ f1.Id, f2.Id, f3.Id });
        System.assertEquals(2, hidden, 'Already-hidden f3 should be skipped');
    }

    @isTest
    static void bulkHide_throwsWhenOver500() {
        List<Id> tooMany = new List<Id>();
        for (Integer i = 0; i < 501; i++) tooMany.add(UserInfo.getUserId());
        try {
            FindingsListController.bulkHide(tooMany);
            System.assert(false, 'Should throw');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
    }

    @isTest
    static void updateNote_setsAndClears() {
        ForensicScan__c scan = seedScan('Completed');
        ForensicFinding__c f = seedFinding(scan.Id, 'REN-001', 5000, false);

        // Set a note
        FindingsListController.updateNote(f.Id, 'This is a real finding, will fix');
        ForensicFinding__c after = [SELECT ConsultantNote__c, ConsultantNoteUpdatedAt__c FROM ForensicFinding__c WHERE Id = :f.Id];
        System.assertEquals('This is a real finding, will fix', after.ConsultantNote__c);
        System.assertNotEquals(null, after.ConsultantNoteUpdatedAt__c);

        // Clear it with empty string
        FindingsListController.updateNote(f.Id, '   ');
        after = [SELECT ConsultantNote__c, ConsultantNoteUpdatedAt__c FROM ForensicFinding__c WHERE Id = :f.Id];
        System.assertEquals(null, after.ConsultantNote__c);
        System.assertEquals(null, after.ConsultantNoteUpdatedAt__c);

        // Clear with null
        FindingsListController.updateNote(f.Id, 'something');
        FindingsListController.updateNote(f.Id, null);
        after = [SELECT ConsultantNote__c FROM ForensicFinding__c WHERE Id = :f.Id];
        System.assertEquals(null, after.ConsultantNote__c);
    }

    @isTest
    static void updateNote_truncatesLongNotes() {
        ForensicScan__c scan = seedScan('Completed');
        ForensicFinding__c f = seedFinding(scan.Id, 'REN-001', 5000, false);

        String huge = '';
        for (Integer i = 0; i < 500; i++) huge += '0123456789'; // 5000 chars
        FindingsListController.updateNote(f.Id, huge);
        ForensicFinding__c after = [SELECT ConsultantNote__c FROM ForensicFinding__c WHERE Id = :f.Id];
        System.assertEquals(4000, after.ConsultantNote__c.length(), 'Should truncate to 4000');
    }
}
