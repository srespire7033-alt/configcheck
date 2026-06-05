/**
 * Backing controller for the ExecutiveReport Visualforce page (which
 * renders as PDF). Loads the latest completed scan + its findings
 * and exposes them via getters the VF markup can iterate over.
 *
 * Public surface:
 *   scan            → ForensicScan__c   (latest completed/partial)
 *   findings        → List<ForensicFinding__c> (top 20 by gap)
 *   detectorGroups  → grouped findings for the executive section
 *   reportDate      → when the report was generated (footer)
 *   criticalCount / warningCount / infoCount
 *
 * The VF page accepts an optional `scanId` URL param. When omitted,
 * it defaults to the latest completed scan.
 */
public with sharing class ExecutiveReportController {

    public ForensicScan__c scan { get; private set; }
    public List<ForensicFinding__c> findings { get; private set; }
    public Integer criticalCount { get; private set; }
    public Integer warningCount { get; private set; }
    public Integer infoCount { get; private set; }
    public Datetime reportDate { get; private set; }

    // Phase 22g — Health Score headline + per-category bucket breakdown.
    // Headline reflects the Phase 22d sqrt-curve formula; category
    // entries reflect Phase 22e bucket weights. Sorted ascending by
    // score so the worst category surfaces first in the report.
    public Integer healthScore { get; private set; }
    public String healthTone { get; private set; }    // "bad" | "warn" | "good" — for VF CSS binding
    public List<CategoryEntry> categoryScores { get; private set; }

    public class CategoryEntry {
        public String key { get; set; }      // e.g. "governance"
        public String label { get; set; }    // friendly: "Governance"
        public Integer score { get; set; }   // 0-100
        public String tone { get; set; }     // "bad" (<50) | "warn" (50-79) | "good" (>=80)
    }

    /**
     * Phase 16a — smart executive narrative.
     *
     * Two paragraphs synthesized across the WHOLE scan:
     *   1. Headline: total leakage, what % concentrated in top categories,
     *      severity mix.
     *   2. Root-cause: dominant root-cause class(es), what they mean
     *      operationally, the recommended priority sequence.
     *
     * Both are computed in Apex with no AI call — the data already
     * carries the structure. We just synthesize it instead of templating
     * per-finding.
     */
    public ExecutiveNarrative narrative1 { get; private set; }

    public class ExecutiveNarrative {
        public String headline { get; set; }
        public String rootCauseParagraph { get; set; }
        public List<PriorityItem> prioritySequence { get; set; }
        public String topAccountsLine { get; set; }
    }

    public class PriorityItem {
        public Integer rank { get; set; }
        public String label { get; set; }
        public String detail { get; set; }
        public String amountFmt { get; set; }
    }

    /**
     * Phase 14b — per-finding wrapper exposed to the VF page so the
     * Top-Findings section can render the polished attribution
     * narrative + any consultant notes alongside the finding details.
     */
    public class FindingRow {
        public ForensicFinding__c f { get; set; }
        public AttributionTrace__c primaryTrace { get; set; }
        public String rootCauseLabel { get; set; }   // "Class B · Manual Override"
        public Boolean hasNotes { get; set; }
        public String notes { get; set; }
    }
    public List<FindingRow> findingRows { get; private set; }

    public class DetectorBucket {
        public String detectorId { get; set; }
        public String label { get; set; }
        public Integer count { get; set; }
        public Decimal totalUsd { get; set; }
        public List<ForensicFinding__c> findings { get; set; }
    }
    public List<DetectorBucket> detectorGroups { get; private set; }

    /**
     * Phase 19d — class labels now sourced from AttributionClass__mdt
     * via AttributionClassCatalog. This local map is gone; the
     * catalog returns the right text whether mdt is seeded or not.
     * Kept the variable name as a tiny shim so existing references
     * compile without renaming.
     */
    @TestVisible
    private static String classLabel(String letter) {
        return AttributionClassCatalog.getLabel(letter);
    }

    /** Friendly labels for detector IDs — keeps PDF readable for clients. */
    private static final Map<String, String> DETECTOR_LABELS = new Map<String, String>{
        'REN-001'     => 'Renewal uplift suppressed',
        'REN-002'     => 'Renewal below current list',
        'REN-003'     => 'Renewal forecast slipping',
        'REN-004'     => 'Renewal quote stuck in draft',
        'DSC-FOR-001' => 'Expired promo discount applied',
        'DSC-FOR-002' => 'Stacked discounts past cap',
        'QL-FOR-001'  => 'Bundle required option at $0',
        'QL-FOR-002'  => 'Quote line approval skipped',
        'ORD-FOR-001' => 'Order activated, no billing schedule',
        'ORD-FOR-002' => 'Q↔O variance (new business)',
        'ORD-FOR-003' => 'Q↔O variance (amendment)',
        'SUB-FOR-001' => 'Subscription pricing miss',
        'PROV-FOR-001'=> 'Provisioning mismatch',
        'PROV-FOR-002'=> 'Active subscription, no asset',
        'OPP-FOR-001' => 'Opportunity governance miss',
        'CON-FOR-001' => 'Contract governance miss',
        'AMD-FOR-001' => 'Amendment without effective date',
        'AST-FOR-001' => 'Asset terminated mid-contract',
        'CT-FOR-001'  => 'Contracted price expired',
        'MDQ-FOR-001' => 'MDQ segment pricing inconsistency'
    };

    public ExecutiveReportController() {
        reportDate = System.now();
        findings = new List<ForensicFinding__c>();
        detectorGroups = new List<DetectorBucket>();
        criticalCount = 0;
        warningCount = 0;
        infoCount = 0;
        healthScore = 100;                              // Phase 22g — defaults survive an empty PDF render
        healthTone = 'good';
        categoryScores = new List<CategoryEntry>();

        // Resolve scan: URL param scanId, else latest completed.
        String scanIdParam = ApexPages.currentPage() != null
            ? ApexPages.currentPage().getParameters().get('scanId') : null;
        if (String.isNotBlank(scanIdParam)) {
            String directSoql =
                'SELECT Id, Name, Status__c, ProductType__c, StartedAt__c, ' +
                '       CompletedAt__c, TotalLeakageUsd__c, FindingCount__c, ' +
                '       HealthScore__c, CategoryScoresJson__c' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM ForensicScan__c WHERE Id = :scanIdParam WITH SECURITY_ENFORCED LIMIT 1';
            List<ForensicScan__c> direct = Database.query(directSoql);
            if (!direct.isEmpty()) scan = direct[0];
        }
        if (scan == null) {
            String latestSoql =
                'SELECT Id, Name, Status__c, ProductType__c, StartedAt__c, ' +
                '       CompletedAt__c, TotalLeakageUsd__c, FindingCount__c, ' +
                '       HealthScore__c, CategoryScoresJson__c' +
                CurrencyContext.soqlSelect() + ' ' +
                'FROM ForensicScan__c ' +
                'WHERE Status__c IN (\'Completed\', \'Partial\') ' +
                'WITH SECURITY_ENFORCED ORDER BY StartedAt__c DESC LIMIT 1';
            List<ForensicScan__c> latest = Database.query(latestSoql);
            if (!latest.isEmpty()) scan = latest[0];
        }
        if (scan == null) return;

        // Phase 22g — surface the Phase 22d/e scoring data to the PDF
        // so consultants get the "where is the org broken" story
        // directly in the deliverable, not just the dashboard.
        if (scan.HealthScore__c != null) {
            healthScore = scan.HealthScore__c.intValue();
        }
        healthTone = healthScore < 50 ? 'bad' : (healthScore < 80 ? 'warn' : 'good');
        categoryScores = parseCategoryScores(scan.CategoryScoresJson__c);

        // Top 20 findings by gap for the detail table. Phase 14b —
        // also pull UserNotes__c so the consultant's note can render
        // alongside the finding in the PDF.
        // Dynamic SOQL binds only accept simple identifiers, so extract
        // scan.Id to a local before building the query string.
        Id scanRecordId = scan.Id;
        String findingsSoql =
            'SELECT Id, DetectorId__c, Title__c, Description__c, Severity__c, ' +
            '       GapUsd__c, EntitledUsd__c, RealizedUsd__c, ' +
            '       RecoverabilityScore__c' + CurrencyContext.soqlSelect() + ', UserNotes__c, ' +
            '       RemediationRecipe__c ' +
            'FROM ForensicFinding__c ' +
            'WHERE ForensicScan__c = :scanRecordId ' +
            '  AND HiddenAt__c = null ' +
            '  AND GapUsd__c != null ' +
            'WITH SECURITY_ENFORCED ORDER BY GapUsd__c DESC ' +
            'LIMIT 20';
        findings = Database.query(findingsSoql);

        // Pull the highest-confidence attribution trace per finding.
        // One query then group in memory — cheaper than N sub-queries.
        Map<Id, AttributionTrace__c> primaryByFinding = new Map<Id, AttributionTrace__c>();
        if (!findings.isEmpty()) {
            Set<Id> fIds = new Set<Id>();
            for (ForensicFinding__c f : findings) fIds.add(f.Id);
            for (AttributionTrace__c t : [
                SELECT Id, ForensicFinding__c, RootCauseClass__c, ReasonCode__c,
                       Confidence__c, RootConfigType__c, RootConfigName__c,
                       AiExplanation__c
                FROM AttributionTrace__c
                WHERE ForensicFinding__c IN :fIds
                WITH SECURITY_ENFORCED
                ORDER BY Confidence__c DESC NULLS LAST
            ]) {
                if (!primaryByFinding.containsKey(t.ForensicFinding__c)) {
                    primaryByFinding.put(t.ForensicFinding__c, t);
                }
            }
        }

        findingRows = new List<FindingRow>();
        for (ForensicFinding__c f : findings) {
            FindingRow row = new FindingRow();
            row.f = f;
            row.primaryTrace = primaryByFinding.get(f.Id);
            row.hasNotes = String.isNotBlank(f.UserNotes__c);
            row.notes = f.UserNotes__c;
            if (row.primaryTrace != null) {
                String cls = row.primaryTrace.RootCauseClass__c;
                String label = classLabel(cls);
                if (label == null) label = cls;
                row.rootCauseLabel = (cls != null ? 'Class ' + cls + ' · ' : '') + label;
            }
            findingRows.add(row);
        }

        // Severity counts from ALL unhidden findings (not just top 20).
        AggregateResult[] sevAgg = [
            SELECT Severity__c sev, COUNT(Id) cnt
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scan.Id AND HiddenAt__c = null
            WITH SECURITY_ENFORCED GROUP BY Severity__c
        ];
        for (AggregateResult ag : sevAgg) {
            String s = (String) ag.get('sev');
            Integer c = (Integer) ag.get('cnt');
            if (s == 'Critical') criticalCount = c;
            else if (s == 'Warning') warningCount = c;
            else if (s == 'Info') infoCount = c;
        }

        // Group findings by detector for the executive summary section.
        Map<String, DetectorBucket> groups = new Map<String, DetectorBucket>();
        for (ForensicFinding__c f : findings) {
            DetectorBucket b = groups.get(f.DetectorId__c);
            if (b == null) {
                b = new DetectorBucket();
                b.detectorId = f.DetectorId__c;
                b.label = DETECTOR_LABELS.containsKey(f.DetectorId__c)
                    ? DETECTOR_LABELS.get(f.DetectorId__c) : f.DetectorId__c;
                b.count = 0;
                b.totalUsd = 0;
                b.findings = new List<ForensicFinding__c>();
                groups.put(f.DetectorId__c, b);
            }
            b.count += 1;
            b.totalUsd += (f.GapUsd__c != null ? f.GapUsd__c : 0);
            b.findings.add(f);
        }
        // Sort buckets by total $ desc (small list, insertion sort).
        detectorGroups = new List<DetectorBucket>(groups.values());
        for (Integer i = 1; i < detectorGroups.size(); i++) {
            DetectorBucket k = detectorGroups[i];
            Integer j = i - 1;
            while (j >= 0 && detectorGroups[j].totalUsd < k.totalUsd) {
                detectorGroups[j + 1] = detectorGroups[j];
                j -= 1;
            }
            detectorGroups[j + 1] = k;
        }

        // Phase 16a — synthesize the executive narrative AFTER the
        // findings + detector buckets are loaded so we can reason
        // across them. Wrapped in try/catch so a narrative bug never
        // blocks the PDF from rendering.
        try {
            narrative1 = buildNarrative(primaryByFinding);
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN,
                'buildNarrative failed: ' + e.getMessage());
            narrative1 = null;
        }
    }

    /**
     * Smart cross-finding synthesis. Reads the same data the rest of
     * the controller already gathered (findings, detectorGroups,
     * primaryByFinding) and produces the executive narrative.
     */
    @TestVisible
    private ExecutiveNarrative buildNarrative(Map<Id, AttributionTrace__c> primaryByFinding) {
        if (findings == null || findings.isEmpty()) return null;

        ExecutiveNarrative n = new ExecutiveNarrative();
        Decimal totalUsd = scan.TotalLeakageUsd__c == null ? 0 : scan.TotalLeakageUsd__c;
        Integer findingTotal = scan.FindingCount__c == null ? 0 : Integer.valueOf(scan.FindingCount__c);

        // ── Headline paragraph ───────────────────────────────────────
        // Top-3 detector buckets are already sorted by $ desc.
        Integer topN = Math.min(3, detectorGroups.size());
        Decimal topNTotal = 0;
        List<String> topLabels = new List<String>();
        for (Integer i = 0; i < topN; i++) {
            topNTotal += detectorGroups[i].totalUsd;
            topLabels.add(detectorGroups[i].label.toLowerCase());
        }
        Integer topNPct = totalUsd > 0
            ? Integer.valueOf((topNTotal / totalUsd * 100).setScale(0, System.RoundingMode.HALF_UP))
            : 0;

        String severityMix = '';
        if (criticalCount > 0) severityMix += criticalCount + ' Critical';
        if (warningCount > 0) {
            if (!String.isBlank(severityMix)) severityMix += ' · ';
            severityMix += warningCount + ' Warning';
        }
        if (infoCount > 0) {
            if (!String.isBlank(severityMix)) severityMix += ' · ';
            severityMix += infoCount + ' Info';
        }

        n.headline =
            'This audit surfaced ' + money(totalUsd) + ' of revenue exposure ' +
            'across ' + findingTotal + ' findings'
            + (topN > 0
                ? ' — ' + topNPct + '% concentrated in ' + joinLowercase(topLabels)
                : '')
            + '.'
            + (String.isBlank(severityMix) ? '' : ' Severity mix: ' + severityMix + '.');

        // ── Root-cause paragraph ─────────────────────────────────────
        // Aggregate $ by root-cause class across the loaded findings.
        Map<String, Decimal> usdByClass = new Map<String, Decimal>();
        Map<String, Integer> countByClass = new Map<String, Integer>();
        for (ForensicFinding__c f : findings) {
            AttributionTrace__c t = primaryByFinding.get(f.Id);
            if (t == null || t.RootCauseClass__c == null) continue;
            Decimal gap = f.GapUsd__c == null ? 0 : f.GapUsd__c;
            String cls = t.RootCauseClass__c;
            usdByClass.put(cls, (usdByClass.containsKey(cls) ? usdByClass.get(cls) : 0) + gap);
            countByClass.put(cls, (countByClass.containsKey(cls) ? countByClass.get(cls) : 0) + 1);
        }
        // Pick the top-1 root-cause class by $.
        String topClass = null;
        Decimal topClassUsd = 0;
        for (String cls : usdByClass.keySet()) {
            if (usdByClass.get(cls) > topClassUsd) {
                topClassUsd = usdByClass.get(cls);
                topClass = cls;
            }
        }
        if (topClass != null) {
            String classLabelText = classLabel(topClass);
            if (classLabelText == null) classLabelText = topClass;
            Integer topClassPct = totalUsd > 0
                ? Integer.valueOf((topClassUsd / totalUsd * 100).setScale(0, System.RoundingMode.HALF_UP))
                : 0;
            n.rootCauseParagraph =
                'Attribution analysis points to ' + classLabelText.toLowerCase() +
                ' (Class ' + topClass + ') as the dominant root cause, ' +
                'accounting for ' + money(topClassUsd) +
                ' (' + topClassPct + '% of total exposure) across ' +
                countByClass.get(topClass) + ' finding' +
                (countByClass.get(topClass) == 1 ? '' : 's') + '. ' +
                classRecommendation(topClass);
        } else {
            n.rootCauseParagraph =
                'Attribution traces were not available for this scan — ' +
                'inspect individual findings for root-cause detail.';
        }

        // ── Priority sequence (top-5 findings by gap × recoverability) ─
        List<ForensicFinding__c> ranked = new List<ForensicFinding__c>(findings);
        // Already sorted by GapUsd__c DESC in the main query; reuse that
        // order rather than re-sorting by (gap × recoverability) which
        // would require a custom Comparator for one-off use.
        n.prioritySequence = new List<PriorityItem>();
        Integer prioMax = Math.min(5, ranked.size());
        for (Integer i = 0; i < prioMax; i++) {
            ForensicFinding__c f = ranked[i];
            PriorityItem p = new PriorityItem();
            p.rank = i + 1;
            p.label = f.Title__c == null ? f.DetectorId__c : f.Title__c;
            p.detail = (f.DetectorId__c == null ? '' : f.DetectorId__c)
                + (f.Severity__c == null ? '' : ' · ' + f.Severity__c);
            p.amountFmt = money(f.GapUsd__c);
            n.prioritySequence.add(p);
        }

        return n;
    }

    /**
     * Phase 22g — Parses the persisted Phase 22e JSON map of
     * category → score into a sorted (worst-first) display list.
     * Returns empty list if JSON is null/blank/malformed so the PDF
     * still renders cleanly for legacy scans without the field.
     */
    @TestVisible
    private static List<CategoryEntry> parseCategoryScores(String payload) {
        List<CategoryEntry> out = new List<CategoryEntry>();
        if (String.isBlank(payload)) return out;
        Map<String, Object> raw;
        try {
            raw = (Map<String, Object>) JSON.deserializeUntyped(payload);
        } catch (Exception e) {
            return out;
        }
        for (String k : raw.keySet()) {
            Object v = raw.get(k);
            if (v == null) continue;
            Integer score;
            try {
                score = ((Decimal) v).intValue();
            } catch (Exception e) {
                continue;
            }
            CategoryEntry e2 = new CategoryEntry();
            e2.key = k;
            e2.label = friendlyCategoryLabel(k);
            e2.score = score;
            e2.tone = score < 50 ? 'bad' : (score < 80 ? 'warn' : 'good');
            out.add(e2);
        }
        // Insertion sort ascending by score (worst first) — small list.
        for (Integer i = 1; i < out.size(); i++) {
            CategoryEntry key = out[i];
            Integer j = i - 1;
            while (j >= 0 && out[j].score > key.score) {
                out[j + 1] = out[j];
                j--;
            }
            out[j + 1] = key;
        }
        return out;
    }

    /** Maps a category key (e.g. "revenue_leakage") to a Title Case label. */
    @TestVisible
    private static String friendlyCategoryLabel(String key) {
        if (String.isBlank(key)) return 'Uncategorized';
        if (key == '__uncategorized__') return 'Uncategorized';
        // Replace underscores with spaces and Title-Case each word.
        String[] words = key.replace('_', ' ').split(' ');
        String out = '';
        for (Integer i = 0; i < words.size(); i++) {
            String w = words[i];
            if (String.isBlank(w)) continue;
            if (out.length() > 0) out += ' ';
            out += w.substring(0, 1).toUpperCase() + (w.length() > 1 ? w.substring(1) : '');
        }
        return out;
    }

    /** Per-class operational guidance — what to do when this class dominates. */
    private static String classRecommendation(String cls) {
        if (cls == 'A') return 'Recommend prioritizing system-integration fixes — workflows or field mappings between CPQ, Billing, and Order Management that are silently failing.';
        if (cls == 'B') return 'Recommend tightening approval rules around manual price overrides and auditing rep activity on edited Quote Lines.';
        if (cls == 'C') return 'Recommend a Price Rule + Flow audit — automation is overriding the calculated price path and the conditions need re-scoping.';
        if (cls == 'D') return 'Recommend adding validation rules and approval routing — guardrails that should be blocking these scenarios are missing.';
        if (cls == 'E') return 'Recommend a data-quality sweep on the affected configuration records — values are missing or inconsistent on records that downstream automation depends on.';
        return '';
    }

    @TestVisible
    private static String money(Decimal d) {
        if (d == null || d == 0) return '$0';
        Decimal abs1 = d.abs();
        String body = (abs1 == abs1.setScale(0))
            ? formatCommas(abs1.setScale(0))
            : formatCommas(abs1.setScale(2));
        return (d < 0 ? '-$' : '$') + body;
    }

    private static String formatCommas(Decimal d) {
        String raw = d.toPlainString();
        Boolean hasFrac = raw.contains('.');
        String intPart = hasFrac ? raw.substringBefore('.') : raw;
        String fracPart = hasFrac ? raw.substringAfter('.') : '';
        String body = '';
        Integer n = intPart.length();
        for (Integer i = 0; i < n; i++) {
            if (i > 0 && Math.mod(n - i, 3) == 0) body += ',';
            body += intPart.substring(i, i + 1);
        }
        return hasFrac ? body + '.' + fracPart : body;
    }

    /** Join up to 3 labels with comma + "and": "renewals, pricing, and Q→O variance." */
    private static String joinLowercase(List<String> labels) {
        if (labels == null || labels.isEmpty()) return '';
        if (labels.size() == 1) return labels[0];
        if (labels.size() == 2) return labels[0] + ' and ' + labels[1];
        String out = '';
        for (Integer i = 0; i < labels.size() - 1; i++) {
            out += labels[i] + ', ';
        }
        return out + 'and ' + labels[labels.size() - 1];
    }
}
