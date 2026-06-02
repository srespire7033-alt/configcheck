/**
 * CSV export endpoints for the dashboard. Returns CSV content as a
 * single String so the LWC can wrap it in a Blob + trigger a browser
 * download. Lightweight by design — no PDF generation or external
 * service calls; that's a later sub-phase.
 *
 * Two reports:
 *   getFindingsCsv()         → all unhidden findings from the latest scan
 *   getRecoveryActionsCsv()  → every RecoveryAction__c grouped by status
 */
public with sharing class ExportController {

    /** CSV-escape: wrap in quotes + double any embedded quotes. */
    private static String esc(Object value) {
        if (value == null) return '';
        String s = String.valueOf(value).replace('"', '""');
        return '"' + s + '"';
    }

    @AuraEnabled(cacheable=true)
    public static String getFindingsCsv() {
        // Latest completed scan first.
        List<ForensicScan__c> scans = [
            SELECT Id, Name FROM ForensicScan__c
            WHERE Status__c IN ('Completed', 'Partial')
            ORDER BY StartedAt__c DESC LIMIT 1
        ];
        if (scans.isEmpty()) return '';

        Id scanId = scans[0].Id;
        List<ForensicFinding__c> rows = [
            SELECT Id, DetectorId__c, Title__c, Description__c, Severity__c,
                   EntitledUsd__c, RealizedUsd__c, GapUsd__c, RecoverabilityScore__c,
                   CurrencyIsoCode, PrimaryRecordType__c, PrimaryRecordId__c,
                   DetectedAt__c, ConsultantNote__c
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId
              AND HiddenAt__c = null
            ORDER BY GapUsd__c DESC
            LIMIT 5000
        ];

        List<String> lines = new List<String>();
        lines.add(String.join(new List<String>{
            'Finding ID','Detector','Title','Severity','Entitled USD','Realized USD',
            'Gap USD','Recoverability','Currency','Primary Record Type','Primary Record ID',
            'Detected At','Consultant Note'
        }, ','));

        for (ForensicFinding__c f : rows) {
            lines.add(String.join(new List<String>{
                esc(f.Id),
                esc(f.DetectorId__c),
                esc(f.Title__c),
                esc(f.Severity__c),
                esc(f.EntitledUsd__c),
                esc(f.RealizedUsd__c),
                esc(f.GapUsd__c),
                esc(f.RecoverabilityScore__c),
                esc(f.CurrencyIsoCode),
                esc(f.PrimaryRecordType__c),
                esc(f.PrimaryRecordId__c),
                esc(f.DetectedAt__c),
                esc(f.ConsultantNote__c)
            }, ','));
        }
        return String.join(lines, '\n');
    }

    @AuraEnabled(cacheable=true)
    public static String getRecoveryActionsCsv() {
        List<RecoveryAction__c> rows = [
            SELECT Id, ApprovalStatus__c, ProjectedReclaimUsd__c,
                   ApprovedAt__c, CommittedAt__c, CommitVerified__c,
                   VerificationMessage__c,
                   ForensicFinding__c, ForensicFinding__r.Title__c,
                   ForensicFinding__r.DetectorId__c,
                   ForensicFinding__r.GapUsd__c
            FROM RecoveryAction__c
            ORDER BY CreatedDate DESC
            LIMIT 5000
        ];

        List<String> lines = new List<String>();
        lines.add(String.join(new List<String>{
            'Recovery ID','Finding ID','Detector','Finding Title','Status',
            'Projected Reclaim USD','Finding Gap USD','Approved At','Committed At',
            'Commit Verified','Verification Message'
        }, ','));

        for (RecoveryAction__c r : rows) {
            String title = r.ForensicFinding__r != null ? r.ForensicFinding__r.Title__c : null;
            String detector = r.ForensicFinding__r != null ? r.ForensicFinding__r.DetectorId__c : null;
            Decimal findingGap = r.ForensicFinding__r != null ? r.ForensicFinding__r.GapUsd__c : null;
            lines.add(String.join(new List<String>{
                esc(r.Id),
                esc(r.ForensicFinding__c),
                esc(detector),
                esc(title),
                esc(r.ApprovalStatus__c),
                esc(r.ProjectedReclaimUsd__c),
                esc(findingGap),
                esc(r.ApprovedAt__c),
                esc(r.CommittedAt__c),
                esc(r.CommitVerified__c),
                esc(r.VerificationMessage__c)
            }, ','));
        }
        return String.join(lines, '\n');
    }
}
