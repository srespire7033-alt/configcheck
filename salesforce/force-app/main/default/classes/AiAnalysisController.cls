/**
 * AiAnalysisController — produces the deterministic "AI-Powered Analysis"
 * summary for the dashboard card.
 *
 * Output:
 *   headline           — "Your org has N critical issue(s) centred on X and Y."
 *   topCategories      — top 3 categories by critical count (label + counts + key)
 *   residualCritical   — critical count NOT in topCategories
 *   residualWarning    — warning count NOT in topCategories
 *   residualCategories — number of other categories with any findings
 *
 * The category labels mirror the SaaS getCategoryLabel():
 *   bundle_integrity, product_billing_config, quote_lines, governance, pipeline, pricing, revenue_leakage
 *
 * We use detector→category mapping (same as DashboardController) plus a
 * second pass that groups by a more granular "issueGroup" derived from the
 * detector ID prefix (PBC- / BI- / QL- etc.) so the headline reads naturally.
 */
public with sharing class AiAnalysisController {

    /** Top-level DTO. */
    public class AnalysisDto {
        @AuraEnabled public String headline;
        @AuraEnabled public List<CategoryRow> topCategories;
        @AuraEnabled public Integer residualCritical;
        @AuraEnabled public Integer residualWarning;
        @AuraEnabled public Integer residualCategories;
        @AuraEnabled public Integer totalCritical;
        @AuraEnabled public Integer totalWarning;
        @AuraEnabled public Integer totalInfo;
        @AuraEnabled public String fullAnalysis;
    }

    public class CategoryRow {
        @AuraEnabled public String key;       // stable key for "View" handler
        @AuraEnabled public String label;     // human label
        @AuraEnabled public Integer criticalCount;
        @AuraEnabled public Integer warningCount;
        @AuraEnabled public Integer infoCount;
    }

    // Detector → human-readable category label
    private static final Map<String, String> DETECTOR_LABEL = new Map<String, String>{
        'REN-001'     => 'Renewals',
        'REN-002'     => 'Pricing Discipline',
        'REN-003'     => 'Renewal Pipeline',
        'REN-004'     => 'Renewal Pipeline',
        'DSC-FOR-001' => 'Discount Discipline',
        'DSC-FOR-002' => 'Discount Discipline',
        'QL-FOR-001'  => 'Quote Lines',
        'QL-FOR-002'  => 'Quote Lines',
        'ORD-FOR-001' => 'Product Billing Config',
        'ORD-FOR-002' => 'Order Governance',
        'ORD-FOR-003' => 'Order Governance',
        'SUB-FOR-001' => 'Subscriptions',
        'PROV-FOR-001'=> 'Provisioning',
        'PROV-FOR-002'=> 'Bundle Integrity',
        'OPP-FOR-001' => 'Opportunity Hygiene',
        'CON-FOR-001' => 'Contract Hygiene',
        'AMD-FOR-001' => 'Amendments',
        'AST-FOR-001' => 'Asset Recovery',
        'CT-FOR-001'  => 'Contracted Prices',
        'MDQ-FOR-001' => 'MDQ Pricing'
    };

    @AuraEnabled(cacheable=true)
    public static AnalysisDto getAnalysis() {
        AnalysisDto dto = new AnalysisDto();
        dto.topCategories = new List<CategoryRow>();
        dto.residualCritical = 0;
        dto.residualWarning = 0;
        dto.residualCategories = 0;
        dto.totalCritical = 0;
        dto.totalWarning = 0;
        dto.totalInfo = 0;

        // Latest completed scan
        List<ForensicScan__c> scans = [
            SELECT Id FROM ForensicScan__c
            WHERE Status__c IN ('Completed','Partial')
            WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST
            LIMIT 1
        ];
        if (scans.isEmpty()) {
            dto.headline = 'Run a forensic scan to see your org analysis.';
            return dto;
        }
        Id scanId = scans[0].Id;
        dto.fullAnalysis = null; // no Summary__c field on ForensicScan__c — long-form prose not stored

        // Group findings by label + severity
        Map<String, CategoryRow> byCategory = new Map<String, CategoryRow>();
        for (AggregateResult ar : [
            SELECT DetectorId__c det, Severity__c sev, COUNT(Id) cnt
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId AND HiddenAt__c = null
            WITH SECURITY_ENFORCED GROUP BY DetectorId__c, Severity__c
        ]) {
            String det = (String) ar.get('det');
            String sev = (String) ar.get('sev');
            Integer cnt = (Integer) ar.get('cnt');
            String label = DETECTOR_LABEL.containsKey(det) ? DETECTOR_LABEL.get(det) : det;
            CategoryRow row = byCategory.get(label);
            if (row == null) {
                row = new CategoryRow();
                row.key = label.toLowerCase().replaceAll('[^a-z0-9]+', '_');
                row.label = label;
                row.criticalCount = 0;
                row.warningCount = 0;
                row.infoCount = 0;
                byCategory.put(label, row);
            }
            if (sev == 'Critical')      { row.criticalCount += cnt; dto.totalCritical += cnt; }
            else if (sev == 'Warning')  { row.warningCount += cnt;  dto.totalWarning += cnt; }
            else if (sev == 'Info')     { row.infoCount += cnt;     dto.totalInfo += cnt; }
        }

        // Sort all categories by critical desc, then warning desc
        List<CategoryRow> allRows = byCategory.values();
        allRows.sort(new CategoryRowComparator());

        // Top 3 with at least one critical (or warning if no critical)
        Integer takeN = Math.min(3, allRows.size());
        for (Integer i = 0; i < takeN; i++) {
            CategoryRow r = allRows[i];
            if (r.criticalCount == 0 && r.warningCount == 0 && r.infoCount == 0) break;
            dto.topCategories.add(r);
        }
        // Residual
        for (Integer i = dto.topCategories.size(); i < allRows.size(); i++) {
            CategoryRow r = allRows[i];
            dto.residualCritical += r.criticalCount;
            dto.residualWarning += r.warningCount;
            if (r.criticalCount + r.warningCount + r.infoCount > 0) dto.residualCategories += 1;
        }

        // Build headline (deterministic, mirrors src/app/orgs/[orgId]/page.tsx)
        if (dto.totalCritical > 0) {
            String suffix = '';
            List<String> topLabels = new List<String>();
            for (Integer i = 0; i < Math.min(2, dto.topCategories.size()); i++) {
                if (dto.topCategories[i].criticalCount > 0) topLabels.add(dto.topCategories[i].label);
            }
            if (!topLabels.isEmpty()) {
                suffix = ' centred on ' + String.join(topLabels, ' and ');
            }
            String plural = dto.totalCritical == 1 ? '' : 's';
            dto.headline = 'Your org has ' + dto.totalCritical + ' critical issue' + plural + suffix + '.';
        } else if (dto.totalWarning > 0) {
            String plural = dto.totalWarning == 1 ? '' : 's';
            dto.headline = 'No critical issues — but ' + dto.totalWarning + ' warning' + plural + ' to review.';
        } else {
            dto.headline = 'No critical or warning findings in this scan. Org looks healthy.';
        }
        return dto;
    }

    /**
     * Fetches all findings in a category (by label) grouped by severity for
     * the "View" drill-down modal. Returns the rows with everything the
     * modal needs to render (title, detector, description, gap, impact).
     */
    @AuraEnabled(cacheable=true)
    public static CategoryIssuesDto getCategoryIssues(String categoryLabel) {
        CategoryIssuesDto out = new CategoryIssuesDto();
        out.categoryLabel = categoryLabel;
        out.totalCount = 0;
        out.critical = new List<IssueRow>();
        out.warning = new List<IssueRow>();
        out.info = new List<IssueRow>();

        if (String.isBlank(categoryLabel)) return out;

        List<ForensicScan__c> scans = [
            SELECT Id FROM ForensicScan__c
            WHERE Status__c IN ('Completed','Partial')
            WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST LIMIT 1
        ];
        if (scans.isEmpty()) return out;
        Id scanId = scans[0].Id;

        // Detectors that map to this label
        Set<String> matchingDetectors = new Set<String>();
        for (String det : DETECTOR_LABEL.keySet()) {
            if (DETECTOR_LABEL.get(det) == categoryLabel) matchingDetectors.add(det);
        }
        if (matchingDetectors.isEmpty()) return out;

        for (ForensicFinding__c f : [
            SELECT Id, Name, Title__c, Description__c, DetectorId__c, Severity__c, Status__c,
                   GapUsd__c, EntitledUsd__c, RealizedUsd__c, PrimaryRecordId__c,
                   PrimaryRecordType__c, RecoverabilityScore__c
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId
              AND DetectorId__c IN :matchingDetectors
              AND HiddenAt__c = null
            WITH SECURITY_ENFORCED ORDER BY GapUsd__c DESC NULLS LAST
            LIMIT 200
        ]) {
            IssueRow r = new IssueRow();
            r.id = f.Id;
            r.detectorId = f.DetectorId__c;
            r.title = f.Title__c;
            r.description = f.Description__c;
            r.severity = f.Severity__c;
            r.status = f.Status__c;
            r.gapUsd = f.GapUsd__c == null ? 0 : f.GapUsd__c;
            r.primaryRecordId = f.PrimaryRecordId__c;
            r.primaryRecordType = f.PrimaryRecordType__c;
            if (f.Severity__c == 'Critical')      out.critical.add(r);
            else if (f.Severity__c == 'Warning')  out.warning.add(r);
            else                                  out.info.add(r);
        }
        out.totalCount = out.critical.size() + out.warning.size() + out.info.size();
        return out;
    }

    public class CategoryIssuesDto {
        @AuraEnabled public String categoryLabel;
        @AuraEnabled public Integer totalCount;
        @AuraEnabled public List<IssueRow> critical;
        @AuraEnabled public List<IssueRow> warning;
        @AuraEnabled public List<IssueRow> info;
    }

    public class IssueRow {
        @AuraEnabled public Id id;
        @AuraEnabled public String detectorId;
        @AuraEnabled public String title;
        @AuraEnabled public String description;
        @AuraEnabled public String severity;
        @AuraEnabled public String status;
        @AuraEnabled public Decimal gapUsd;
        @AuraEnabled public String primaryRecordId;
        @AuraEnabled public String primaryRecordType;
    }

    /** Fetches all findings whose DetectorId__c is in the given list. Used by the
     *  Category Performance grid → modal flow (passes detector IDs straight through
     *  so label drift between controllers can't desync). */
    @AuraEnabled(cacheable=true)
    public static CategoryIssuesDto getIssuesByDetectorIds(List<String> detectorIds, String headerLabel) {
        CategoryIssuesDto out = new CategoryIssuesDto();
        out.categoryLabel = headerLabel;
        out.totalCount = 0;
        out.critical = new List<IssueRow>();
        out.warning = new List<IssueRow>();
        out.info = new List<IssueRow>();

        if (detectorIds == null || detectorIds.isEmpty()) return out;
        List<ForensicScan__c> scans = [
            SELECT Id FROM ForensicScan__c
            WHERE Status__c IN ('Completed','Partial')
            WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST LIMIT 1
        ];
        if (scans.isEmpty()) return out;

        for (ForensicFinding__c f : [
            SELECT Id, Name, Title__c, Description__c, DetectorId__c, Severity__c, Status__c,
                   GapUsd__c, EntitledUsd__c, RealizedUsd__c, PrimaryRecordId__c,
                   PrimaryRecordType__c, RecoverabilityScore__c
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scans[0].Id
              AND DetectorId__c IN :detectorIds
              AND HiddenAt__c = null
            WITH SECURITY_ENFORCED ORDER BY GapUsd__c DESC NULLS LAST
            LIMIT 200
        ]) {
            IssueRow r = new IssueRow();
            r.id = f.Id;
            r.detectorId = f.DetectorId__c;
            r.title = f.Title__c;
            r.description = f.Description__c;
            r.severity = f.Severity__c;
            r.status = f.Status__c;
            r.gapUsd = f.GapUsd__c == null ? 0 : f.GapUsd__c;
            r.primaryRecordId = f.PrimaryRecordId__c;
            r.primaryRecordType = f.PrimaryRecordType__c;
            if (f.Severity__c == 'Critical')      out.critical.add(r);
            else if (f.Severity__c == 'Warning')  out.warning.add(r);
            else                                  out.info.add(r);
        }
        out.totalCount = out.critical.size() + out.warning.size() + out.info.size();
        return out;
    }

    /**
     * Phase 22o — fetch all findings of the given severity on the latest
     * scan, optionally scoped to a Connected Org. Powers the hero severity
     * tile click → modal flow so the user can drill into Critical /
     * Warning / Info findings without scrolling to the issues panel.
     *
     * `severity` is case-insensitive Apex side; client passes 'critical',
     * 'warning', 'info', or 'Best Practices' (mapped to info).
     * `connectedOrgId` mirrors the dashboard filter; null → most-recent
     * scan across all orgs.
     */
    @AuraEnabled(cacheable=true)
    public static CategoryIssuesDto getIssuesBySeverity(String severity, Id connectedOrgId) {
        CategoryIssuesDto out = new CategoryIssuesDto();
        out.totalCount = 0;
        out.critical = new List<IssueRow>();
        out.warning = new List<IssueRow>();
        out.info = new List<IssueRow>();
        if (String.isBlank(severity)) return out;

        // Normalize incoming severity to the stored Severity__c picklist.
        String sevNorm;
        String key = severity.toLowerCase();
        if (key == 'critical') { sevNorm = 'Critical'; out.categoryLabel = 'Critical Issues'; }
        else if (key == 'warning') { sevNorm = 'Warning'; out.categoryLabel = 'Warnings'; }
        else if (key == 'info' || key == 'best practices' || key == 'best practice') {
            sevNorm = 'Info'; out.categoryLabel = 'Best Practices';
        } else {
            // Unknown severity bucket — return empty rather than throwing.
            out.categoryLabel = severity;
            return out;
        }

        // Match the dashboard's scope: latest Completed/Partial scan,
        // optionally filtered to the same Connected Org so a customer
        // who's flipped between orgs sees the right scan.
        List<ForensicScan__c> scans;
        if (connectedOrgId != null) {
            scans = [
                SELECT Id FROM ForensicScan__c
                WHERE Status__c IN ('Completed','Partial')
                  AND ConnectedOrg__c = :connectedOrgId
                WITH SECURITY_ENFORCED
                ORDER BY CompletedAt__c DESC NULLS LAST
                LIMIT 1
            ];
        } else {
            scans = [
                SELECT Id FROM ForensicScan__c
                WHERE Status__c IN ('Completed','Partial')
                WITH SECURITY_ENFORCED
                ORDER BY CompletedAt__c DESC NULLS LAST
                LIMIT 1
            ];
        }
        if (scans.isEmpty()) return out;

        for (ForensicFinding__c f : [
            SELECT Id, Name, Title__c, Description__c, DetectorId__c, Severity__c, Status__c,
                   GapUsd__c, EntitledUsd__c, RealizedUsd__c, PrimaryRecordId__c,
                   PrimaryRecordType__c, RecoverabilityScore__c
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scans[0].Id
              AND Severity__c = :sevNorm
              AND HiddenAt__c = null
            WITH SECURITY_ENFORCED
            ORDER BY GapUsd__c DESC NULLS LAST
            LIMIT 500
        ]) {
            IssueRow r = new IssueRow();
            r.id = f.Id;
            r.detectorId = f.DetectorId__c;
            r.title = f.Title__c;
            r.description = f.Description__c;
            r.severity = f.Severity__c;
            r.status = f.Status__c;
            r.gapUsd = f.GapUsd__c == null ? 0 : f.GapUsd__c;
            r.primaryRecordId = f.PrimaryRecordId__c;
            r.primaryRecordType = f.PrimaryRecordType__c;
            if (sevNorm == 'Critical')     out.critical.add(r);
            else if (sevNorm == 'Warning') out.warning.add(r);
            else                           out.info.add(r);
        }
        out.totalCount = out.critical.size() + out.warning.size() + out.info.size();
        return out;
    }

    /** Mark a finding as resolved (called from category modal's "Mark Fixed" button). */
    @AuraEnabled
    public static void markFixed(Id findingId) {
        if (findingId == null) return;
        ForensicFinding__c f = new ForensicFinding__c(Id = findingId, Status__c = 'Resolved');
        update f;
    }

    public class CategoryRowComparator implements Comparator<CategoryRow> {
        public Integer compare(CategoryRow a, CategoryRow b) {
            if (b.criticalCount != a.criticalCount) return b.criticalCount - a.criticalCount;
            if (b.warningCount != a.warningCount) return b.warningCount - a.warningCount;
            return b.infoCount - a.infoCount;
        }
    }
}
