/**
 * Class B — Manual Override.
 *
 * Fires when a rep edited a price field, bypassing configured pricing
 * logic. Canonical Salesforce signal: SBQQ__PricingMethod__c='Manual'
 * on the affected line. The Vercel-era TS detectors read that signal
 * directly; the Apex REN-002 detector doesn't pull it today, so this
 * tracer emits IMPLIED_OVERRIDE_BELOW_LIST (conf 0.6) — honest about
 * the lower certainty until the detector starts pulling the field.
 *
 * Routes (v1):
 *   - REN-002 → IMPLIED_OVERRIDE_BELOW_LIST, conf 0.6
 *               (escalates to MANUAL_OVERRIDE_BELOW_LIST conf 1.0
 *                when metadata.pricingMethod = 'Manual')
 */
public class ClassBTracer implements IAttributionTracer {

    public String getRootCauseClass() { return 'B'; }

    public List<AttributionCandidate> trace(
        ForensicFinding__c f,
        Map<String, Object> meta,
        DetectorContext ctx
    ) {
        if (f.DetectorId__c != 'REN-002') return new List<AttributionCandidate>();

        String pricingMethod = (String) meta.get('pricingMethod');
        Boolean explicitManual = pricingMethod == 'Manual';

        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'B';
        c.rootConfigType = 'SBQQ__QuoteLine__c';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = f.Title__c;
        c.reasonCode  = explicitManual
            ? 'MANUAL_OVERRIDE_BELOW_LIST'
            : 'IMPLIED_OVERRIDE_BELOW_LIST';
        c.confidence  = explicitManual ? 1.0 : 0.6;
        c.evidence.put('quote_line_id', f.PrimaryRecordId__c);
        c.evidence.put('pricing_method', pricingMethod);
        c.evidence.put('current_list_price', meta.get('currentListPrice'));
        c.evidence.put('renewal_net_price', meta.get('renewalNetPrice'));
        c.evidence.put('percent_below_list', meta.get('percentBelowList'));
        c.evidence.put('governance_gap', explicitManual
            ? 'SBQQ__PricingMethod__c = Manual — rep overrode the calculated price, ' +
              'and no approval rule flagged the divergence from current list.'
            : 'Renewal price differs from current list but PricingMethod was not ' +
              'captured by the detector. Either an unrecorded manual edit, or a ' +
              'missing pricing automation. Verify on the Quote Line directly.');
        return new List<AttributionCandidate>{ c };
    }
}
