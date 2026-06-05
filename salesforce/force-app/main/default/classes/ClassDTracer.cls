/**
 * Class D — Missing Governance.
 *
 * Fires when a guardrail that should exist on the config is absent
 * (no end date, no validation rule, no approval). Apex routes:
 *   - DSC-FOR-001 (expired promo still applied):
 *       DISCOUNT_SCHEDULE_PAST_END_DATE, conf 0.85
 *       Root config is the SBQQ__DiscountSchedule__c (we surface its
 *       name from metadata.scheduleName; Apex detector doesn't pull
 *       the schedule Id today so root_config_id stays null).
 *   - AMD-FOR-001 (amendment with no effective date):
 *       AMENDMENT_NO_EFFECTIVE_DATE, conf 1.0 (smoking gun — the
 *       required field is literally missing).
 *   - OPP-FOR-001 (closed-won, no Quote):
 *       OPPORTUNITY_NO_QUOTE_GOVERNANCE, conf 0.85
 *   - CON-FOR-001 (contract activated, all subs expired):
 *       CONTRACT_RENEWAL_GOVERNANCE_GAP, conf 0.8
 *   - QL-FOR-002 (quote line approval skipped):
 *       APPROVAL_PROCESS_NOT_BLOCKING, conf 0.9
 */
public class ClassDTracer implements IAttributionTracer {

    public String getRootCauseClass() { return 'D'; }

    public List<AttributionCandidate> trace(
        ForensicFinding__c f,
        Map<String, Object> meta,
        DetectorContext ctx
    ) {
        String did = f.DetectorId__c;
        if (did == 'DSC-FOR-001') return traceExpiredPromo(f, meta);
        if (did == 'AMD-FOR-001') return traceAmendmentNoEffectiveDate(f, meta);
        if (did == 'OPP-FOR-001') return traceClosedWonNoQuote(f, meta);
        if (did == 'CON-FOR-001') return traceContractAllSubsExpired(f, meta);
        if (did == 'QL-FOR-002') return traceApprovalSkipped(f, meta);
        return new List<AttributionCandidate>();
    }

    private List<AttributionCandidate> traceExpiredPromo(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        String scheduleName = (String) meta.get('scheduleName');
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'D';
        c.rootConfigType = 'SBQQ__DiscountSchedule__c';
        c.rootConfigId   = null; // Apex detector doesn't capture schedule Id today.
        c.rootConfigName = scheduleName;
        c.reasonCode  = 'DISCOUNT_SCHEDULE_PAST_END_DATE';
        c.confidence  = 0.85;
        c.evidence.put('schedule_name', scheduleName);
        c.evidence.put('schedule_end_date', meta.get('scheduleEndDate'));
        c.evidence.put('affected_quote_line_id', f.PrimaryRecordId__c);
        c.evidence.put('governance_gap',
            'Discount Schedule has an EndDate in the past but is still being applied. ' +
            'No validation rule, approval process, or activation guard prevents the ' +
            'discount from continuing past expiration.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceAmendmentNoEffectiveDate(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'D';
        c.rootConfigType = 'SBQQ__Quote__c';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = f.Title__c;
        c.reasonCode  = 'AMENDMENT_NO_EFFECTIVE_DATE';
        c.confidence  = 1.0;
        c.evidence.put('quote_id', f.PrimaryRecordId__c);
        c.evidence.put('status', meta.get('status'));
        c.evidence.put('end_date', meta.get('endDate'));
        c.evidence.put('governance_gap',
            'Amendment Quote was activated without SBQQ__StartDate__c populated. ' +
            'No validation rule prevented the activation; downstream proration math ' +
            'has no anchor to compute against.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceClosedWonNoQuote(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'D';
        c.rootConfigType = 'Opportunity';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = f.Title__c;
        c.reasonCode  = 'OPPORTUNITY_NO_QUOTE_GOVERNANCE';
        c.confidence  = 0.85;
        c.evidence.put('opportunity_id', f.PrimaryRecordId__c);
        c.evidence.put('close_date', meta.get('closeDate'));
        c.evidence.put('days_since_close', meta.get('daysSinceClose'));
        c.evidence.put('governance_gap',
            'Opportunity moved to Closed-Won without any CPQ Quote attached. No ' +
            'validation rule on Opportunity stage requires a Primary Quote — the ' +
            'configured-pricing pipeline was bypassed entirely.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceContractAllSubsExpired(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'D';
        c.rootConfigType = 'Contract';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = f.Title__c;
        c.reasonCode  = 'CONTRACT_RENEWAL_GOVERNANCE_GAP';
        c.confidence  = 0.8;
        c.evidence.put('contract_id', f.PrimaryRecordId__c);
        c.evidence.put('flag_reason', meta.get('flagReason'));
        c.evidence.put('subscription_count', meta.get('subscriptionCount'));
        c.evidence.put('latest_subscription_end', meta.get('latestSubscriptionEnd'));
        c.evidence.put('governance_gap',
            'Contract is Activated but all subscriptions have expired and no renewal ' +
            'process fired. No scheduled job, Flow, or Approval routes the contract ' +
            'to a renewal owner — quiet churn.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceApprovalSkipped(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'D';
        c.rootConfigType = 'SBQQ__QuoteLine__c';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = f.Title__c;
        c.reasonCode  = 'APPROVAL_PROCESS_NOT_BLOCKING';
        c.confidence  = 0.9;
        c.evidence.put('quote_line_id', f.PrimaryRecordId__c);
        c.evidence.put('discount_pct', meta.get('discountPct'));
        c.evidence.put('threshold_pct', meta.get('thresholdPct'));
        c.evidence.put('governance_gap',
            'Quote line was approved at a discount above the configured threshold ' +
            'without a matching Approval Rule firing. Either the Approval Rule is ' +
            'inactive, its conditions don\'t match this scenario, or it was bypassed.');
        return new List<AttributionCandidate>{ c };
    }
}
