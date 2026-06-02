/**
 * Aggregates everything the native LWC dashboard needs to render the
 * hero + summary cards in one Apex round trip. Built for `wire`-style
 * consumption by Phase 2+ LWCs.
 *
 * Designed as the SINGLE entry point for dashboard data — keeping it
 * here lets us evolve the JSON shape without touching every LWC that
 * reads from it. Add fields to the DTOs as new cards need new metrics.
 *
 * Methods:
 *   getDashboardSummary()   → SummaryDto for the hero + summary tab
 *
 * Future (Phase 3+):
 *   getFindingsByCategory(category) → for the Findings tab sub-views
 *   getIssuesPage(filter, page)     → for the Issues tab with filter
 */
public with sharing class DashboardController {

    /** Hero + summary metrics in one payload. */
    public class SummaryDto {
        @AuraEnabled public ForensicScan__c latestScan;
        @AuraEnabled public Integer scanCount;
        @AuraEnabled public Decimal totalVerifiedUsd;
        @AuraEnabled public Integer findingCount;
        @AuraEnabled public Integer criticalCount;
        @AuraEnabled public Integer warningCount;
        @AuraEnabled public Integer infoCount;
        @AuraEnabled public List<TopFinding> topFindings;
        @AuraEnabled public Boolean hasForensicData;
    }

    /** Lightweight finding shape for matrix/list rendering. */
    public class TopFinding {
        @AuraEnabled public Id id;
        @AuraEnabled public String detectorId;
        @AuraEnabled public String title;
        @AuraEnabled public Decimal gapUsd;
        @AuraEnabled public String severity;
        @AuraEnabled public Decimal recoverabilityScore;
        @AuraEnabled public String currencyIsoCode;
    }

    /**
     * Single aggregated read for the dashboard. Cacheable so the
     * Lightning wire layer reuses it across multiple wired LWCs on the
     * same page without re-querying. Refresh via refreshApex(...) when
     * a new scan completes.
     */
    @AuraEnabled(cacheable=true)
    public static SummaryDto getDashboardSummary() {
        SummaryDto dto = new SummaryDto();
        dto.scanCount = 0;
        dto.totalVerifiedUsd = 0;
        dto.findingCount = 0;
        dto.criticalCount = 0;
        dto.warningCount = 0;
        dto.infoCount = 0;
        dto.topFindings = new List<TopFinding>();
        dto.hasForensicData = false;

        // Latest completed scan (most recent terminal state).
        List<ForensicScan__c> scans = [
            SELECT Id, Name, Status__c, ProductType__c, StartedAt__c,
                   CompletedAt__c, TotalLeakageUsd__c, FindingCount__c,
                   ErrorMessage__c, CurrencyIsoCode
            FROM ForensicScan__c
            WHERE Status__c IN ('Completed', 'Partial')
            ORDER BY StartedAt__c DESC
            LIMIT 1
        ];
        if (scans.isEmpty()) {
            return dto;
        }

        ForensicScan__c latest = scans[0];
        dto.latestScan = latest;
        dto.scanCount = [SELECT COUNT() FROM ForensicScan__c WHERE Status__c IN ('Completed', 'Partial')];
        dto.totalVerifiedUsd = latest.TotalLeakageUsd__c != null ? latest.TotalLeakageUsd__c : 0;
        dto.findingCount = (Integer) (latest.FindingCount__c != null ? latest.FindingCount__c : 0);
        dto.hasForensicData = dto.findingCount > 0;

        // Severity counts derived from the actual ForensicFinding__c
        // records (rather than denormalized on the scan) so they stay
        // accurate if findings are added/hidden after scan completion.
        AggregateResult[] sevAgg = [
            SELECT Severity__c sev, COUNT(Id) cnt
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :latest.Id
              AND HiddenAt__c = null
            GROUP BY Severity__c
        ];
        for (AggregateResult ag : sevAgg) {
            String s = (String) ag.get('sev');
            Integer c = (Integer) ag.get('cnt');
            if (s == 'Critical') dto.criticalCount = c;
            else if (s == 'Warning') dto.warningCount = c;
            else if (s == 'Info') dto.infoCount = c;
        }

        // Top findings by $ gap — drives the Impact × Effort matrix
        // and the "headline finding" callout. Cap at 50 so the payload
        // stays small even for orgs with thousands of findings.
        List<ForensicFinding__c> topRaw = [
            SELECT Id, DetectorId__c, Title__c, GapUsd__c, Severity__c,
                   RecoverabilityScore__c, CurrencyIsoCode
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :latest.Id
              AND HiddenAt__c = null
              AND GapUsd__c != null
            ORDER BY GapUsd__c DESC
            LIMIT 50
        ];
        for (ForensicFinding__c f : topRaw) {
            TopFinding tf = new TopFinding();
            tf.id = f.Id;
            tf.detectorId = f.DetectorId__c;
            tf.title = f.Title__c;
            tf.gapUsd = f.GapUsd__c;
            tf.severity = f.Severity__c;
            tf.recoverabilityScore = f.RecoverabilityScore__c;
            tf.currencyIsoCode = f.CurrencyIsoCode;
            dto.topFindings.add(tf);
        }

        return dto;
    }

    // ─────────────────────────────────────────────────────────────
    // Detector → category mapping. Mirrors the SaaS-side categorization
    // in src/lib/forensics/types.ts. Keeping the source of truth here
    // for Salesforce-side queries; sync when new detectors land.
    //
    // Categories:
    //   revenue_leakage — verified $ leakage detectors (the wedge)
    //   governance      — process/control failures (audit-tier)
    //   pipeline        — opportunity / renewal pipeline risk
    //   pricing         — pricing discipline detectors
    // ─────────────────────────────────────────────────────────────
    private static final Map<String, String> DETECTOR_CATEGORY = new Map<String, String>{
        'REN-001'     => 'revenue_leakage',
        'REN-002'     => 'pricing',
        'REN-003'     => 'pipeline',
        'REN-004'     => 'pipeline',
        'DSC-FOR-001' => 'pricing',
        'DSC-FOR-002' => 'pricing',
        'QL-FOR-001'  => 'revenue_leakage',
        'QL-FOR-002'  => 'governance',
        'ORD-FOR-001' => 'revenue_leakage',
        'ORD-FOR-002' => 'governance',
        'ORD-FOR-003' => 'governance',
        'SUB-FOR-001' => 'revenue_leakage',
        'PROV-FOR-001'=> 'revenue_leakage',
        'PROV-FOR-002'=> 'governance',
        'OPP-FOR-001' => 'governance',
        'CON-FOR-001' => 'governance',
        'AMD-FOR-001' => 'governance',
        'AST-FOR-001' => 'revenue_leakage',
        'CT-FOR-001'  => 'pricing',
        'MDQ-FOR-001' => 'pricing'
    };

    public class CategoryFindingsDto {
        @AuraEnabled public String category;
        @AuraEnabled public Integer findingCount;
        @AuraEnabled public Decimal totalUsd;
        @AuraEnabled public List<TopFinding> findings;
        @AuraEnabled public List<DetectorGroup> byDetector;
    }

    public class DetectorGroup {
        @AuraEnabled public String detectorId;
        @AuraEnabled public Integer count;
        @AuraEnabled public Decimal totalUsd;
        @AuraEnabled public List<TopFinding> findings;
    }

    /**
     * Returns findings for the latest scan filtered to one category,
     * plus a per-detector grouping for the "Revenue Leakage" style
     * accordion view. Cacheable — feeds the Findings sub-views.
     *
     * @param category one of: revenue_leakage | governance | pipeline | pricing
     */
    @AuraEnabled(cacheable=true)
    public static CategoryFindingsDto getFindingsByCategory(String category) {
        CategoryFindingsDto out = new CategoryFindingsDto();
        out.category = category;
        out.findingCount = 0;
        out.totalUsd = 0;
        out.findings = new List<TopFinding>();
        out.byDetector = new List<DetectorGroup>();

        // Latest completed scan.
        List<ForensicScan__c> scans = [
            SELECT Id FROM ForensicScan__c
            WHERE Status__c IN ('Completed', 'Partial')
            ORDER BY StartedAt__c DESC LIMIT 1
        ];
        if (scans.isEmpty()) return out;
        Id scanId = scans[0].Id;

        // Pull all unhidden findings for this scan, then filter in
        // memory by category. SOQL can't filter on a static map, so
        // we accept the slight overhead — caps at 500 per scan
        // (matches FindingsListController.getFindings).
        List<ForensicFinding__c> allFindings = [
            SELECT Id, DetectorId__c, Title__c, GapUsd__c, Severity__c,
                   RecoverabilityScore__c, CurrencyIsoCode
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId
              AND HiddenAt__c = null
            ORDER BY GapUsd__c DESC
            LIMIT 500
        ];

        Map<String, DetectorGroup> groups = new Map<String, DetectorGroup>();
        for (ForensicFinding__c f : allFindings) {
            String detCat = DETECTOR_CATEGORY.get(f.DetectorId__c);
            if (detCat == null || detCat != category) continue;

            TopFinding tf = new TopFinding();
            tf.id = f.Id;
            tf.detectorId = f.DetectorId__c;
            tf.title = f.Title__c;
            tf.gapUsd = f.GapUsd__c;
            tf.severity = f.Severity__c;
            tf.recoverabilityScore = f.RecoverabilityScore__c;
            tf.currencyIsoCode = f.CurrencyIsoCode;
            out.findings.add(tf);
            out.findingCount += 1;
            out.totalUsd += (f.GapUsd__c != null ? f.GapUsd__c : 0);

            // Group by detector for accordion view.
            DetectorGroup g = groups.get(f.DetectorId__c);
            if (g == null) {
                g = new DetectorGroup();
                g.detectorId = f.DetectorId__c;
                g.count = 0;
                g.totalUsd = 0;
                g.findings = new List<TopFinding>();
                groups.put(f.DetectorId__c, g);
            }
            g.count += 1;
            g.totalUsd += (f.GapUsd__c != null ? f.GapUsd__c : 0);
            g.findings.add(tf);
        }

        // Sort detector groups by total $ desc.
        List<DetectorGroup> sortable = new List<DetectorGroup>(groups.values());
        // Apex doesn't allow custom comparators on List.sort() without
        // implementing Comparable on the type — use a simple
        // insertion sort on a small list (typically < 10 groups).
        for (Integer i = 1; i < sortable.size(); i++) {
            DetectorGroup k = sortable[i];
            Integer j = i - 1;
            while (j >= 0 && (sortable[j].totalUsd == null ? 0 : sortable[j].totalUsd) < (k.totalUsd == null ? 0 : k.totalUsd)) {
                sortable[j + 1] = sortable[j];
                j -= 1;
            }
            sortable[j + 1] = k;
        }
        out.byDetector = sortable;
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // Since-last-scan diff — compares the latest completed scan to the
    // one before it. Powers the "What changed?" card. The comparison
    // is done at the finding level (compared by detector_id + title)
    // since findings are scan-scoped (a new scan emits new IDs even
    // for the same underlying issue).
    // ─────────────────────────────────────────────────────────────

    public class SinceLastScanDto {
        @AuraEnabled public Boolean hasPrior;
        @AuraEnabled public Decimal latestTotal;
        @AuraEnabled public Decimal priorTotal;
        @AuraEnabled public Decimal delta;
        @AuraEnabled public Integer latestCount;
        @AuraEnabled public Integer priorCount;
        @AuraEnabled public Integer addedCount;
        @AuraEnabled public Integer resolvedCount;
        @AuraEnabled public List<TopFinding> newFindings;
        @AuraEnabled public List<String> resolvedTitles;
    }

    @AuraEnabled(cacheable=true)
    public static SinceLastScanDto getSinceLastScan() {
        SinceLastScanDto dto = new SinceLastScanDto();
        dto.hasPrior = false;
        dto.latestTotal = 0;
        dto.priorTotal = 0;
        dto.delta = 0;
        dto.latestCount = 0;
        dto.priorCount = 0;
        dto.addedCount = 0;
        dto.resolvedCount = 0;
        dto.newFindings = new List<TopFinding>();
        dto.resolvedTitles = new List<String>();

        List<ForensicScan__c> scans = [
            SELECT Id, TotalLeakageUsd__c, FindingCount__c
            FROM ForensicScan__c
            WHERE Status__c IN ('Completed', 'Partial')
            ORDER BY StartedAt__c DESC
            LIMIT 2
        ];
        if (scans.isEmpty()) return dto;

        ForensicScan__c latest = scans[0];
        dto.latestTotal = latest.TotalLeakageUsd__c != null ? latest.TotalLeakageUsd__c : 0;
        dto.latestCount = (Integer)(latest.FindingCount__c != null ? latest.FindingCount__c : 0);

        if (scans.size() < 2) return dto;
        ForensicScan__c prior = scans[1];
        dto.hasPrior = true;
        dto.priorTotal = prior.TotalLeakageUsd__c != null ? prior.TotalLeakageUsd__c : 0;
        dto.priorCount = (Integer)(prior.FindingCount__c != null ? prior.FindingCount__c : 0);
        dto.delta = dto.latestTotal - dto.priorTotal;

        // Compare findings between the two scans by signature
        // (detector + title). Anything in latest but not prior =
        // newly added. Anything in prior but not latest = resolved.
        Map<String, ForensicFinding__c> latestMap = new Map<String, ForensicFinding__c>();
        for (ForensicFinding__c f : [
            SELECT Id, DetectorId__c, Title__c, GapUsd__c, Severity__c,
                   RecoverabilityScore__c, CurrencyIsoCode
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :latest.Id
              AND HiddenAt__c = null
            LIMIT 500
        ]) {
            latestMap.put(f.DetectorId__c + '|' + f.Title__c, f);
        }
        Set<String> priorSignatures = new Set<String>();
        Map<String, String> priorBySignature = new Map<String, String>();
        for (ForensicFinding__c f : [
            SELECT Id, DetectorId__c, Title__c
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :prior.Id
              AND HiddenAt__c = null
            LIMIT 500
        ]) {
            String sig = f.DetectorId__c + '|' + f.Title__c;
            priorSignatures.add(sig);
            priorBySignature.put(sig, f.Title__c);
        }

        // New = in latest but not prior. Capped at top 10 by $ for the
        // card to render without overflowing.
        List<ForensicFinding__c> newOnes = new List<ForensicFinding__c>();
        for (String sig : latestMap.keySet()) {
            if (!priorSignatures.contains(sig)) {
                newOnes.add(latestMap.get(sig));
            }
        }
        dto.addedCount = newOnes.size();
        // Sort by GapUsd__c desc — Apex List.sort() defaults aren't
        // applicable to SObject lists, so do a small insertion sort
        // (newOnes is typically < 50 items).
        for (Integer i = 1; i < newOnes.size(); i++) {
            ForensicFinding__c k = newOnes[i];
            Decimal kGap = k.GapUsd__c != null ? k.GapUsd__c : 0;
            Integer j = i - 1;
            while (j >= 0) {
                Decimal jGap = newOnes[j].GapUsd__c != null ? newOnes[j].GapUsd__c : 0;
                if (jGap >= kGap) break;
                newOnes[j + 1] = newOnes[j];
                j -= 1;
            }
            newOnes[j + 1] = k;
        }
        Integer cap = Math.min(10, newOnes.size());
        for (Integer i = 0; i < cap; i++) {
            ForensicFinding__c f = newOnes[i];
            TopFinding tf = new TopFinding();
            tf.id = f.Id;
            tf.detectorId = f.DetectorId__c;
            tf.title = f.Title__c;
            tf.gapUsd = f.GapUsd__c;
            tf.severity = f.Severity__c;
            tf.recoverabilityScore = f.RecoverabilityScore__c;
            tf.currencyIsoCode = f.CurrencyIsoCode;
            dto.newFindings.add(tf);
        }

        // Resolved = in prior but not latest. Just titles for now —
        // we don't have the prior finding's record to navigate to
        // (it's a scan-scoped row), so showing titles is enough.
        for (String sig : priorSignatures) {
            if (!latestMap.containsKey(sig)) {
                dto.resolvedCount += 1;
                if (dto.resolvedTitles.size() < 10) {
                    dto.resolvedTitles.add(priorBySignature.get(sig));
                }
            }
        }
        return dto;
    }

    // ─────────────────────────────────────────────────────────────
    // Recovery queue — RecoveryAction__c records grouped by approval
    // status. Feeds the Plan tab. Each group includes the rolled-up
    // projected $ + a flat list of actions for the LWC to render.
    // ─────────────────────────────────────────────────────────────

    public class RecoveryQueueDto {
        @AuraEnabled public List<RecoveryGroup> groups;
        @AuraEnabled public Integer totalCount;
        @AuraEnabled public Decimal totalProjectedUsd;
    }

    public class RecoveryGroup {
        @AuraEnabled public String status;
        @AuraEnabled public Integer count;
        @AuraEnabled public Decimal projectedUsd;
        @AuraEnabled public List<RecoveryAction> actions;
    }

    public class RecoveryAction {
        @AuraEnabled public Id id;
        @AuraEnabled public Id findingId;
        @AuraEnabled public String findingTitle;
        @AuraEnabled public String status;
        @AuraEnabled public Decimal projectedUsd;
        @AuraEnabled public Datetime approvedAt;
        @AuraEnabled public Datetime committedAt;
        @AuraEnabled public Boolean commitVerified;
    }

    @AuraEnabled(cacheable=true)
    public static RecoveryQueueDto getRecoveryQueue() {
        RecoveryQueueDto dto = new RecoveryQueueDto();
        dto.groups = new List<RecoveryGroup>();
        dto.totalCount = 0;
        dto.totalProjectedUsd = 0;

        List<RecoveryAction__c> rows = [
            SELECT Id, ApprovalStatus__c, ProjectedReclaimUsd__c,
                   ApprovedAt__c, CommittedAt__c, CommitVerified__c,
                   ForensicFinding__c, ForensicFinding__r.Title__c
            FROM RecoveryAction__c
            ORDER BY CreatedDate DESC
            LIMIT 500
        ];

        // Group by status. Iteration order in Map is insertion-based
        // in Apex, so seed the expected statuses up front to control
        // display order.
        Map<String, RecoveryGroup> groups = new Map<String, RecoveryGroup>();
        for (String s : new List<String>{ 'Pending', 'Approved', 'Committed', 'Rejected', 'Expired' }) {
            RecoveryGroup g = new RecoveryGroup();
            g.status = s;
            g.count = 0;
            g.projectedUsd = 0;
            g.actions = new List<RecoveryAction>();
            groups.put(s, g);
        }

        for (RecoveryAction__c r : rows) {
            String status = r.ApprovalStatus__c != null ? r.ApprovalStatus__c : 'Pending';
            RecoveryGroup g = groups.get(status);
            if (g == null) {
                // Status outside our known set — bucket it as Pending.
                g = groups.get('Pending');
            }
            RecoveryAction a = new RecoveryAction();
            a.id = r.Id;
            a.findingId = r.ForensicFinding__c;
            a.findingTitle = r.ForensicFinding__r != null ? r.ForensicFinding__r.Title__c : null;
            a.status = status;
            a.projectedUsd = r.ProjectedReclaimUsd__c != null ? r.ProjectedReclaimUsd__c : 0;
            a.approvedAt = r.ApprovedAt__c;
            a.committedAt = r.CommittedAt__c;
            a.commitVerified = r.CommitVerified__c;
            g.actions.add(a);
            g.count += 1;
            g.projectedUsd += a.projectedUsd;
            dto.totalCount += 1;
            dto.totalProjectedUsd += a.projectedUsd;
        }

        // Only include non-empty groups in the response so the LWC
        // doesn't render empty buckets.
        for (RecoveryGroup g : groups.values()) {
            if (g.count > 0) dto.groups.add(g);
        }
        return dto;
    }

    // ─────────────────────────────────────────────────────────────
    // Scan trend — last N completed scans for the $ trend chart.
    // ─────────────────────────────────────────────────────────────

    public class ScanPoint {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public Decimal totalUsd;
        @AuraEnabled public Integer findingCount;
        @AuraEnabled public Datetime completedAt;
    }

    /**
     * Returns the last `limit` completed scans for trend visualization.
     * Default limit 10 — enough for a meaningful sparkline without
     * dragging back to ancient history. Sorted ASC by completedAt so
     * the LWC can render left→right.
     */
    @AuraEnabled(cacheable=true)
    public static List<ScanPoint> getScanTrend(Integer maxPoints) {
        Integer effective = (maxPoints != null && maxPoints > 0 && maxPoints <= 50) ? maxPoints : 10;
        List<ForensicScan__c> scans = [
            SELECT Id, Name, TotalLeakageUsd__c, FindingCount__c, CompletedAt__c
            FROM ForensicScan__c
            WHERE Status__c IN ('Completed', 'Partial')
              AND CompletedAt__c != null
            ORDER BY CompletedAt__c DESC
            LIMIT :effective
        ];
        // Reverse so the oldest point is first (chart reads left→right).
        List<ScanPoint> out = new List<ScanPoint>();
        for (Integer i = scans.size() - 1; i >= 0; i--) {
            ForensicScan__c s = scans[i];
            ScanPoint p = new ScanPoint();
            p.id = s.Id;
            p.name = s.Name;
            p.totalUsd = s.TotalLeakageUsd__c != null ? s.TotalLeakageUsd__c : 0;
            p.findingCount = (Integer) (s.FindingCount__c != null ? s.FindingCount__c : 0);
            p.completedAt = s.CompletedAt__c;
            out.add(p);
        }
        return out;
    }
}
