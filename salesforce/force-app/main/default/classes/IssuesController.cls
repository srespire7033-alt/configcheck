/**
 * IssuesController — backs the Issues page + issue detail modal.
 *
 * Methods:
 *   getTopIssues(limit)         → list of top-N issues for the latest scan
 *   getIssueDetail(findingId)   → full detail incl. affected records w/ names
 *   updateStatus(findingId, status) → flip Status__c (Open / Acknowledged /
 *                                   Resolved / Ignored / False Positive /
 *                                   Not Relevant)
 *
 * The "Affected Records" list resolves PrimaryRecordId__c → Name via a
 * dynamic Schema describe + grouped SOQL by object type, so the modal
 * can show "Product2 · 10\" Tablet" rows with deep-links to the record.
 */
public with sharing class IssuesController {

    private static final Map<String, String> DETECTOR_CATEGORY_LABEL = new Map<String, String>{
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

    public class IssueRow {
        @AuraEnabled public Id id;
        @AuraEnabled public String detectorId;
        @AuraEnabled public String title;
        @AuraEnabled public String description;
        @AuraEnabled public String severity;
        @AuraEnabled public String status;
        @AuraEnabled public String categoryLabel;
        @AuraEnabled public Decimal gapUsd;
        @AuraEnabled public Integer affectedCount;
    }

    /** A grouped row in the Top Issues panel — same title rolled up. */
    public class IssueGroup {
        @AuraEnabled public String groupKey;            // hash of categoryLabel
        @AuraEnabled public String categoryLabel;
        @AuraEnabled public String severity;            // worst severity in group
        @AuraEnabled public String headlineTitle;       // largest-count member's title
        @AuraEnabled public String headlineDescription;
        @AuraEnabled public Integer totalAffected;      // sum across members
        @AuraEnabled public Integer relatedCount;       // number of distinct sub-titles
        @AuraEnabled public Id primaryFindingId;        // for direct-link "View"
        @AuraEnabled public List<IssueRow> members;     // distinct titles → roll-up rows
    }

    public class IssueDetailDto {
        @AuraEnabled public Id id;
        @AuraEnabled public String detectorId;
        @AuraEnabled public String title;
        @AuraEnabled public String description;
        @AuraEnabled public String severity;
        @AuraEnabled public String status;
        @AuraEnabled public String categoryLabel;
        @AuraEnabled public Decimal gapUsd;
        @AuraEnabled public String whyItMatters;     // derived
        @AuraEnabled public String recommendedFix;   // derived
        @AuraEnabled public List<AffectedRecord> affectedRecords;
    }

    public class AffectedRecord {
        @AuraEnabled public Id id;
        @AuraEnabled public String objectType;
        @AuraEnabled public String name;
    }

    /**
     * Top N un-hidden issues for the latest completed scan, sorted by
     * severity (Critical > Warning > Info) then GapUsd__c desc.
     */
    @AuraEnabled(cacheable=true)
    public static List<IssueRow> getTopIssues(Integer maxResults) {
        return getTopIssuesScoped(maxResults, null);
    }

    /** Phase 22w — scoped variant. The original signature stays so any
     *  unforeseen caller keeps the global behavior; new callers use this. */
    @AuraEnabled(cacheable=true)
    public static List<IssueRow> getTopIssuesScoped(Integer maxResults, Id connectedOrgId) {
        Integer limitN = (maxResults == null || maxResults <= 0) ? 25 : maxResults;
        List<IssueRow> out = new List<IssueRow>();

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
        if (scans.isEmpty()) return out;
        Id scanId = scans[0].Id;

        // SOQL can't sort by an arbitrary picklist ordinal — pull then sort in Apex.
        for (ForensicFinding__c f : [
            SELECT Id, DetectorId__c, Title__c, Description__c, Severity__c, Status__c,
                   GapUsd__c, PrimaryRecordId__c
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId AND HiddenAt__c = null
            WITH SECURITY_ENFORCED ORDER BY GapUsd__c DESC NULLS LAST
            LIMIT 500
        ]) {
            IssueRow r = new IssueRow();
            r.id = f.Id;
            r.detectorId = f.DetectorId__c;
            r.title = f.Title__c;
            r.description = f.Description__c;
            r.severity = f.Severity__c;
            r.status = f.Status__c;
            r.categoryLabel = DETECTOR_CATEGORY_LABEL.containsKey(f.DetectorId__c)
                ? DETECTOR_CATEGORY_LABEL.get(f.DetectorId__c) : f.DetectorId__c;
            r.gapUsd = f.GapUsd__c == null ? 0 : f.GapUsd__c;
            r.affectedCount = 1;
            out.add(r);
        }
        // Sort: critical first, warning, info; then gapUsd desc
        out.sort(new IssueRowComparator());
        if (out.size() > limitN) {
            List<IssueRow> trimmed = new List<IssueRow>();
            for (Integer i = 0; i < limitN; i++) trimmed.add(out[i]);
            return trimmed;
        }
        return out;
    }

    /** Full detail for one finding, including affected-record names. */
    @AuraEnabled(cacheable=true)
    public static IssueDetailDto getIssueDetail(Id findingId) {
        if (findingId == null) return null;
        List<ForensicFinding__c> rows = [
            SELECT Id, DetectorId__c, Title__c, Description__c, Severity__c, Status__c,
                   GapUsd__c, PrimaryRecordId__c, PrimaryRecordType__c
            FROM ForensicFinding__c
            WHERE Id = :findingId
            WITH SECURITY_ENFORCED LIMIT 1
        ];
        if (rows.isEmpty()) return null;
        ForensicFinding__c f = rows[0];

        IssueDetailDto dto = new IssueDetailDto();
        dto.id = f.Id;
        dto.detectorId = f.DetectorId__c;
        dto.title = f.Title__c;
        dto.description = f.Description__c;
        dto.severity = f.Severity__c;
        dto.status = f.Status__c;
        dto.categoryLabel = DETECTOR_CATEGORY_LABEL.containsKey(f.DetectorId__c)
            ? DETECTOR_CATEGORY_LABEL.get(f.DetectorId__c) : f.DetectorId__c;
        dto.gapUsd = f.GapUsd__c == null ? 0 : f.GapUsd__c;
        dto.whyItMatters = buildWhyItMatters(f);
        dto.recommendedFix = buildRecommendedFix(f);
        dto.affectedRecords = resolveAffectedRecords(f);
        return dto;
    }

    /** Updates Status__c. Allowed: Open / Acknowledged / Resolved / Ignored / False Positive / Not Relevant.
     *  Side-effect: when status is False Positive / Not Relevant / Ignored, creates a
     *  ForensicSuppression__c record so future scans can skip this detector+record. */
    @AuraEnabled
    public static void updateStatus(Id findingId, String status) {
        if (findingId == null || String.isBlank(status)) return;
        Set<String> valid = new Set<String>{
            'Open','Acknowledged','Resolved','Ignored','False Positive','Not Relevant'
        };
        if (!valid.contains(status)) throw new AuraHandledException('Invalid status: ' + status);
        // Read for suppression context BEFORE the update so we have detector + primary record.
        ForensicFinding__c orig = [
            SELECT Id, DetectorId__c, PrimaryRecordId__c
            FROM ForensicFinding__c WHERE Id = :findingId WITH SECURITY_ENFORCED LIMIT 1
        ];
        ForensicFinding__c f = new ForensicFinding__c(Id = findingId, Status__c = status);
        update f;
        if (status == 'False Positive' || status == 'Not Relevant' || status == 'Ignored') {
            upsertSuppression(orig.DetectorId__c, orig.PrimaryRecordId__c, status);
        }
    }

    /** Bulk status update — drives the "Acknowledge / Resolve / Mark Not Relevant"
     *  multi-select actions on the All Issues page. Same suppression side-effects. */
    @AuraEnabled
    public static void bulkUpdateStatus(List<Id> findingIds, String status) {
        if (findingIds == null || findingIds.isEmpty() || String.isBlank(status)) return;
        Set<String> valid = new Set<String>{
            'Open','Acknowledged','Resolved','Ignored','False Positive','Not Relevant'
        };
        if (!valid.contains(status)) throw new AuraHandledException('Invalid status: ' + status);
        List<ForensicFinding__c> originals = [
            SELECT Id, DetectorId__c, PrimaryRecordId__c
            FROM ForensicFinding__c WHERE Id IN :findingIds WITH SECURITY_ENFORCED ];
        List<ForensicFinding__c> toUpdate = new List<ForensicFinding__c>();
        for (ForensicFinding__c o : originals) {
            toUpdate.add(new ForensicFinding__c(Id = o.Id, Status__c = status));
        }
        if (!toUpdate.isEmpty()) update toUpdate;
        if (status == 'False Positive' || status == 'Not Relevant' || status == 'Ignored') {
            List<ForensicSuppression__c> sups = new List<ForensicSuppression__c>();
            for (ForensicFinding__c o : originals) {
                sups.add(buildSuppression(o.DetectorId__c, o.PrimaryRecordId__c, status));
            }
            insert sups;
        }
    }

    /** Top N issue GROUPS for the dashboard "Top Issues to Address" card.
     *  Groups by categoryLabel, picks the largest-volume title as the headline,
     *  rolls up distinct sub-titles as 'related' members with counts. */
    /** Phase 22w — connectedOrgId param scopes the rollup to the active
     *  Connected Org. */
    @AuraEnabled(cacheable=true)
    public static List<IssueGroup> getTopIssueGroups(Integer maxGroups, Id connectedOrgId) {
        Integer n = (maxGroups == null || maxGroups <= 0) ? 5 : maxGroups;
        List<IssueRow> raw = getTopIssuesScoped(500, connectedOrgId);
        if (raw.isEmpty()) return new List<IssueGroup>();

        // Phase 24d — Vercel parity: Top Issues drops Info-severity rows
        // before grouping (src/app/orgs/[orgId]/page.tsx ≈L1510).
        // "Top" means the highest-priority items the user needs to act on;
        // info-only signals belong in the All Issues view, not the top-5.
        List<IssueRow> flat = new List<IssueRow>();
        for (IssueRow r : raw) {
            if (r.severity == 'Info') continue;
            flat.add(r);
        }
        if (flat.isEmpty()) return new List<IssueGroup>();

        // Bucket by categoryLabel
        Map<String, List<IssueRow>> byCat = new Map<String, List<IssueRow>>();
        for (IssueRow r : flat) {
            String k = r.categoryLabel == null ? '—' : r.categoryLabel;
            if (!byCat.containsKey(k)) byCat.put(k, new List<IssueRow>());
            byCat.get(k).add(r);
        }

        List<IssueGroup> groups = new List<IssueGroup>();
        for (String cat : byCat.keySet()) {
            List<IssueRow> rows = byCat.get(cat);

            // Group rows within this category by NORMALIZED title — strips
            // embedded record numbers (Order 00000739 → Order N, Quote Q-00188 → Quote N)
            // so multiple findings on the same detector roll up into one row
            // with relatedCount = N instead of N separate single-finding rows.
            Map<String, List<IssueRow>> byTitle = new Map<String, List<IssueRow>>();
            for (IssueRow r : rows) {
                String t = normalizeTitle(r.title);
                if (!byTitle.containsKey(t)) byTitle.put(t, new List<IssueRow>());
                byTitle.get(t).add(r);
            }

            // Build members (one IssueRow per distinct normalized title,
            // count rolled into affectedCount). headlineTitle uses the
            // normalized form; modal drill-down preserves originals.
            List<IssueRow> members = new List<IssueRow>();
            Integer totalAffected = 0;
            for (String t : byTitle.keySet()) {
                List<IssueRow> tRows = byTitle.get(t);
                IssueRow first = tRows[0];
                IssueRow m = new IssueRow();
                m.id = first.id;
                m.detectorId = first.detectorId;
                m.title = t == null || t == '' ? first.title : t; // normalized form
                m.description = first.description;
                m.severity = worstSeverity(tRows);
                m.status = first.status;
                m.categoryLabel = first.categoryLabel;
                m.gapUsd = first.gapUsd;
                m.affectedCount = tRows.size();
                members.add(m);
                totalAffected += tRows.size();
            }
            members.sort(new IssueRowComparator());

            IssueGroup g = new IssueGroup();
            g.groupKey = cat;
            g.categoryLabel = cat;
            g.severity = worstSeverity(rows);
            g.totalAffected = totalAffected;
            g.relatedCount = members.size();
            g.primaryFindingId = members.isEmpty() ? null : members[0].id;
            // Use the largest-count member's title as the headline; fall back to a built phrase.
            g.headlineTitle = members[0].title;
            g.headlineDescription = members[0].description;
            g.members = members;
            groups.add(g);
        }

        // Sort: critical groups first (by worst severity), then by total affected desc
        groups.sort(new IssueGroupComparator());
        if (groups.size() > n) {
            List<IssueGroup> trimmed = new List<IssueGroup>();
            for (Integer i = 0; i < n; i++) trimmed.add(groups[i]);
            return trimmed;
        }
        return groups;
    }

    /** All issues with optional severity/status filters + text search.
     *  severityFilters / statusFilters are inclusive — empty / null = no filter. */
    /** Phase 22w — connectedOrgId param scopes the issues list to the
     *  active Connected Org instead of "latest scan globally." */
    @AuraEnabled(cacheable=true)
    public static List<IssueRow> getAllIssues(List<String> severityFilters, List<String> statusFilters, String search, Id connectedOrgId) {
        List<IssueRow> out = new List<IssueRow>();
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
        if (scans.isEmpty()) return out;
        Id scanId = scans[0].Id;

        // Build SOQL dynamically
        String soql = 'SELECT Id, DetectorId__c, Title__c, Description__c, Severity__c, Status__c, '
                    + 'GapUsd__c, PrimaryRecordId__c '
                    + 'FROM ForensicFinding__c WHERE ForensicScan__c = :scanId '
                    + 'AND HiddenAt__c = null';
        if (severityFilters != null && !severityFilters.isEmpty()) {
            soql += ' AND Severity__c IN :severityFilters';
        }
        if (statusFilters != null && !statusFilters.isEmpty()) {
            soql += ' AND Status__c IN :statusFilters';
        }
        String searchLike = null;
        if (!String.isBlank(search)) {
            searchLike = '%' + String.escapeSingleQuotes(search) + '%';
            soql += ' AND Title__c LIKE :searchLike';
        }
        soql += ' ORDER BY GapUsd__c DESC NULLS LAST LIMIT 1000';

        for (ForensicFinding__c f : Database.query(soql)) {
            IssueRow r = new IssueRow();
            r.id = f.Id;
            r.detectorId = f.DetectorId__c;
            r.title = f.Title__c;
            r.description = f.Description__c;
            r.severity = f.Severity__c;
            r.status = f.Status__c;
            r.categoryLabel = DETECTOR_CATEGORY_LABEL.containsKey(f.DetectorId__c)
                ? DETECTOR_CATEGORY_LABEL.get(f.DetectorId__c) : f.DetectorId__c;
            r.gapUsd = f.GapUsd__c == null ? 0 : f.GapUsd__c;
            r.affectedCount = 1;
            out.add(r);
        }
        out.sort(new IssueRowComparator());
        return out;
    }

    // ────────── helpers ──────────

    private static String buildWhyItMatters(ForensicFinding__c f) {
        // Severity-based default. Real prose lives in the SaaS renderer; we
        // ship a sensible Salesforce-side fallback.
        if (f.Severity__c == 'Critical') {
            return 'This issue represents verified revenue leakage or a process gap that puts billings at risk.';
        } else if (f.Severity__c == 'Warning') {
            return 'This issue indicates a control gap or pricing drift that could escalate to revenue impact if unaddressed.';
        }
        return 'Best-practice gap — addressing improves data quality and downstream reporting accuracy.';
    }

    private static String buildRecommendedFix(ForensicFinding__c f) {
        // Detector-specific recommendation. Lightweight registry until we
        // wire to the SaaS renderer prose persisted on the finding record.
        Map<String, String> fixes = new Map<String, String>{
            'REN-001'     => 'Compare renewal Quote line prices to entitled uplift; bulk-update mispriced lines via Data Loader.',
            'REN-002'     => 'Update Quote line prices to match current PricebookEntry, or document approved discount.',
            'REN-003'     => 'Open the renewal Quote, attach to Opportunity, and progress to Approved stage.',
            'REN-004'     => 'Activate the renewal Quote or close the contract; do not let it sit in Draft past contract end.',
            'DSC-FOR-001' => 'Review the Discount Schedule\'s end date; extend or remove orphaned Quote line discounts.',
            'DSC-FOR-002' => 'Re-evaluate stacked discounts against approval thresholds; route to Approval if over cap.',
            'QL-FOR-001'  => 'Set Charge Type on each bundle option, or remove from bundle if intentionally promotional.',
            'QL-FOR-002'  => 'Resubmit the Quote line through the Approval Process; verify approver routing rules.',
            'ORD-FOR-001' => 'Set Charge Type (One-Time / Recurring / Usage), Revenue Recognition Rule, Tax Rule, and Billing Rule on each product.',
            'ORD-FOR-002' => 'Reconcile the Order line to the source Quote line; correct the variant or refresh from Quote.',
            'ORD-FOR-003' => 'Re-link the amendment Order line to the originating Subscription.',
            'SUB-FOR-001' => 'Attach the orphan Subscription to its parent Contract via SBQQ__Contract__c.',
            'PROV-FOR-001'=> 'Run the provisioning batch job, or manually create Asset records for active subscriptions.',
            'PROV-FOR-002'=> 'Create the missing Asset record so the Subscription rolls up to a billable entity.',
            'OPP-FOR-001' => 'Set required Opportunity fields (Close Date, Amount, Stage); enforce via validation rule.',
            'CON-FOR-001' => 'Set Contract End Date and ensure renewal is scheduled before expiry.',
            'AMD-FOR-001' => 'Set the Amendment effective date; required for downstream proration.',
            'AST-FOR-001' => 'Issue a credit memo for the unused portion or write a justification in Notes.',
            'CT-FOR-001'  => 'Update the expired Contracted Price or remove it from active Quotes.',
            'MDQ-FOR-001' => 'Recalculate MDQ segment prices using the latest pricebook; redeploy if pricing rules changed.'
        };
        if (fixes.containsKey(f.DetectorId__c)) return fixes.get(f.DetectorId__c);
        return 'Review the affected record(s) and apply the standard remediation for this detector.';
    }

    private static List<AffectedRecord> resolveAffectedRecords(ForensicFinding__c f) {
        List<AffectedRecord> out = new List<AffectedRecord>();
        if (String.isBlank(f.PrimaryRecordId__c)) return out;
        String objType = f.PrimaryRecordType__c;
        if (String.isBlank(objType)) {
            // Best-effort: try to derive object from the ID prefix.
            try { objType = ((Id)f.PrimaryRecordId__c).getSObjectType().getDescribe().getName(); }
            catch (Exception e) { /* ignore */ }
        }
        if (String.isBlank(objType)) return out;

        Map<String, Schema.SObjectType> globalMap = Schema.getGlobalDescribe();
        Schema.SObjectType sType = globalMap.get(objType);
        if (sType == null) return out;

        String nameField = pickNameField(sType);
        String soql = 'SELECT Id, ' + nameField + ' FROM ' + objType
                    + ' WHERE Id = :pid LIMIT 1';
        try {
            String pid = f.PrimaryRecordId__c;
            for (SObject s : Database.query(soql)) {
                AffectedRecord r = new AffectedRecord();
                r.id = (Id) s.get('Id');
                r.objectType = objType;
                r.name = (String) s.get(nameField);
                out.add(r);
            }
        } catch (Exception e) {
            // Record may have been deleted; leave list empty.
        }
        return out;
    }

    /** Picks the best display field on the object (Name / Subject / Title). */
    private static String pickNameField(Schema.SObjectType sType) {
        Map<String, Schema.SObjectField> fields = sType.getDescribe().fields.getMap();
        if (fields.containsKey('name')) return 'Name';
        if (fields.containsKey('subject')) return 'Subject';
        if (fields.containsKey('title')) return 'Title';
        return 'Id';
    }

    /**
     * Strips embedded record names/numbers so titles cluster.
     *   "Order 00000739 activated with no billing schedule"
     *     → "Order activated with no billing schedule"
     *   "Quote Q-00188 expired 7d ago — no renewal opened (USD 0 ARR at risk)"
     *     → "Quote expired Nd ago — no renewal opened (USD 0 ARR at risk)"
     *   "Renewal Quote Q-00187 61d past contract end — still in Draft"
     *     → "Renewal Quote past contract end — still in Draft"
     */
    @TestVisible
    private static String normalizeTitle(String title) {
        if (String.isBlank(title)) return '—';
        String t = title;
        // Strip "Order 00000739" → "Order"
        t = t.replaceAll('\\b(Order|Quote|Subscription|Contract|Asset|Opportunity|Amendment)\\s+[A-Z0-9-]{3,}', '$1');
        // Strip standalone long numbers (record IDs etc.)
        t = t.replaceAll('\\b\\d{4,}\\b', 'N');
        // Strip "61d", "7d ago" etc — keep "N days" form
        t = t.replaceAll('\\b\\d+d\\b', 'Nd');
        // Collapse runs of whitespace
        t = t.replaceAll('\\s{2,}', ' ').trim();
        return t;
    }

    private static String worstSeverity(List<IssueRow> rows) {
        Integer best = 0; String label = 'Info';
        for (IssueRow r : rows) {
            Integer rank = (r.severity == 'Critical') ? 3
                         : (r.severity == 'Warning')  ? 2
                         : (r.severity == 'Info')     ? 1 : 0;
            if (rank > best) { best = rank; label = r.severity; }
        }
        return label;
    }

    private static void upsertSuppression(String detectorId, String primaryRecordId, String reason) {
        if (String.isBlank(detectorId)) return;
        List<ForensicSuppression__c> existing = [
            SELECT Id FROM ForensicSuppression__c
            WHERE DetectorId__c = :detectorId
              AND PrimaryRecordId__c = :primaryRecordId
            WITH SECURITY_ENFORCED LIMIT 1
        ];
        if (!existing.isEmpty()) return; // already suppressed
        insert buildSuppression(detectorId, primaryRecordId, reason);
    }

    private static ForensicSuppression__c buildSuppression(String detectorId, String primaryRecordId, String reason) {
        ForensicSuppression__c s = new ForensicSuppression__c();
        s.DetectorId__c = detectorId;
        s.PrimaryRecordId__c = primaryRecordId;
        s.Reason__c = reason;
        return s;
    }

    /** Sort groups: worst-severity first, then total affected desc. */
    public class IssueGroupComparator implements Comparator<IssueGroup> {
        public Integer compare(IssueGroup a, IssueGroup b) {
            Integer rs = sevRank(b.severity) - sevRank(a.severity);
            if (rs != 0) return rs;
            return (b.totalAffected == null ? 0 : b.totalAffected)
                 - (a.totalAffected == null ? 0 : a.totalAffected);
        }
        private Integer sevRank(String s) {
            if (s == 'Critical') return 3;
            if (s == 'Warning')  return 2;
            if (s == 'Info')     return 1;
            return 0;
        }
    }

    /** Phase 24d — Vercel parity. Sort: Critical > Warning > Info, then
     *  affectedCount desc. Vercel uses affected_records.length as the
     *  tiebreak (src/app/orgs/[orgId]/page.tsx ≈L1507); we use the
     *  affectedCount integer we already compute during normalisation.
     *  GapUsd is a less consistent signal across detectors (many are 0),
     *  so it makes a poor secondary sort. */
    public class IssueRowComparator implements Comparator<IssueRow> {
        public Integer compare(IssueRow a, IssueRow b) {
            Integer rs = sevRank(b.severity) - sevRank(a.severity);
            if (rs != 0) return rs;
            Integer ac = a.affectedCount == null ? 0 : a.affectedCount;
            Integer bc = b.affectedCount == null ? 0 : b.affectedCount;
            return bc - ac;
        }
        private Integer sevRank(String s) {
            if (s == 'Critical') return 3;
            if (s == 'Warning')  return 2;
            if (s == 'Info')     return 1;
            return 0;
        }
    }
}
