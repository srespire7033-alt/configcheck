@isTest
private class ForensicDiffControllerTest {

    @isTest
    static void returnsNullWhenLessThanTwoScans() {
        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Completed', CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 0, FindingCount__c = 0
        );
        insert s;
        Test.startTest();
        ForensicDiffController.DiffDto dto = ForensicDiffController.getLatestDiff(null);
        Test.stopTest();
        System.assertEquals(null, dto, 'Single scan → no diff');
    }

    @isTest
    static void computesFourBucketsCorrectly() {
        // From scan: 2 findings. To scan: same 2 with one mutated + 1 new + 1 resolved.
        Datetime t1 = System.now().addHours(-2);
        Datetime t2 = System.now();

        ForensicScan__c fromScan = new ForensicScan__c(
            Status__c = 'Completed', CompletedAt__c = t1,
            TotalLeakageUsd__c = 25000, FindingCount__c = 3
        );
        ForensicScan__c toScan = new ForensicScan__c(
            Status__c = 'Completed', CompletedAt__c = t2,
            TotalLeakageUsd__c = 30000, FindingCount__c = 3
        );
        insert new List<ForensicScan__c>{ fromScan, toScan };

        // FROM findings:
        //   - REN-001 ::recA  gap=10000  (will appear in TO as 15000 → ESCALATED +5000)
        //   - REN-001 ::recB  gap= 8000  (will appear in TO as  3000 → IMPROVED -5000)
        //   - QL-FOR-001 ::recC gap= 7000 (NOT in TO → RESOLVED)
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(
                ForensicScan__c = fromScan.Id, DetectorId__c = 'REN-001',
                PrimaryRecordId__c = 'recA', Title__c = 'Renewal A',
                Severity__c = 'Critical', GapUsd__c = 10000, EntitledUsd__c=10000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c = t1
            ),
            new ForensicFinding__c(
                ForensicScan__c = fromScan.Id, DetectorId__c = 'REN-001',
                PrimaryRecordId__c = 'recB', Title__c = 'Renewal B',
                Severity__c = 'Warning', GapUsd__c = 8000, EntitledUsd__c=8000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c = t1
            ),
            new ForensicFinding__c(
                ForensicScan__c = fromScan.Id, DetectorId__c = 'QL-FOR-001',
                PrimaryRecordId__c = 'recC', Title__c = 'Bundle gap',
                Severity__c = 'Info', GapUsd__c = 7000, EntitledUsd__c=7000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c = t1
            )
        };

        // TO findings:
        //   - REN-001 ::recA  gap=15000  (ESCALATED +5000)
        //   - REN-001 ::recB  gap= 3000  (IMPROVED -5000)
        //   - REN-002 ::recX  gap=12000  (NEW)
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(
                ForensicScan__c = toScan.Id, DetectorId__c = 'REN-001',
                PrimaryRecordId__c = 'recA', Title__c = 'Renewal A',
                Severity__c = 'Critical', GapUsd__c = 15000, EntitledUsd__c=15000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c = t2
            ),
            new ForensicFinding__c(
                ForensicScan__c = toScan.Id, DetectorId__c = 'REN-001',
                PrimaryRecordId__c = 'recB', Title__c = 'Renewal B',
                Severity__c = 'Warning', GapUsd__c = 3000, EntitledUsd__c=3000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c = t2
            ),
            new ForensicFinding__c(
                ForensicScan__c = toScan.Id, DetectorId__c = 'REN-002',
                PrimaryRecordId__c = 'recX', Title__c = 'Below list',
                Severity__c = 'Critical', GapUsd__c = 12000, EntitledUsd__c=12000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c = t2
            )
        };

        Test.startTest();
        ForensicDiffController.DiffDto dto = ForensicDiffController.getLatestDiff(null);
        Test.stopTest();

        System.assertNotEquals(null, dto, 'Two scans → diff should compute');
        System.assertEquals(1, dto.summary.newCount, 'NEW: only REN-002 recX');
        System.assertEquals(12000, dto.summary.newTotalUsd);
        System.assertEquals(1, dto.summary.escalatedCount, 'ESCALATED: REN-001 recA +5000');
        System.assertEquals(5000, dto.summary.escalatedTotalUsd);
        System.assertEquals(1, dto.summary.improvedCount, 'IMPROVED: REN-001 recB -5000');
        System.assertEquals(5000, dto.summary.improvedTotalUsd, 'Improved total stored as absolute');
        System.assertEquals(1, dto.summary.resolvedCount, 'RESOLVED: QL-FOR-001 recC');
        System.assertEquals(7000, dto.summary.resolvedTotalUsd);

        // Net change = to - from = (15000+3000+12000) - (10000+8000+7000) = 30000 - 25000 = 5000
        System.assertEquals(5000, dto.netDeltaUsd);
        System.assertEquals(toScan.Id, dto.toScan.id);
        System.assertEquals(fromScan.Id, dto.fromScan.id);

        // Row payload sanity
        System.assertEquals('REN-002', dto.newFindings[0].detectorId);
        System.assertEquals(5000, dto.escalated[0].deltaUsd);
        System.assertEquals(10000, dto.escalated[0].prevGapUsd);
    }

    @isTest
    static void unchangedFindingsAreDropped() {
        // Two scans, identical finding within ±$1 → should not appear in any bucket.
        Datetime t1 = System.now().addHours(-1);
        Datetime t2 = System.now();
        ForensicScan__c a = new ForensicScan__c(Status__c='Completed', CompletedAt__c=t1, TotalLeakageUsd__c=1000, FindingCount__c=1);
        ForensicScan__c b = new ForensicScan__c(Status__c='Completed', CompletedAt__c=t2, TotalLeakageUsd__c=1000, FindingCount__c=1);
        insert new List<ForensicScan__c>{ a, b };
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=a.Id, DetectorId__c='REN-001', PrimaryRecordId__c='r1',
                Title__c='X', Severity__c='Critical', GapUsd__c=1000, EntitledUsd__c=1000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=t1),
            new ForensicFinding__c(ForensicScan__c=b.Id, DetectorId__c='REN-001', PrimaryRecordId__c='r1',
                Title__c='X', Severity__c='Critical', GapUsd__c=1000.50, EntitledUsd__c=1000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=t2)
        };
        Test.startTest();
        ForensicDiffController.DiffDto dto = ForensicDiffController.getLatestDiff(null);
        Test.stopTest();
        System.assertEquals(0, dto.summary.newCount + dto.summary.escalatedCount
                                + dto.summary.improvedCount + dto.summary.resolvedCount,
            'Within ±$1 → no bucket');
    }
}
