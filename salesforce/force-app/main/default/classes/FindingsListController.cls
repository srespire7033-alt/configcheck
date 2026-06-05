/**
 * @AuraEnabled controller for the findingsList LWC + finding-detail
 * UI. Provides typed DTOs so the LWC datatable can render cleanly
 * without doing field-massaging on the client.
 *
 * All methods are @AuraEnabled(cacheable=true) where they don't
 * mutate state, so the Lightning data refresh + wire-pattern works
 * naturally.
 *
 * Methods:
 *   getLatestScan()                     — returns the most recent ForensicScan__c
 *   getFindings(scanId, includeHidden)  — paginated finding rows for a scan
 *   getFindingDetail(findingId)         — single finding + trace + recovery action
 *   hideFinding(findingId)              — toggle hidden_at on/off
 *   updateNote(findingId, note)         — set ConsultantNote__c + timestamp
 *   bulkHide(findingIds[])              — atomic batch hide
 */
public with sharing class FindingsListController {

    /** Wire-cacheable shape for the findings table. */
    public class FindingRow {
        @AuraEnabled public Id id;
        @AuraEnabled public String detectorId;
        @AuraEnabled public String title;
        @AuraEnabled public String severity;
        @AuraEnabled public Decimal gapUsd;
        @AuraEnabled public String currencyIsoCode;
        @AuraEnabled public Datetime detectedAt;
        @AuraEnabled public Datetime hiddenAt;
        @AuraEnabled public String consultantNote;
        @AuraEnabled public String primaryRecordType;
        @AuraEnabled public Id primaryRecordId;
    }

    public class FindingDetail {
        @AuraEnabled public FindingRow finding;
        @AuraEnabled public ForensicFinding__c raw; // for advanced fields
        @AuraEnabled public List<AttributionTrace__c> traces;
        @AuraEnabled public RecoveryAction__c recoveryAction; // most recent, may be null
    }

    /** The most recent ForensicScan__c, or null if no scans exist. */
    @AuraEnabled(cacheable=true)
    public static ForensicScan__c getLatestScan() {
        List<ForensicScan__c> rows = [
            SELECT Id, Name, Status__c, ProductType__c, StartedAt__c, CompletedAt__c,
                   TotalLeakageUsd__c, FindingCount__c, ErrorMessage__c
            FROM ForensicScan__c
            WHERE Status__c IN ('Completed', 'Partial')
            WITH SECURITY_ENFORCED ORDER BY StartedAt__c DESC
            LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0];
    }

    /** Findings for a given scan. Default excludes hidden rows. */
    @AuraEnabled(cacheable=true)
    public static List<FindingRow> getFindings(Id scanId, Boolean includeHidden) {
        if (scanId == null) return new List<FindingRow>();
        Boolean withHidden = (includeHidden == true);

        String soql =
            'SELECT Id, DetectorId__c, Title__c, Severity__c, GapUsd__c' + CurrencyContext.soqlSelect() + ', ' +
            '       DetectedAt__c, HiddenAt__c, ConsultantNote__c, ' +
            '       PrimaryRecordType__c, PrimaryRecordId__c ' +
            'FROM ForensicFinding__c ' +
            'WHERE ForensicScan__c = :scanId ' +
            (withHidden ? '' : 'AND HiddenAt__c = null ') +
            'ORDER BY GapUsd__c DESC ' +
            'LIMIT 500';
        List<ForensicFinding__c> rows = Database.query(soql);

        List<FindingRow> out = new List<FindingRow>();
        for (ForensicFinding__c f : rows) {
            FindingRow r = new FindingRow();
            r.id = f.Id;
            r.detectorId = f.DetectorId__c;
            r.title = f.Title__c;
            r.severity = f.Severity__c;
            r.gapUsd = f.GapUsd__c;
            r.currencyIsoCode = CurrencyContext.read(f);
            r.detectedAt = f.DetectedAt__c;
            r.hiddenAt = f.HiddenAt__c;
            r.consultantNote = f.ConsultantNote__c;
            r.primaryRecordType = f.PrimaryRecordType__c;
            r.primaryRecordId = f.PrimaryRecordId__c;
            out.add(r);
        }
        return out;
    }

    /** Full detail for one finding: raw record + traces + recovery action. */
    @AuraEnabled(cacheable=true)
    public static FindingDetail getFindingDetail(Id findingId) {
        if (findingId == null) {
            throw new AuraHandledException('findingId is required');
        }

        String findingSoql =
            'SELECT Id, DetectorId__c, Title__c, Description__c, Severity__c, ' +
            '       EntitledUsd__c, RealizedUsd__c, GapUsd__c, RecoverabilityScore__c' +
            CurrencyContext.soqlSelect() + ', DetectedAt__c, HiddenAt__c, ConsultantNote__c, ' +
            '       ConsultantNoteUpdatedAt__c, PrimaryRecordType__c, PrimaryRecordId__c, ' +
            '       SourceRecordRefs__c, Metadata__c, Status__c ' +
            'FROM ForensicFinding__c ' +
            'WHERE Id = :findingId ' +
            'WITH SECURITY_ENFORCED LIMIT 1';
        List<ForensicFinding__c> findings = Database.query(findingSoql);
        if (findings.isEmpty()) {
            throw new AuraHandledException('Finding not found');
        }
        ForensicFinding__c finding = findings[0];

        List<AttributionTrace__c> traces = [
            SELECT Id, RootCauseClass__c, RootConfigType__c, RootConfigId__c,
                   RootConfigName__c, ReasonCode__c, Confidence__c, Evidence__c,
                   AiExplanation__c, AiSuggestedFix__c, AiModel__c
            FROM AttributionTrace__c
            WHERE ForensicFinding__c = :findingId
            WITH SECURITY_ENFORCED ORDER BY Confidence__c DESC
        ];

        List<RecoveryAction__c> actions = [
            SELECT Id, ApprovalStatus__c, ProjectedReclaimUsd__c, DraftPayload__c,
                   ApprovedAt__c, CommittedAt__c, CommitVerified__c,
                   VerificationMessage__c, ExpectedValue__c, ActualValue__c
            FROM RecoveryAction__c
            WHERE ForensicFinding__c = :findingId
            WITH SECURITY_ENFORCED ORDER BY CreatedDate DESC
            LIMIT 1
        ];

        FindingDetail detail = new FindingDetail();
        detail.raw = finding;
        detail.finding = toRow(finding);
        detail.traces = traces;
        detail.recoveryAction = actions.isEmpty() ? null : actions[0];
        return detail;
    }

    /** Toggle hidden_at on a finding. Returns the new state. */
    @AuraEnabled
    public static Boolean hideFinding(Id findingId) {
        ForensicFinding__c f = [
            SELECT Id, HiddenAt__c FROM ForensicFinding__c
            WHERE Id = :findingId WITH SECURITY_ENFORCED LIMIT 1
        ];
        f.HiddenAt__c = (f.HiddenAt__c == null) ? System.now() : null;
        update f;
        return (f.HiddenAt__c != null);
    }

    /** Atomic bulk hide. Returns the count actually changed. */
    @AuraEnabled
    public static Integer bulkHide(List<Id> findingIds) {
        if (findingIds == null || findingIds.isEmpty()) return 0;
        if (findingIds.size() > 500) {
            throw new AuraHandledException('Batch limit is 500');
        }
        List<ForensicFinding__c> rows = [
            SELECT Id, HiddenAt__c FROM ForensicFinding__c
            WHERE Id IN :findingIds AND HiddenAt__c = null WITH SECURITY_ENFORCED ];
        Datetime now = System.now();
        for (ForensicFinding__c f : rows) f.HiddenAt__c = now;
        update rows;
        return rows.size();
    }

    /** Set / clear the consultant note on a finding. Empty/null clears it. */
    @AuraEnabled
    public static void updateNote(Id findingId, String note) {
        ForensicFinding__c f = [
            SELECT Id, ConsultantNote__c, ConsultantNoteUpdatedAt__c
            FROM ForensicFinding__c
            WHERE Id = :findingId WITH SECURITY_ENFORCED LIMIT 1
        ];
        String cleaned = (note == null || note.trim() == '') ? null : note.left(4000);
        f.ConsultantNote__c = cleaned;
        f.ConsultantNoteUpdatedAt__c = (cleaned == null) ? null : System.now();
        update f;
    }

    private static FindingRow toRow(ForensicFinding__c f) {
        FindingRow r = new FindingRow();
        r.id = f.Id;
        r.detectorId = f.DetectorId__c;
        r.title = f.Title__c;
        r.severity = f.Severity__c;
        r.gapUsd = f.GapUsd__c;
        r.currencyIsoCode = CurrencyContext.read(f);
        r.detectedAt = f.DetectedAt__c;
        r.hiddenAt = f.HiddenAt__c;
        r.consultantNote = f.ConsultantNote__c;
        r.primaryRecordType = f.PrimaryRecordType__c;
        r.primaryRecordId = f.PrimaryRecordId__c;
        return r;
    }
}
