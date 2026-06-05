/**
 * RemediationPlanController — produces a deterministic 3-phase fix plan
 * for the latest forensic scan.
 *
 * Phases bucketed by detector effort:
 *   Phase 1 (Highest ROI)         — effort = low,    <4 hours each
 *   Phase 2 (Core Fixes)          — effort = medium, 4-12 hours each
 *   Phase 3 (Strategic Initiatives) — effort = high,    multi-day
 *
 * Per detector inside a phase: code, prose fix, total est. time, $ recovered.
 * Per phase: title, blurb, total $ recovered.
 *
 * No LLM dependency. Future: wire to a Named Credential + HTTP callout
 * and replace this controller's body with the model's response. Same DTO
 * shape so the LWC doesn't change.
 */
public with sharing class RemediationPlanController {

    public class PlanDto {
        @AuraEnabled public Integer currentScore;
        @AuraEnabled public Decimal totalAnnualLeakage;
        @AuraEnabled public List<Phase> phases;
        @AuraEnabled public Datetime generatedAt;
    }

    public class Phase {
        @AuraEnabled public Integer phaseNum;
        @AuraEnabled public String title;
        @AuraEnabled public String blurb;
        @AuraEnabled public String timeRange; // 'Estimated Time < 4 hours each' / etc.
        @AuraEnabled public Decimal totalRecovered;
        @AuraEnabled public List<Step> steps;
    }

    public class Step {
        @AuraEnabled public Integer ordinal;
        @AuraEnabled public String detectorId;
        @AuraEnabled public String recommendation;
        @AuraEnabled public Decimal estHours;
        @AuraEnabled public Decimal recoveredUsd;
        @AuraEnabled public Integer findingCount;
    }

    private static final Map<String, String> DETECTOR_EFFORT = new Map<String, String>{
        'REN-001' => 'medium', 'REN-002' => 'medium', 'REN-003' => 'low', 'REN-004' => 'low',
        'DSC-FOR-001' => 'medium', 'DSC-FOR-002' => 'medium',
        'QL-FOR-001' => 'medium', 'QL-FOR-002' => 'low',
        'ORD-FOR-001' => 'high', 'ORD-FOR-002' => 'medium', 'ORD-FOR-003' => 'medium',
        'SUB-FOR-001' => 'medium', 'PROV-FOR-001' => 'high', 'PROV-FOR-002' => 'medium',
        'OPP-FOR-001' => 'low', 'CON-FOR-001' => 'low', 'AMD-FOR-001' => 'low',
        'AST-FOR-001' => 'high', 'CT-FOR-001' => 'medium', 'MDQ-FOR-001' => 'high'
    };

    private static final Map<String, Decimal> EFFORT_HOURS = new Map<String, Decimal>{
        'low' => 0.5, 'medium' => 2, 'high' => 8
    };

    private static final Map<String, String> DETECTOR_FIX = new Map<String, String>{
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

    /**
     * Phase 22s — connectedOrgId param. When set, the plan picks the most
     * recent scan FOR THAT Connected Org instead of "most recent scan
     * globally." Without this, the ARM dashboard's hero showed 86 (from
     * the ARM scan) while the Remediation Plan card showed 62 (from
     * whatever the latest CPQ scan happened to be) — the two widgets
     * disagreed because they were looking at different scans. Null arg
     * preserves legacy "most-recent-anywhere" behavior for callers that
     * don't have a connected-org context.
     */
    @AuraEnabled(cacheable=true)
    public static PlanDto getPlan(Id connectedOrgId) {
        PlanDto dto = new PlanDto();
        dto.currentScore = 100;
        dto.totalAnnualLeakage = 0;
        dto.phases = new List<Phase>();
        dto.generatedAt = System.now();

        List<ForensicScan__c> scans;
        if (connectedOrgId != null) {
            scans = [
                SELECT Id, HealthScore__c FROM ForensicScan__c
                WHERE Status__c IN ('Completed','Partial')
                  AND ConnectedOrg__c = :connectedOrgId
                WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST LIMIT 1
            ];
        } else {
            scans = [
                SELECT Id, HealthScore__c FROM ForensicScan__c
                WHERE Status__c IN ('Completed','Partial')
                WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST LIMIT 1
            ];
        }
        if (scans.isEmpty()) return dto;
        Id scanId = scans[0].Id;
        dto.currentScore = scans[0].HealthScore__c == null ? 100 : Integer.valueOf(scans[0].HealthScore__c);

        // Aggregate findings by detector
        Map<String, Step> stepByDetector = new Map<String, Step>();
        for (AggregateResult ar : [
            SELECT DetectorId__c det, COUNT(Id) cnt, SUM(GapUsd__c) gap
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId AND HiddenAt__c = null
              AND Status__c IN ('Open','Acknowledged')
            WITH SECURITY_ENFORCED GROUP BY DetectorId__c
        ]) {
            String det = (String) ar.get('det');
            Integer cnt = (Integer) ar.get('cnt');
            Decimal gap = (Decimal) ar.get('gap');
            if (gap == null) gap = 0;
            Step s = new Step();
            s.detectorId = det;
            s.findingCount = cnt;
            s.recoveredUsd = gap;
            s.recommendation = DETECTOR_FIX.containsKey(det)
                ? DETECTOR_FIX.get(det)
                : 'Review affected records and apply the standard remediation for this detector.';
            String effort = DETECTOR_EFFORT.containsKey(det) ? DETECTOR_EFFORT.get(det) : 'medium';
            s.estHours = EFFORT_HOURS.get(effort) * cnt;
            stepByDetector.put(det, s);
            dto.totalAnnualLeakage += gap;
        }

        // Bucket into 3 phases by effort
        Phase p1 = buildPhase(1, 'Highest ROI', 'Quick wins that provide significant financial recovery and demonstrate immediate value.', 'Estimated Time < 4 hours each');
        Phase p2 = buildPhase(2, 'Core Fixes', 'Foundational corrections that prevent recurring leakage and tighten controls.', 'Estimated Time 4-12 hours each');
        Phase p3 = buildPhase(3, 'Strategic Initiatives', 'Larger transformations that touch accounting, integrations, or schema.', 'Multi-day engagements');

        for (Step s : stepByDetector.values()) {
            String e = DETECTOR_EFFORT.containsKey(s.detectorId) ? DETECTOR_EFFORT.get(s.detectorId) : 'medium';
            if (e == 'low')      p1.steps.add(s);
            else if (e == 'medium') p2.steps.add(s);
            else                 p3.steps.add(s);
        }

        // Sort each phase's steps by $ desc, assign ordinals, tally totals
        finalizePhase(p1);
        finalizePhase(p2);
        finalizePhase(p3);
        if (!p1.steps.isEmpty()) dto.phases.add(p1);
        if (!p2.steps.isEmpty()) dto.phases.add(p2);
        if (!p3.steps.isEmpty()) dto.phases.add(p3);
        return dto;
    }

    private static Phase buildPhase(Integer n, String title, String blurb, String timeRange) {
        Phase p = new Phase();
        p.phaseNum = n;
        p.title = title;
        p.blurb = blurb;
        p.timeRange = timeRange;
        p.totalRecovered = 0;
        p.steps = new List<Step>();
        return p;
    }

    private static void finalizePhase(Phase p) {
        p.steps.sort(new StepRecoveredComparator());
        for (Integer i = 0; i < p.steps.size(); i++) {
            p.steps[i].ordinal = i + 1;
            p.totalRecovered += (p.steps[i].recoveredUsd == null ? 0 : p.steps[i].recoveredUsd);
        }
    }

    public class StepRecoveredComparator implements Comparator<Step> {
        public Integer compare(Step a, Step b) {
            Decimal av = a.recoveredUsd == null ? 0 : a.recoveredUsd;
            Decimal bv = b.recoveredUsd == null ? 0 : b.recoveredUsd;
            if (bv > av) return 1;
            if (bv < av) return -1;
            return 0;
        }
    }
}
