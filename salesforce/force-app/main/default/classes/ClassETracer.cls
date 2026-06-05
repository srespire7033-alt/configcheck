/**
 * Class E — Poor Data Quality.
 *
 * Fires when leakage traces back to bad / missing values on the
 * config records themselves — distinct from Class D where the
 * guardrail is missing. Here the guardrail would have worked if the
 * upstream data had been populated.
 *
 * Apex routes (v1):
 *   - QL-FOR-001 (required bundle option at $0):
 *       OPTION_PRICE_UNRESOLVED, conf 0.6
 *       (Apex detector doesn't distinguish override-vs-unresolved
 *        sub-cases today, so we default to the lower-confidence
 *        story. Honest about what we know.)
 *   - PROV-FOR-002 (active subscription, no Asset):
 *       ASSET_RECORD_NOT_CREATED, conf 0.85
 *   - AST-FOR-001 (asset terminated mid-contract, no credit):
 *       TERMINATED_ASSET_NO_CREDIT_RECORD, conf 0.85
 *   - CT-FOR-001 (contracted price expired but still applied):
 *       CONTRACTED_PRICE_DATA_GAP, conf 0.9
 *   - MDQ-FOR-001 (MDQ segment pricing inconsistency):
 *       MDQ_SEGMENT_PRICING_DATA_GAP, conf 0.8
 *   - SUB-FOR-001 (subscription quantity drift):
 *       SUBSCRIPTION_QUANTITY_DRIFT, conf 0.85
 *   - PROV-FOR-001 (provisioned, not billed):
 *       PROVISIONED_NOT_BILLED_DATA_GAP, conf 0.85
 */
public class ClassETracer implements IAttributionTracer {

    public String getRootCauseClass() { return 'E'; }

    public List<AttributionCandidate> trace(
        ForensicFinding__c f,
        Map<String, Object> meta,
        DetectorContext ctx
    ) {
        String did = f.DetectorId__c;
        if (did == 'QL-FOR-001')  return traceBundleZero(f, meta);
        if (did == 'PROV-FOR-002') return traceSubNoAsset(f, meta);
        if (did == 'AST-FOR-001') return traceTerminatedNoCredit(f, meta);
        if (did == 'CT-FOR-001')  return traceContractedPriceExpired(f, meta);
        if (did == 'MDQ-FOR-001') return traceMdqSegmentInconsistency(f, meta);
        if (did == 'SUB-FOR-001') return traceQuantityDrift(f, meta);
        if (did == 'PROV-FOR-001') return traceProvisionedNotBilled(f, meta);
        return new List<AttributionCandidate>();
    }

    private List<AttributionCandidate> traceBundleZero(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'E';
        c.rootConfigType = 'SBQQ__QuoteLine__c';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = f.Title__c;
        c.reasonCode  = 'OPTION_PRICE_UNRESOLVED';
        c.confidence  = 0.6;
        c.evidence.put('quote_line_id', f.PrimaryRecordId__c);
        c.evidence.put('data_quality_gap',
            'Required bundle option is on a Quote Line with NetPrice=$0 but the ' +
            'product carries a non-zero list price. Either the line override was ' +
            'never restored by a price-correction Rule, or the Pricebook Entry ' +
            'for this option was never created. Inspect the Product2 + Pricebook ' +
            'configuration directly.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceSubNoAsset(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'E';
        c.rootConfigType = 'SBQQ__Subscription__c';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = (String) meta.get('productName');
        if (c.rootConfigName == null) c.rootConfigName = f.Title__c;
        c.reasonCode  = 'ASSET_RECORD_NOT_CREATED';
        c.confidence  = 0.85;
        c.evidence.put('subscription_id', f.PrimaryRecordId__c);
        c.evidence.put('account_id', meta.get('accountId'));
        c.evidence.put('product_name', meta.get('productName'));
        c.evidence.put('quantity', meta.get('quantity'));
        c.evidence.put('unit_price', meta.get('unitPrice'));
        c.evidence.put('data_quality_gap',
            'Active subscription exists but no matching Asset record was created. ' +
            'Customer Asset tracking and entitlement automation that key off Asset ' +
            'records will silently skip this subscription.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceTerminatedNoCredit(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'E';
        c.rootConfigType = 'Asset';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = (String) meta.get('productName');
        if (c.rootConfigName == null) c.rootConfigName = f.Title__c;
        c.reasonCode  = 'TERMINATED_ASSET_NO_CREDIT_RECORD';
        c.confidence  = 0.85;
        c.evidence.put('asset_id', f.PrimaryRecordId__c);
        c.evidence.put('asset_status', meta.get('assetStatus'));
        c.evidence.put('terminated_date', meta.get('terminatedDate'));
        c.evidence.put('annual_exposure', meta.get('annualExposure'));
        c.evidence.put('data_quality_gap',
            'Asset was terminated mid-contract but no credit memo / refund record ' +
            'was created. Termination flow updates the Asset status but the ' +
            'corresponding billing-side credit was never triggered.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceContractedPriceExpired(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'E';
        c.rootConfigType = 'SBQQ__ContractedPrice__c';
        c.rootConfigId   = (String) meta.get('contractedPriceId');
        c.rootConfigName = f.Title__c;
        c.reasonCode  = 'CONTRACTED_PRICE_DATA_GAP';
        c.confidence  = 0.9;
        c.evidence.put('contracted_price_id', meta.get('contractedPriceId'));
        c.evidence.put('expiration', meta.get('expiration'));
        c.evidence.put('locked_price', meta.get('lockedPrice'));
        c.evidence.put('current_list', meta.get('currentList'));
        c.evidence.put('days_expired', meta.get('daysExpired'));
        c.evidence.put('data_quality_gap',
            'Contracted Price record has an Expiration in the past but is still ' +
            'being applied. EndDate field exists but no scheduled cleanup process ' +
            'inactivates expired contracted prices — stale data drives current ' +
            'quotes.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceMdqSegmentInconsistency(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'E';
        c.rootConfigType = 'SBQQ__Quote__c';
        c.rootConfigId   = (String) meta.get('quoteId');
        c.rootConfigName = (String) meta.get('productName');
        if (c.rootConfigName == null) c.rootConfigName = f.Title__c;
        c.reasonCode  = 'MDQ_SEGMENT_PRICING_DATA_GAP';
        c.confidence  = 0.8;
        c.evidence.put('quote_id', meta.get('quoteId'));
        c.evidence.put('product_name', meta.get('productName'));
        c.evidence.put('segment_count', meta.get('segmentCount'));
        c.evidence.put('flagged_segments', meta.get('flaggedSegs'));
        c.evidence.put('data_quality_gap',
            'MDQ segments on this Quote carry inconsistent prices for the same ' +
            'Product. Either segment-level overrides were entered manually without ' +
            'a corresponding price escalator schedule, or the segment data was ' +
            'imported with drift baked in.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceQuantityDrift(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'E';
        c.rootConfigType = 'SBQQ__Subscription__c';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = f.Title__c;
        c.reasonCode  = 'SUBSCRIPTION_QUANTITY_DRIFT';
        c.confidence  = 0.85;
        c.evidence.put('subscription_id', f.PrimaryRecordId__c);
        c.evidence.put('data_quality_gap',
            'Subscription quantity has drifted from the source Quote Line / Asset ' +
            'quantity. The records that should agree on units don\'t. Billing keys ' +
            'off Subscription, so the customer is being invoiced for whatever value ' +
            'happens to be on this row — not what was sold.');
        return new List<AttributionCandidate>{ c };
    }

    private List<AttributionCandidate> traceProvisionedNotBilled(
        ForensicFinding__c f, Map<String, Object> meta
    ) {
        AttributionCandidate c = new AttributionCandidate();
        c.rootCauseClass = 'E';
        c.rootConfigType = 'Asset';
        c.rootConfigId   = f.PrimaryRecordId__c;
        c.rootConfigName = (String) meta.get('productName');
        if (c.rootConfigName == null) c.rootConfigName = f.Title__c;
        c.reasonCode  = 'PROVISIONED_NOT_BILLED_DATA_GAP';
        c.confidence  = 0.85;
        c.evidence.put('asset_id', f.PrimaryRecordId__c);
        c.evidence.put('product_name', meta.get('productName'));
        c.evidence.put('quantity', meta.get('quantity'));
        c.evidence.put('unit_price', meta.get('unitPrice'));
        c.evidence.put('install_date', meta.get('installDate'));
        c.evidence.put('days_installed', meta.get('daysInstalled'));
        c.evidence.put('price_source', meta.get('priceSource'));
        c.evidence.put('data_quality_gap',
            'Asset has been installed for days but no Subscription / OrderItem with ' +
            'matching billing rule exists. Provisioning system created the Asset; ' +
            'the corresponding billing record was never written.');
        return new List<AttributionCandidate>{ c };
    }
}
