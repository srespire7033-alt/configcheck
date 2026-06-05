/**
 * Class A — Process & System Disconnect.
 *
 * Fires on findings where one system is internally correct but the
 * bridge between systems has dropped data. Apex v1 routes:
 *   - ORD-FOR-001 (Order activated, no billing schedule) →
 *       ACTIVATION_WORKFLOW_NOT_TRIGGERING, conf 0.7
 *   - ORD-FOR-002 (Quote ↔ Order variance new business) →
 *       QUOTE_ORDER_TOTAL_VARIANCE, conf 0.85
 *   - ORD-FOR-003 (Amendment variance) →
 *       AMENDMENT_DELTA_MISMATCH, conf 0.85
 *
 * The Vercel-era TS tracer split confidence on a manual-edit signal
 * (`manually_edited=true`) and a data-quality signal
 * (`existing_flag_suspect_line_ids`). The Apex detectors don't emit
 * those signals today, so Class A claims at its base confidence and
 * lets Classes B/E surface independently if-and-when those detectors
 * start emitting the signals.
 */
public class ClassATracer implements IAttributionTracer {

    public String getRootCauseClass() { return 'A'; }

    public List<AttributionCandidate> trace(
        ForensicFinding__c finding,
        Map<String, Object> metadata,
        DetectorContext ctx
    ) {
        String did = finding.DetectorId__c;
        if (did == 'ORD-FOR-001') return traceOrderNoBilling(finding, metadata);
        if (did == 'ORD-FOR-002') return traceQuoteOrderVariance(finding, metadata);
        if (did == 'ORD-FOR-003') return traceAmendmentVariance(finding, metadata);
        return new List<AttributionCandidate>();
    }

    private List<AttributionCandidate> traceOrderNoBilling(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'A';
        c.rootConfigType = 'Order';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = (String) meta.get('orderNumber');
        if (c.rootConfigName == null) c.rootConfigName = f.Title__c;
        c.reasonCode  = 'ACTIVATION_WORKFLOW_NOT_TRIGGERING';
        c.confidence  = 0.7;
        c.evidence.put('order_id', f.PrimaryRecordId__c);
        c.evidence.put('order_number', meta.get('orderNumber'));
        c.evidence.put('days_since_activation', meta.get('daysSinceActivation'));
        c.evidence.put('item_count', meta.get('itemCount'));
        c.evidence.put('system_disconnect',
            'OrderItems exist but no billing schedules were generated. The Order ' +
            'Activation workflow/trigger that should generate schedules either is not ' +
            'active, has a process error, or was never installed. Inspect Setup → ' +
            'Process Builder / Flow / Apex Triggers on Order.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceQuoteOrderVariance(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'A';
        c.rootConfigType = 'SBQQ__Quote__c';
        // ORD-FOR-002 primary record IS the quote; reuse the lookup directly.
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = f.Title__c;
        c.reasonCode  = 'QUOTE_ORDER_TOTAL_VARIANCE';
        c.confidence  = 0.85;
        c.evidence.put('quote_id', f.PrimaryRecordId__c);
        c.evidence.put('quote_net_amount', meta.get('quoteNetAmount'));
        c.evidence.put('order_total', meta.get('orderTotal'));
        c.evidence.put('variance_amount', meta.get('delta'));
        c.evidence.put('direction', meta.get('direction'));
        c.evidence.put('order_ids', meta.get('orderIds'));
        c.evidence.put('system_disconnect',
            'Quote was approved at one Net Amount but the activated Order(s) totalled ' +
            'a different number. The Q→O conversion either dropped a line, applied a ' +
            'different Pricebook, or a Flow/Apex on Order rewrote pricing fields. ' +
            'Inspect the Q→O field mapping and any Order triggers/Flows.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceAmendmentVariance(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'A';
        c.rootConfigType = 'SBQQ__Quote__c';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = f.Title__c;
        c.reasonCode  = 'AMENDMENT_DELTA_MISMATCH';
        c.confidence  = 0.85;
        c.evidence.put('quote_id', f.PrimaryRecordId__c);
        c.evidence.put('expected_delta', meta.get('quoteNetAmount'));
        c.evidence.put('order_total_sum', meta.get('orderTotal'));
        c.evidence.put('variance_amount', meta.get('delta'));
        c.evidence.put('direction', meta.get('direction'));
        c.evidence.put('order_ids', meta.get('orderIds'));
        c.evidence.put('system_disconnect',
            'Amendment Quote was activated and the resulting Order(s) do not sum to ' +
            'the expected delta. The amendment Q→O conversion either dropped a new ' +
            'line, applied stale pricing, or a Flow/Apex on Order rewrote pricing ' +
            'fields. Inspect the amendment Q→O field mapping.');
        return new List<AttributionCandidate>{ c };
    }
}
