/**
 * Exercises both CSV exports: empty cases + populated cases. CSV
 * format is checked at the header level + spot-check finding data.
 */
@isTest
private class ExportControllerTest {

    @isTest
    static void getFindingsCsv_returnsEmptyWhenNoScans() {
        String csv = ExportController.getFindingsCsv();
        System.assertEquals('', csv);
    }

    @isTest
    static void getFindingsCsv_emitsHeaderAndRows() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now(), CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 50000, FindingCount__c = 2
        );
        insert scan;
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(
                ForensicScan__c = scan.Id, DetectorId__c = 'REN-001',
                Severity__c = 'Critical', EntitledUsd__c = 30000,
                RealizedUsd__c = 10000, GapUsd__c = 20000,
                Title__c = 'Acme renewal "uplift" suppressed',  // embedded quote!
                Status__c = 'Open', DetectedAt__c = System.now()
            ),
            new ForensicFinding__c(
                ForensicScan__c = scan.Id, DetectorId__c = 'QL-FOR-001',
                Severity__c = 'Warning', EntitledUsd__c = 8000,
                RealizedUsd__c = 0, GapUsd__c = 8000,
                Title__c = 'Bundle option, default $0',  // embedded comma
                Status__c = 'Open', DetectedAt__c = System.now()
            )
        };

        String csv = ExportController.getFindingsCsv();
        System.assert(csv.length() > 0);
        // Header row check.
        System.assert(csv.startsWith('Finding ID,Detector,Title'));
        // Embedded quote should be doubled.
        System.assert(csv.contains('"Acme renewal ""uplift"" suppressed"'),
            'CSV must escape embedded quotes');
        // Embedded comma should be wrapped in quotes.
        System.assert(csv.contains('"Bundle option, default $0"'),
            'CSV must quote-wrap titles with commas');
    }

    @isTest
    static void getRecoveryActionsCsv_returnsHeaderWhenEmpty() {
        String csv = ExportController.getRecoveryActionsCsv();
        // Header row even when there are no data rows.
        System.assert(csv.startsWith('Recovery ID,Finding ID'));
    }

    @isTest
    static void getRecoveryActionsCsv_populated() {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Completed', ProductType__c = 'CPQ',
            StartedAt__c = System.now(), CompletedAt__c = System.now(),
            TotalLeakageUsd__c = 10000, FindingCount__c = 1
        );
        insert scan;
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c = scan.Id, DetectorId__c = 'REN-001',
            Severity__c = 'Warning', EntitledUsd__c = 10000,
            RealizedUsd__c = 4000, GapUsd__c = 6000,
            Title__c = 'Acme', Status__c = 'Open', DetectedAt__c = System.now()
        );
        insert f;
        insert new RecoveryAction__c(
            ForensicFinding__c = f.Id,
            ApprovalStatus__c = 'Pending',
            ProjectedReclaimUsd__c = 6000
        );

        String csv = ExportController.getRecoveryActionsCsv();
        System.assert(csv.contains('Pending'), 'Status column should include Pending');
        System.assert(csv.contains('6000'), 'Projected reclaim should be present');
    }
}
