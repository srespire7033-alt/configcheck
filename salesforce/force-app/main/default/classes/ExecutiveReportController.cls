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

    public class DetectorBucket {
        public String detectorId { get; set; }
        public String label { get; set; }
        public Integer count { get; set; }
        public Decimal totalUsd { get; set; }
        public List<ForensicFinding__c> findings { get; set; }
    }
    public List<DetectorBucket> detectorGroups { get; private set; }

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

        // Resolve scan: URL param scanId, else latest completed.
        String scanIdParam = ApexPages.currentPage() != null
            ? ApexPages.currentPage().getParameters().get('scanId') : null;
        if (String.isNotBlank(scanIdParam)) {
            List<ForensicScan__c> direct = [
                SELECT Id, Name, Status__c, ProductType__c, StartedAt__c,
                       CompletedAt__c, TotalLeakageUsd__c, FindingCount__c,
                       CurrencyIsoCode
                FROM ForensicScan__c WHERE Id = :scanIdParam LIMIT 1
            ];
            if (!direct.isEmpty()) scan = direct[0];
        }
        if (scan == null) {
            List<ForensicScan__c> latest = [
                SELECT Id, Name, Status__c, ProductType__c, StartedAt__c,
                       CompletedAt__c, TotalLeakageUsd__c, FindingCount__c,
                       CurrencyIsoCode
                FROM ForensicScan__c
                WHERE Status__c IN ('Completed', 'Partial')
                ORDER BY StartedAt__c DESC LIMIT 1
            ];
            if (!latest.isEmpty()) scan = latest[0];
        }
        if (scan == null) return;

        // Top 20 findings by gap for the detail table.
        findings = [
            SELECT Id, DetectorId__c, Title__c, Description__c, Severity__c,
                   GapUsd__c, EntitledUsd__c, RealizedUsd__c,
                   RecoverabilityScore__c, CurrencyIsoCode
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scan.Id
              AND HiddenAt__c = null
              AND GapUsd__c != null
            ORDER BY GapUsd__c DESC
            LIMIT 20
        ];

        // Severity counts from ALL unhidden findings (not just top 20).
        AggregateResult[] sevAgg = [
            SELECT Severity__c sev, COUNT(Id) cnt
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scan.Id AND HiddenAt__c = null
            GROUP BY Severity__c
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
    }
}
