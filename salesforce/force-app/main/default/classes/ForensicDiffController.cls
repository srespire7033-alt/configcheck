/**
 * ForensicDiffController — compares the two most recent completed ForensicScans
 * and emits a DiffDto identical in shape to the SaaS forensic-diff endpoint.
 *
 * Categorizes each finding (by detector_id + primary_record_id fingerprint) into:
 *   - new        — only in 'to'
 *   - escalated  — same fp, gap went UP by > $1
 *   - improved   — same fp, gap went DOWN by > $1
 *   - resolved   — only in 'from'
 *   - unchanged  — within ±$1 (dropped)
 *
 * Pure aggregation. Read-only. No DML. Cacheable.
 */
public with sharing class ForensicDiffController {

    private static final Decimal TOLERANCE_USD = 1;

    /** Top-level DTO returned to LWC. Null when fewer than 2 completed scans exist. */
    public class DiffDto {
        @AuraEnabled public ScanRef fromScan;
        @AuraEnabled public ScanRef toScan;
        @AuraEnabled public Decimal netDeltaUsd;
        @AuraEnabled public Decimal netDeltaPct;
        @AuraEnabled public Decimal fromTotalUsd;
        @AuraEnabled public Decimal toTotalUsd;
        @AuraEnabled public DiffSummary summary;
        @AuraEnabled public List<DiffRow> newFindings;     // 'new' is reserved in Apex
        @AuraEnabled public List<DiffRow> escalated;
        @AuraEnabled public List<DiffRow> resolved;
        @AuraEnabled public List<DiffRow> improved;
    }

    public class ScanRef {
        @AuraEnabled public Id id;
        @AuraEnabled public Datetime completedAt;
        @AuraEnabled public Integer findingCount;
    }

    public class DiffSummary {
        @AuraEnabled public Integer newCount = 0;
        @AuraEnabled public Decimal newTotalUsd = 0;
        @AuraEnabled public Integer escalatedCount = 0;
        @AuraEnabled public Decimal escalatedTotalUsd = 0;
        @AuraEnabled public Integer resolvedCount = 0;
        @AuraEnabled public Decimal resolvedTotalUsd = 0;
        @AuraEnabled public Integer improvedCount = 0;
        @AuraEnabled public Decimal improvedTotalUsd = 0;
    }

    public class DiffRow {
        @AuraEnabled public Id id;
        @AuraEnabled public String detectorId;
        @AuraEnabled public String title;
        @AuraEnabled public Decimal gapUsd;
        @AuraEnabled public Decimal prevGapUsd;  // populated for escalated/improved only
        @AuraEnabled public Decimal deltaUsd;    // populated for escalated/improved only
    }

    @AuraEnabled(cacheable=true)
    public static DiffDto getLatestDiff(Id connectedOrgId) {
        // Pick the two most recent completed scans. When the dashboard
        // is filtered to a specific Connected Org (Phase 8c URL state),
        // narrow the diff to that org's scans only — otherwise the
        // "What's Changed" page would compare scans across unrelated
        // target orgs.
        List<ForensicScan__c> recent;
        if (connectedOrgId != null) {
            recent = [
                SELECT Id, CompletedAt__c, FindingCount__c
                FROM ForensicScan__c
                WHERE Status__c = 'Completed'
                  AND ConnectedOrg__c = :connectedOrgId
                WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST
                LIMIT 2
            ];
        } else {
            recent = [
                SELECT Id, CompletedAt__c, FindingCount__c
                FROM ForensicScan__c
                WHERE Status__c = 'Completed'
                  AND ConnectedOrg__c = null
                WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST
                LIMIT 2
            ];
        }
        if (recent.size() < 2) return null;

        // recent[0] = newest = toScan; recent[1] = older = fromScan
        ForensicScan__c toScan = recent[0];
        ForensicScan__c fromScan = recent[1];

        List<ForensicFinding__c> fromFindings = queryFindings(fromScan.Id);
        List<ForensicFinding__c> toFindings   = queryFindings(toScan.Id);

        // Fingerprint maps
        Map<String, ForensicFinding__c> fromByFp = new Map<String, ForensicFinding__c>();
        for (ForensicFinding__c f : fromFindings) fromByFp.put(fingerprint(f), f);
        Map<String, ForensicFinding__c> toByFp = new Map<String, ForensicFinding__c>();
        for (ForensicFinding__c f : toFindings) toByFp.put(fingerprint(f), f);

        DiffDto dto = new DiffDto();
        dto.summary = new DiffSummary();
        dto.newFindings = new List<DiffRow>();
        dto.escalated = new List<DiffRow>();
        dto.resolved = new List<DiffRow>();
        dto.improved = new List<DiffRow>();
        dto.fromTotalUsd = 0;
        dto.toTotalUsd = 0;

        // Pass 1: classify 'to' findings against 'from'
        for (ForensicFinding__c tf : toFindings) {
            Decimal tfGap = tf.GapUsd__c == null ? 0 : tf.GapUsd__c;
            dto.toTotalUsd += tfGap;

            String fp = fingerprint(tf);
            ForensicFinding__c prev = fromByFp.get(fp);
            if (prev == null) {
                dto.newFindings.add(rowFrom(tf));
                dto.summary.newCount += 1;
                dto.summary.newTotalUsd += tfGap;
                continue;
            }
            Decimal prevGap = prev.GapUsd__c == null ? 0 : prev.GapUsd__c;
            Decimal delta = tfGap - prevGap;
            if (Math.abs(delta) <= TOLERANCE_USD) continue; // unchanged

            DiffRow row = rowFrom(tf);
            row.prevGapUsd = prevGap;
            row.deltaUsd = delta;
            if (delta > 0) {
                dto.escalated.add(row);
                dto.summary.escalatedCount += 1;
                dto.summary.escalatedTotalUsd += delta;
            } else {
                dto.improved.add(row);
                dto.summary.improvedCount += 1;
                dto.summary.improvedTotalUsd += Math.abs(delta);
            }
        }

        // Pass 2: 'from' findings missing from 'to' are resolved
        for (ForensicFinding__c ff : fromFindings) {
            Decimal ffGap = ff.GapUsd__c == null ? 0 : ff.GapUsd__c;
            dto.fromTotalUsd += ffGap;
            if (!toByFp.containsKey(fingerprint(ff))) {
                dto.resolved.add(rowFrom(ff));
                dto.summary.resolvedCount += 1;
                dto.summary.resolvedTotalUsd += ffGap;
            }
        }

        dto.netDeltaUsd = round2(dto.toTotalUsd - dto.fromTotalUsd);
        dto.netDeltaPct = dto.fromTotalUsd > 0
            ? round2(((dto.toTotalUsd - dto.fromTotalUsd) / dto.fromTotalUsd) * 100)
            : 0;
        dto.fromTotalUsd = round2(dto.fromTotalUsd);
        dto.toTotalUsd = round2(dto.toTotalUsd);

        // Sort each bucket by $ impact desc
        sortByGapDesc(dto.newFindings);
        sortByGapDesc(dto.resolved);
        sortByDeltaDesc(dto.escalated, true);   // largest positive first
        sortByDeltaDesc(dto.improved, false);   // largest absolute (most negative) first

        dto.fromScan = scanRef(fromScan);
        dto.toScan = scanRef(toScan);
        return dto;
    }

    // ────────── helpers ──────────

    private static List<ForensicFinding__c> queryFindings(Id scanId) {
        return [
            SELECT Id, DetectorId__c, Title__c, GapUsd__c, PrimaryRecordId__c
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId AND HiddenAt__c = null WITH SECURITY_ENFORCED ];
    }

    private static String fingerprint(ForensicFinding__c f) {
        String pid = String.isBlank(f.PrimaryRecordId__c) ? 'no-record' : f.PrimaryRecordId__c;
        return (f.DetectorId__c == null ? '' : f.DetectorId__c) + '::' + pid;
    }

    private static DiffRow rowFrom(ForensicFinding__c f) {
        DiffRow r = new DiffRow();
        r.id = f.Id;
        r.detectorId = f.DetectorId__c;
        r.title = f.Title__c;
        r.gapUsd = f.GapUsd__c == null ? 0 : f.GapUsd__c;
        return r;
    }

    private static ScanRef scanRef(ForensicScan__c s) {
        ScanRef r = new ScanRef();
        r.id = s.Id;
        r.completedAt = s.CompletedAt__c;
        r.findingCount = s.FindingCount__c == null ? 0 : Integer.valueOf(s.FindingCount__c);
        return r;
    }

    private static Decimal round2(Decimal n) {
        if (n == null) return 0;
        return n.setScale(2, System.RoundingMode.HALF_UP);
    }

    private static void sortByGapDesc(List<DiffRow> rows) {
        rows.sort(new DiffRowGapComparator());
    }
    private static void sortByDeltaDesc(List<DiffRow> rows, Boolean signedDesc) {
        rows.sort(new DiffRowDeltaComparator(signedDesc));
    }

    public class DiffRowGapComparator implements Comparator<DiffRow> {
        public Integer compare(DiffRow a, DiffRow b) {
            Decimal av = a.gapUsd == null ? 0 : a.gapUsd;
            Decimal bv = b.gapUsd == null ? 0 : b.gapUsd;
            if (bv > av) return 1;
            if (bv < av) return -1;
            return 0;
        }
    }

    public class DiffRowDeltaComparator implements Comparator<DiffRow> {
        private Boolean signedDesc;
        public DiffRowDeltaComparator(Boolean signedDesc) { this.signedDesc = signedDesc; }
        public Integer compare(DiffRow a, DiffRow b) {
            Decimal av = a.deltaUsd == null ? 0 : (signedDesc ? a.deltaUsd : Math.abs(a.deltaUsd));
            Decimal bv = b.deltaUsd == null ? 0 : (signedDesc ? b.deltaUsd : Math.abs(b.deltaUsd));
            if (bv > av) return 1;
            if (bv < av) return -1;
            return 0;
        }
    }
}
