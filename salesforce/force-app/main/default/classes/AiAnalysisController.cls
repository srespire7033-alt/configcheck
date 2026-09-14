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

    /**
     * Phase 22w — connectedOrgId param. Same scoping bug class as
     * 22m / 22r / 22s / 22t / 22u: the dashboard's top-categories
     * analysis was always picking the latest scan globally, so an
     * ARM-org dashboard showed a CPQ-org's category breakdown.
     */
    @AuraEnabled(cacheable=true)
    public static AnalysisDto getAnalysis(Id connectedOrgId) {
        AnalysisDto dto = new AnalysisDto();
        dto.topCategories = new List<CategoryRow>();
        dto.residualCritical = 0;
        dto.residualWarning = 0;
        dto.residualCategories = 0;
        dto.totalCritical = 0;
        dto.totalWarning = 0;
        dto.totalInfo = 0;

        // Latest completed scan — scoped to the active Connected Org
        // when present so multi-org dashboards don't cross-contaminate.
        List<ForensicScan__c> scans;
        if (connectedOrgId != null) {
            scans = [
                SELECT Id FROM ForensicScan__c
                WHERE Status__c IN ('Completed','Partial')
                  AND ConnectedOrg__c = :connectedOrgId
                WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST
                LIMIT 1
            ];
        } else {
            scans = [
                SELECT Id FROM ForensicScan__c
                WHERE Status__c IN ('Completed','Partial')
                WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST
                LIMIT 1
            ];
        }
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
    public static CategoryIssuesDto getCategoryIssues(String categoryLabel, Id connectedOrgId) {
        CategoryIssuesDto out = new CategoryIssuesDto();
        out.categoryLabel = categoryLabel;
        out.totalCount = 0;
        out.critical = new List<IssueRow>();
        out.warning = new List<IssueRow>();
        out.info = new List<IssueRow>();

        if (String.isBlank(categoryLabel)) return out;

        // Phase 28 — scope to the org being viewed. This used to take the
        // globally-latest scan, so with several connected orgs the drill-down
        // could show a DIFFERENT org's findings than the card you clicked.
        Id scanId = latestScanId(connectedOrgId);
        if (scanId == null) return out;

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
        // Phase 28 — the LIMIT above TRUNCATES, so size() is what we SHOWED, not
        // what exists. Reporting it as "total" made the modal say "200 total" for
        // a category the dashboard card correctly showed as 1,783 critical — the
        // drill-down silently under-reported by 9x with no indication. Count for
        // real and let the UI say "showing X of Y".
        out.shownCount = out.critical.size() + out.warning.size() + out.info.size();
        out.totalCount = [
            SELECT COUNT() FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId
              AND DetectorId__c IN :matchingDetectors
              AND HiddenAt__c = null
            WITH SECURITY_ENFORCED
        ];
        out.truncated = out.shownCount < out.totalCount;
        out.detectorSummaries = summariesFor(scanId, matchingDetectors, null);
        out.detectorCounts = countsFrom(out.detectorSummaries);
        out.offsetUsed = 0;
        return out;
    }

    public class CategoryIssuesDto {
        @AuraEnabled public String categoryLabel;
        /** TRUE total matching the filter — NOT the number of rows returned. */
        @AuraEnabled public Integer totalCount;
        /** How many rows this payload actually carries (capped by LIMIT). */
        @AuraEnabled public Integer shownCount;
        /** shownCount < totalCount — the UI must say so rather than imply completeness. */
        @AuraEnabled public Boolean truncated;
        /** TRUE per-detector totals — group badges must not show the page size. */
        @AuraEnabled public Map<String, Integer> detectorCounts;
        /** EVERY detector present on this scan for the filter, with true counts and
         *  metadata. The modal builds its group list from THIS, not from the
         *  returned rows, so a detector can never be silently invisible. */
        @AuraEnabled public List<DetectorSummary> detectorSummaries;
        /** Offset this page started at; the LWC's paging cursor. */
        @AuraEnabled public Integer offsetUsed;
        /** Hit SOQL's 2000-row OFFSET ceiling — direct the user to the CSV export. */
        @AuraEnabled public Boolean offsetCapped;
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
    public static CategoryIssuesDto getIssuesByDetectorIds(List<String> detectorIds, String headerLabel,
                                                           Id connectedOrgId) {
        CategoryIssuesDto out = new CategoryIssuesDto();
        out.categoryLabel = headerLabel;
        out.totalCount = 0;
        out.critical = new List<IssueRow>();
        out.warning = new List<IssueRow>();
        out.info = new List<IssueRow>();

        if (detectorIds == null || detectorIds.isEmpty()) return out;
        // Phase 28 — scope to the org being viewed (see getCategoryIssues).
        Id scanId = latestScanId(connectedOrgId);
        if (scanId == null) return out;

        for (ForensicFinding__c f : [
            SELECT Id, Name, Title__c, Description__c, DetectorId__c, Severity__c, Status__c,
                   GapUsd__c, EntitledUsd__c, RealizedUsd__c, PrimaryRecordId__c,
                   PrimaryRecordType__c, RecoverabilityScore__c
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId
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
        // Phase 28 — real count, not the truncated page size. See getCategoryIssues.
        out.shownCount = out.critical.size() + out.warning.size() + out.info.size();
        out.totalCount = [
            SELECT COUNT() FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId
              AND DetectorId__c IN :detectorIds
              AND HiddenAt__c = null
            WITH SECURITY_ENFORCED
        ];
        out.truncated = out.shownCount < out.totalCount;
        out.detectorSummaries = summariesFor(scanId, new Set<String>(detectorIds), null);
        out.detectorCounts = countsFrom(out.detectorSummaries);
        out.offsetUsed = 0;
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
        // Phase 28 — real count, not the truncated page size. See getCategoryIssues.
        out.shownCount = out.critical.size() + out.warning.size() + out.info.size();
        out.totalCount = [
            SELECT COUNT() FROM ForensicFinding__c
            WHERE ForensicScan__c = :scans[0].Id
              AND Severity__c = :sevNorm
              AND HiddenAt__c = null
            WITH SECURITY_ENFORCED
        ];
        out.truncated = out.shownCount < out.totalCount;
        out.detectorSummaries = summariesFor(scans[0].Id, null, sevNorm);
        out.detectorCounts = countsFrom(out.detectorSummaries);
        out.offsetUsed = 0;
        return out;
    }

    /**
     * Phase 28 — TRUE per-detector counts. The row queries above are capped, so
     * the modal's group badges and "N records affected" were reporting the PAGE
     * SIZE (200) rather than the real total (905 for ARM-001). One aggregate,
     * no row cap, so the badges stop lying.
     */
    private static Map<String, Integer> countsFrom(List<DetectorSummary> summaries) {
        Map<String, Integer> out = new Map<String, Integer>();
        for (DetectorSummary s : summaries) out.put(s.detectorId, s.count);
        return out;
    }

    /**
     * Phase 28 — EVERY detector present on the scan for this filter, with its
     * TRUE count and enough metadata to render a header. This is what the modal
     * builds its group list from.
     *
     * Why it matters: the row query is ORDER BY GapUsd DESC LIMIT 200, so a
     * high-volume detector fills the page and detectors below it never appear at
     * all. Measured on FS-0129: PB-002 had 223 rows and consumed the page, so
     * PB-004 (37 findings) and PB-006 (1) were not truncated — they were
     * COMPLETELY INVISIBLE. Driving the group list off this aggregate instead of
     * off the returned rows makes silent absence impossible.
     *
     * Label/description come from Detector__mdt so a group with zero LOADED rows
     * still renders a real header and can lazily fetch its own rows on expand.
     */
    private static List<DetectorSummary> summariesFor(Id scanId, Set<String> detectorFilter, String sevFilter) {
        String soql = 'SELECT DetectorId__c did, Severity__c sev, COUNT(Id) c FROM ForensicFinding__c'
                    + ' WHERE ForensicScan__c = :scanId AND HiddenAt__c = null';
        if (detectorFilter != null && !detectorFilter.isEmpty()) soql += ' AND DetectorId__c IN :detectorFilter';
        if (String.isNotBlank(sevFilter))                        soql += ' AND Severity__c = :sevFilter';
        soql += ' WITH SECURITY_ENFORCED GROUP BY DetectorId__c, Severity__c';

        Map<String, DetectorSummary> byId = new Map<String, DetectorSummary>();
        for (AggregateResult ar : Database.query(soql)) {
            Object didObj = ar.get('did');
            if (didObj == null) continue;
            String did = String.valueOf(didObj);
            DetectorSummary s = byId.get(did);
            if (s == null) {
                s = new DetectorSummary();
                s.detectorId = did;
                s.count = 0;
                byId.put(did, s);
            }
            s.count += (Integer) ar.get('c');
            // A detector should be single-severity, but if it ever spans, keep
            // the most severe so the group lands in the right section.
            String sev = String.valueOf(ar.get('sev'));
            if (s.severity == null || sevRank(sev) < sevRank(s.severity)) s.severity = sev;
        }
        if (!byId.isEmpty()) {
            Set<String> ids = byId.keySet();
            for (Detector__mdt m : [
                SELECT DetectorId__c, Label__c, LongDescription__c
                FROM Detector__mdt WHERE DetectorId__c IN :ids
            ]) {
                DetectorSummary s = byId.get(m.DetectorId__c);
                if (s != null) {
                    s.label = m.Label__c;
                    s.description = m.LongDescription__c;
                }
            }
        }
        return byId.values();
    }

    /** Critical < Warning < Info, for picking a group's section. */
    private static Integer sevRank(String sev) {
        if (sev == 'Critical') return 0;
        if (sev == 'Warning') return 1;
        return 2;
    }

    /** One detector present on the scan, with its TRUE total (not the page size). */
    public class DetectorSummary {
        @AuraEnabled public String detectorId;
        @AuraEnabled public Integer count;
        @AuraEnabled public String severity;
        @AuraEnabled public String label;
        @AuraEnabled public String description;
    }

    /** Shared row mapper so the paging query matches the first-page shape exactly. */
    private static IssueRow mapRow(ForensicFinding__c f) {
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
        return r;
    }

    /** Latest Completed/Partial scan, optionally scoped to a Connected Org. */
    private static Id latestScanId(Id connectedOrgId) {
        List<ForensicScan__c> scans = connectedOrgId != null
            ? [SELECT Id FROM ForensicScan__c
               WHERE Status__c IN ('Completed','Partial') AND ConnectedOrg__c = :connectedOrgId
               WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST LIMIT 1]
            : [SELECT Id FROM ForensicScan__c
               WHERE Status__c IN ('Completed','Partial')
               WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST LIMIT 1];
        return scans.isEmpty() ? null : scans[0].Id;
    }

    /**
     * Phase 28 — next page of drill-down rows. The modal capped at 200 and could
     * not show the rest, and because the cap is applied after ORDER BY GapUsd DESC,
     * a single high-volume detector (ARM-001, 905 rows) swallowed the whole page
     * and hid every other detector in the category outright.
     *
     * mode: 'category' (key = category label) | 'detectors' (key = comma-separated
     * detector ids) | 'severity' (key = critical|warning|info).
     *
     * NOTE: SOQL OFFSET is hard-capped at 2000 by the platform. Past that we stop
     * and tell the caller to use the CSV export rather than silently returning
     * nothing — the same "never imply completeness" rule as the header count.
     */
    @AuraEnabled
    public static CategoryIssuesDto loadIssuesPage(String mode, String key, Id connectedOrgId,
                                                   Integer offsetRows, Integer pageSize) {
        CategoryIssuesDto out = new CategoryIssuesDto();
        out.critical = new List<IssueRow>();
        out.warning  = new List<IssueRow>();
        out.info     = new List<IssueRow>();
        out.totalCount = 0;
        out.shownCount = 0;
        out.truncated = false;

        Integer lim = (pageSize == null || pageSize <= 0) ? 200 : Math.min(pageSize, 200);
        Integer off = (offsetRows == null || offsetRows < 0) ? 0 : offsetRows;
        out.offsetUsed = off;
        if (off >= 2000) {                     // platform ceiling
            out.offsetCapped = true;
            return out;
        }
        if (off + lim > 2000) lim = 2000 - off;

        Id scanId = latestScanId(connectedOrgId);
        if (scanId == null) return out;

        Set<String> detectorFilter = new Set<String>();
        String sevFilter = null;
        if (mode == 'detectors' && String.isNotBlank(key)) {
            for (String d : key.split(',')) if (String.isNotBlank(d.trim())) detectorFilter.add(d.trim());
        } else if (mode == 'category' && String.isNotBlank(key)) {
            for (String det : DETECTOR_LABEL.keySet()) {
                if (DETECTOR_LABEL.get(det) == key) detectorFilter.add(det);
            }
        } else if (mode == 'severity' && String.isNotBlank(key)) {
            String k = key.toLowerCase();
            if (k == 'critical') sevFilter = 'Critical';
            else if (k == 'warning') sevFilter = 'Warning';
            else sevFilter = 'Info';
        }
        if (mode != 'severity' && detectorFilter.isEmpty()) return out;

        String soql = 'SELECT Id, Name, Title__c, Description__c, DetectorId__c, Severity__c, Status__c,'
                    + ' GapUsd__c, EntitledUsd__c, RealizedUsd__c, PrimaryRecordId__c,'
                    + ' PrimaryRecordType__c, RecoverabilityScore__c FROM ForensicFinding__c'
                    + ' WHERE ForensicScan__c = :scanId AND HiddenAt__c = null';
        if (!detectorFilter.isEmpty())    soql += ' AND DetectorId__c IN :detectorFilter';
        if (String.isNotBlank(sevFilter)) soql += ' AND Severity__c = :sevFilter';
        soql += ' WITH SECURITY_ENFORCED ORDER BY GapUsd__c DESC NULLS LAST, Id'
              + ' LIMIT :lim OFFSET :off';

        for (ForensicFinding__c f : Database.query(soql)) {
            IssueRow r = mapRow(f);
            if (f.Severity__c == 'Critical')     out.critical.add(r);
            else if (f.Severity__c == 'Warning') out.warning.add(r);
            else                                 out.info.add(r);
        }
        out.shownCount = out.critical.size() + out.warning.size() + out.info.size();
        out.detectorSummaries = summariesFor(scanId, detectorFilter, sevFilter);
        out.detectorCounts = countsFrom(out.detectorSummaries);
        Integer total = 0;
        for (Integer c : out.detectorCounts.values()) total += c;
        out.totalCount = total;
        out.truncated = (off + out.shownCount) < total;
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
