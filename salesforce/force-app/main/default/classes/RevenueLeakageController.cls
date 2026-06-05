/**
 * RevenueLeakageController — backs the Revenue Leakage view.
 *
 * Returns:
 *   header        — title, subtitle, confidence chip (Low/Medium/High)
 *   totals        — verifiedUsd, estimatedUsd, totalUsd, opportunityBaselineUsd, percentOfRevenue
 *   themes        — 6 buckets (Renewals / Discounting / Orders & Billing /
 *                    Subscriptions / Pricing Locks / Other) each with detector list,
 *                    count, totalUsd, top-3 findings
 *   biggestLeaks  — top 5 findings org-wide by GapUsd__c
 *
 * Confidence: ≥50 findings → 'high'; ≥10 → 'medium'; else 'low'.
 * Opportunity baseline: SUM(Opportunity.Amount) WHERE IsClosed=true within last 365 days.
 */
public with sharing class RevenueLeakageController {

    public class LeakageDto {
        @AuraEnabled public Decimal totalVerifiedUsd;
        @AuraEnabled public Decimal estimatedUsd; // not computed in v1 — placeholder 0
        @AuraEnabled public Decimal totalUsd;
        @AuraEnabled public Decimal opportunityBaselineUsd;
        @AuraEnabled public Decimal percentOfRevenue;
        @AuraEnabled public String confidence; // 'low' | 'medium' | 'high'
        @AuraEnabled public Integer findingCount;
        @AuraEnabled public List<Theme> themes;
        @AuraEnabled public List<LeakRow> biggestLeaks;
    }

    public class Theme {
        @AuraEnabled public String key;
        @AuraEnabled public String label;
        @AuraEnabled public String description;
        @AuraEnabled public String iconName;
        @AuraEnabled public String accent;        // 'blue' | 'amber' | 'indigo' | 'emerald' | 'slate' | 'gray'
        @AuraEnabled public List<String> detectorIds;
        @AuraEnabled public Integer count;
        @AuraEnabled public Decimal totalUsd;
        @AuraEnabled public List<LeakRow> topThree;
        @AuraEnabled public Integer moreCount;    // count - topThree.size()
    }

    public class LeakRow {
        @AuraEnabled public Id id;
        @AuraEnabled public String detectorId;
        @AuraEnabled public String title;
        @AuraEnabled public String description;
        @AuraEnabled public String severity;
        @AuraEnabled public Decimal gapUsd;
        @AuraEnabled public String effort; // 'low' | 'medium' | 'high'
    }

    // ─── Estimated impact formula ───────────────────────────────────────
    //
    // For detectors where GapUsd__c is 0 or null (pipeline / governance
    // findings — no transactional $ on record yet), apply a forward-
    // looking heuristic:
    //
    //   estimated = affected_count × median_deal × leak_rate × ltv_multiplier
    //
    // Mirrors src/lib/analysis/revenue-leakage.ts. SaaS default industry
    // is 'saas' → LTV multiplier 4. Per-detector leak_rate tuned to the
    // type of leakage:
    //   REN-003/004 (renewal pipeline): 0.10 / 0.15  — likely renewal loss
    //   OPP/CON/AMD (governance):        0.05         — small process slippage
    //   PROV-FOR-002 (asset gap):        0.10         — billing miss
    //   Anything else with no gap:        0.02         — conservative default
    //
    // Total estimated cap = 100% of annual revenue. Per-detector cap = 25%.
    private static final Decimal LTV_MULTIPLIER  = 4;     // SaaS default
    private static final Decimal PER_DETECTOR_CAP_PCT = 0.25;
    private static final Decimal TOTAL_CAP_PCT        = 1.0;

    private static final Map<String, Decimal> DETECTOR_LEAK_RATE = new Map<String, Decimal>{
        'REN-003'      => 0.10,
        'REN-004'      => 0.15,
        'OPP-FOR-001'  => 0.05,
        'CON-FOR-001'  => 0.05,
        'AMD-FOR-001'  => 0.05,
        'PROV-FOR-002' => 0.10,
        'QL-FOR-002'   => 0.03
    };

    // Per-detector effort mapping (mirrors src/lib/forensics/types.ts)
    private static final Map<String, String> DETECTOR_EFFORT = new Map<String, String>{
        'REN-001'     => 'medium', 'REN-002' => 'medium', 'REN-003' => 'low', 'REN-004' => 'low',
        'DSC-FOR-001' => 'medium', 'DSC-FOR-002' => 'medium',
        'QL-FOR-001'  => 'medium', 'QL-FOR-002' => 'low',
        'ORD-FOR-001' => 'high',   'ORD-FOR-002' => 'medium', 'ORD-FOR-003' => 'medium',
        'SUB-FOR-001' => 'medium', 'PROV-FOR-001' => 'high',  'PROV-FOR-002' => 'medium',
        'OPP-FOR-001' => 'low',    'CON-FOR-001' => 'low',    'AMD-FOR-001' => 'low',
        'AST-FOR-001' => 'high',   'CT-FOR-001'  => 'medium', 'MDQ-FOR-001' => 'high'
    };

    // 6-bucket definition — verbatim from src/components/scan/revenue-leakage-card.tsx
    private static final List<List<Object>> THEME_DEFS = new List<List<Object>>{
        new List<Object>{ 'renewals',    'Renewals',        'Uplift suppressed, renewal below current list.',
                          'utility:refresh',  'blue',
                          new List<String>{ 'REN-001', 'REN-002' } },
        new List<Object>{ 'orders',      'Orders & Billing','Q→O variance, activated orders with no billing schedule, terminated assets still billing.',
                          'utility:list',     'indigo',
                          new List<String>{ 'ORD-FOR-001', 'ORD-FOR-002', 'ORD-FOR-003', 'AST-FOR-001' } },
        new List<Object>{ 'discounting', 'Discounting',     'Discounts kept past their date, options given away free, caps exceeded.',
                          'utility:money',    'amber',
                          new List<String>{ 'DSC-FOR-001', 'DSC-FOR-002', 'QL-FOR-001' } },
        new List<Object>{ 'subs',        'Subscriptions',   'Subscription quantity vs Asset drift, provisioning gaps.',
                          'utility:layers',   'emerald',
                          new List<String>{ 'SUB-FOR-001', 'PROV-FOR-001', 'PROV-FOR-002' } },
        new List<Object>{ 'pricing',     'Pricing Locks',   'Expired contracted prices, multi-year flat segments.',
                          'utility:lock',     'slate',
                          new List<String>{ 'CT-FOR-001', 'MDQ-FOR-001' } }
    };

    /** Phase 22w — connectedOrgId param scopes leakage rollup to the
     *  active Connected Org instead of "latest scan globally." */
    @AuraEnabled(cacheable=true)
    public static LeakageDto getLeakage(Id connectedOrgId) {
        LeakageDto dto = new LeakageDto();
        dto.totalVerifiedUsd = 0;
        dto.estimatedUsd = 0;
        dto.totalUsd = 0;
        dto.opportunityBaselineUsd = 0;
        dto.percentOfRevenue = 0;
        dto.confidence = 'low';
        dto.findingCount = 0;
        dto.themes = new List<Theme>();
        dto.biggestLeaks = new List<LeakRow>();

        List<ForensicScan__c> scans;
        if (connectedOrgId != null) {
            scans = [
                SELECT Id FROM ForensicScan__c
                WHERE Status__c IN ('Completed','Partial')
                  AND ConnectedOrg__c = :connectedOrgId
                WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST LIMIT 1
            ];
        } else {
            scans = [
                SELECT Id FROM ForensicScan__c
                WHERE Status__c IN ('Completed','Partial')
                WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST LIMIT 1
            ];
        }
        if (scans.isEmpty()) return dto;
        Id scanId = scans[0].Id;

        // Pull all non-hidden findings once.
        List<ForensicFinding__c> all = [
            SELECT Id, DetectorId__c, Title__c, Description__c, Severity__c,
                   GapUsd__c, Status__c
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId AND HiddenAt__c = null
            WITH SECURITY_ENFORCED ORDER BY GapUsd__c DESC NULLS LAST
        ];

        // Bucket by detector and accumulate totals/counts.
        Map<String, List<ForensicFinding__c>> byDetector = new Map<String, List<ForensicFinding__c>>();
        for (ForensicFinding__c f : all) {
            String d = f.DetectorId__c == null ? '' : f.DetectorId__c;
            if (!byDetector.containsKey(d)) byDetector.put(d, new List<ForensicFinding__c>());
            byDetector.get(d).add(f);
            dto.totalVerifiedUsd += (f.GapUsd__c == null ? 0 : f.GapUsd__c);
            dto.findingCount += 1;
        }

        Set<String> usedDetectors = new Set<String>();
        for (List<Object> def : THEME_DEFS) {
            Theme t = buildTheme(def, byDetector, usedDetectors);
            dto.themes.add(t);
        }
        // "Other" bucket — any detector that hit findings but isn't in the 5 named themes.
        Theme other = buildOtherTheme(byDetector, usedDetectors);
        if (other.count > 0) dto.themes.add(other);

        // Biggest leaks (top 5 across all detectors, by gap desc — already sorted by SOQL)
        Integer biggestLimit = Math.min(5, all.size());
        for (Integer i = 0; i < biggestLimit; i++) {
            dto.biggestLeaks.add(rowOf(all[i]));
        }

        // Opportunity baseline + median deal size
        dto.opportunityBaselineUsd = opportunityBaseline();
        Decimal medianDeal = medianClosedWonAmount();

        // Apply estimated heuristic: for findings with 0/null gap whose
        // detector has a leak_rate, estimated_per_finding = median × rate × LTV
        Map<String, Integer> noGapCountByDetector = new Map<String, Integer>();
        for (ForensicFinding__c f : all) {
            Decimal g = f.GapUsd__c == null ? 0 : f.GapUsd__c;
            if (g > 0) continue;
            String d = f.DetectorId__c == null ? '' : f.DetectorId__c;
            if (!DETECTOR_LEAK_RATE.containsKey(d)) continue;
            noGapCountByDetector.put(d, (noGapCountByDetector.get(d) == null ? 0 : noGapCountByDetector.get(d)) + 1);
        }
        Decimal estimated = 0;
        Decimal perDetectorCap = (dto.opportunityBaselineUsd > 0)
            ? dto.opportunityBaselineUsd * PER_DETECTOR_CAP_PCT
            : null;
        for (String det : noGapCountByDetector.keySet()) {
            Integer cnt = noGapCountByDetector.get(det);
            Decimal rate = DETECTOR_LEAK_RATE.get(det);
            Decimal perDetector = Decimal.valueOf(cnt) * medianDeal * rate * LTV_MULTIPLIER;
            if (perDetectorCap != null && perDetector > perDetectorCap) perDetector = perDetectorCap;
            estimated += perDetector;
        }
        // Total cap = 100% of annual revenue
        if (dto.opportunityBaselineUsd > 0 && estimated > dto.opportunityBaselineUsd * TOTAL_CAP_PCT) {
            estimated = dto.opportunityBaselineUsd * TOTAL_CAP_PCT;
        }
        dto.estimatedUsd = estimated.setScale(0, System.RoundingMode.HALF_UP);
        dto.totalUsd = dto.totalVerifiedUsd + dto.estimatedUsd;
        dto.percentOfRevenue = (dto.opportunityBaselineUsd > 0)
            ? ((dto.totalUsd / dto.opportunityBaselineUsd) * 100).setScale(1, System.RoundingMode.HALF_UP)
            : 0;

        // Confidence
        if (dto.findingCount >= 50)       dto.confidence = 'high';
        else if (dto.findingCount >= 10)  dto.confidence = 'medium';
        else                              dto.confidence = 'low';
        return dto;
    }

    // ────────── helpers ──────────

    private static Theme buildTheme(List<Object> def, Map<String, List<ForensicFinding__c>> byDetector, Set<String> usedDetectors) {
        Theme t = new Theme();
        t.key = (String) def[0];
        t.label = (String) def[1];
        t.description = (String) def[2];
        t.iconName = (String) def[3];
        t.accent = (String) def[4];
        t.detectorIds = (List<String>) def[5];
        t.count = 0;
        t.totalUsd = 0;
        t.topThree = new List<LeakRow>();

        // Collect all findings for this theme's detectors
        List<ForensicFinding__c> findings = new List<ForensicFinding__c>();
        for (String d : t.detectorIds) {
            usedDetectors.add(d);
            if (byDetector.containsKey(d)) findings.addAll(byDetector.get(d));
        }
        // Findings inside a single detector list are already gap-desc sorted; merge-sort by re-sorting
        findings.sort(new FindingGapComparator());

        for (ForensicFinding__c f : findings) {
            t.count += 1;
            t.totalUsd += (f.GapUsd__c == null ? 0 : f.GapUsd__c);
            if (t.topThree.size() < 3) t.topThree.add(rowOf(f));
        }
        t.moreCount = Math.max(0, t.count - t.topThree.size());
        return t;
    }

    private static Theme buildOtherTheme(Map<String, List<ForensicFinding__c>> byDetector, Set<String> usedDetectors) {
        Theme t = new Theme();
        t.key = 'other';
        t.label = 'Other';
        t.description = 'Findings that don’t fit the named buckets.';
        t.iconName = 'utility:moreactions';
        t.accent = 'gray';
        t.detectorIds = new List<String>();
        t.count = 0;
        t.totalUsd = 0;
        t.topThree = new List<LeakRow>();

        List<ForensicFinding__c> findings = new List<ForensicFinding__c>();
        for (String d : byDetector.keySet()) {
            if (usedDetectors.contains(d)) continue;
            t.detectorIds.add(d);
            findings.addAll(byDetector.get(d));
        }
        findings.sort(new FindingGapComparator());
        for (ForensicFinding__c f : findings) {
            t.count += 1;
            t.totalUsd += (f.GapUsd__c == null ? 0 : f.GapUsd__c);
            if (t.topThree.size() < 3) t.topThree.add(rowOf(f));
        }
        t.moreCount = Math.max(0, t.count - t.topThree.size());
        return t;
    }

    private static LeakRow rowOf(ForensicFinding__c f) {
        LeakRow r = new LeakRow();
        r.id = f.Id;
        r.detectorId = f.DetectorId__c;
        r.title = f.Title__c;
        r.description = f.Description__c;
        r.severity = f.Severity__c;
        r.gapUsd = f.GapUsd__c == null ? 0 : f.GapUsd__c;
        r.effort = DETECTOR_EFFORT.containsKey(f.DetectorId__c) ? DETECTOR_EFFORT.get(f.DetectorId__c) : 'medium';
        return r;
    }

    /** Median of closed-won Opportunity.Amount within the last 365 days.
     *  Apex has no built-in median, so we pull values + index midpoint. */
    private static Decimal medianClosedWonAmount() {
        try {
            Datetime since = System.now().addDays(-365);
            List<Decimal> amounts = new List<Decimal>();
            for (Opportunity o : [
                SELECT Amount FROM Opportunity
                WHERE IsWon = true AND CloseDate >= :since.date() AND Amount > 0
                WITH SECURITY_ENFORCED ORDER BY Amount ASC LIMIT 5000
            ]) {
                amounts.add(o.Amount);
            }
            if (amounts.isEmpty()) return 10000; // SYSTEM_DEFAULT median_deal_size
            Integer mid = amounts.size() / 2;
            return amounts.size() == 1 ? amounts[0] : amounts[mid];
        } catch (Exception e) {
            return 10000;
        }
    }

    /** SUM(Opportunity.Amount) for closed-won Opps in the last 365 days. */
    private static Decimal opportunityBaseline() {
        try {
            Datetime since = System.now().addDays(-365);
            AggregateResult ar = [
                SELECT SUM(Amount) total
                FROM Opportunity
                WHERE IsWon = true AND CloseDate >= :since.date() WITH SECURITY_ENFORCED ];
            Decimal v = (Decimal) ar.get('total');
            return v == null ? 0 : v;
        } catch (Exception e) {
            return 0;
        }
    }

    public class FindingGapComparator implements Comparator<ForensicFinding__c> {
        public Integer compare(ForensicFinding__c a, ForensicFinding__c b) {
            Decimal ag = a.GapUsd__c == null ? 0 : a.GapUsd__c;
            Decimal bg = b.GapUsd__c == null ? 0 : b.GapUsd__c;
            if (bg > ag) return 1;
            if (bg < ag) return -1;
            return 0;
        }
    }
}
