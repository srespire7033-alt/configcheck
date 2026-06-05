/**
 * Phase 12 — Attribution renderer.
 *
 * Given a reasonCode + evidence Map (the polished JSON that the
 * tracer produced), returns a single polished sentence suitable for
 * AttributionTrace__c.AiExplanation__c. Even though the field is
 * named "Ai*", we populate it deterministically with a template —
 * the UI / executive PDF read this field directly, and templates
 * outperform LLM rendering at the per-finding level (faster, cheaper,
 * audit-friendly).
 *
 * AiModel__c gets set to 'template-v1' so consumers can tell the
 * polish came from a template, not a model.
 */
public class AttributionRenderer {

    public static final String MODEL_TAG = 'template-v1';

    public static String render(String reasonCode, Map<String, Object> evidence) {
        if (reasonCode == null) return null;
        if (evidence == null) evidence = new Map<String, Object>();

        // Class A — System Disconnect
        if (reasonCode == 'ACTIVATION_WORKFLOW_NOT_TRIGGERING') {
            return 'The Order is activated and its OrderItems carry billing rules, ' +
                'but no billing schedule has been generated. The Order Activation ' +
                'workflow that should produce schedules is either inactive, errored, ' +
                'or never installed. Inspect Setup → Process Builder / Flow / Apex ' +
                'Triggers on Order.';
        }
        if (reasonCode == 'BILLING_RULE_MISSING_ON_ORDERITEM') {
            return 'At least one OrderItem has blng__BillingRule__c = null. ' +
                'Salesforce Billing requires this lookup populated to generate a ' +
                'billing schedule, so the activation logic silently skipped this ' +
                'Order. Set the missing BillingRule and re-activate.';
        }
        if (reasonCode == 'QUOTE_ORDER_TOTAL_VARIANCE') {
            return 'Quote was approved at one Net Amount but the activated Order(s) ' +
                'totalled a different number — the Q→O conversion either dropped a ' +
                'line, applied a different Pricebook, or a downstream Flow/Apex on ' +
                'Order rewrote price fields after activation.';
        }
        if (reasonCode == 'AMENDMENT_DELTA_MISMATCH') {
            return 'Amendment Quote was activated and the resulting Order(s) do not ' +
                'sum to the expected delta. The amendment Q→O conversion either ' +
                'dropped a new line, applied stale pricing, or a Flow/Apex on Order ' +
                'rewrote pricing fields. Inspect the amendment Q→O field mapping.';
        }

        // Class B — Manual Override
        if (reasonCode == 'MANUAL_OVERRIDE_BELOW_LIST') {
            return 'SBQQ__PricingMethod__c is set to Manual — the rep overrode the ' +
                'calculated price, and no Approval Rule flagged the divergence from ' +
                'current list pricing. Either tighten the approval rules or correct ' +
                'the override on this line.';
        }
        if (reasonCode == 'IMPLIED_OVERRIDE_BELOW_LIST') {
            return 'Renewal price differs from current list, suggesting either an ' +
                'unrecorded manual edit on the Quote Line or a missing pricing ' +
                'automation. Verify on the Quote Line directly; capture the override ' +
                'rationale or restore list pricing.';
        }
        if (reasonCode == 'ORDER_EDITED_POST_ACTIVATION'
            || reasonCode == 'AMENDMENT_ORDER_EDITED_POST_ACTIVATION') {
            return 'The Order was edited by a different user more than an hour after ' +
                'creation. The variance between Quote and Order totals is consistent ' +
                'with a manual price adjustment that bypassed CPQ.';
        }

        // Class C — Conflicting Automation
        if (reasonCode == 'RULE_OVERRIDES_NETPRICE_ON_RENEWAL') {
            String name = (String) evidence.get('affected_record_id');
            return 'An active Price Rule targets SBQQ__NetPrice__c with a Renewal ' +
                'condition — it is firing on this record and silently overriding the ' +
                'configured renewal price. Inactivate or scope the rule, then ' +
                're-quote.';
        }
        if (reasonCode == 'RULE_OVERRIDES_NETPRICE_BROADLY') {
            return 'An active Price Rule targets SBQQ__NetPrice__c with no Renewal ' +
                'gate — it fires on every quote, including renewals, and overwrites ' +
                'the calculated price. Scope its conditions to exclude renewals, or ' +
                'inactivate it.';
        }
        if (reasonCode == 'RULE_OVERRIDES_RELATED_PRICING_FIELD') {
            return 'An active Price Rule mutates a related pricing field (Discount / ' +
                'ListPrice). It is unlikely to be the direct cause but it may be ' +
                'contributing — verify the rule\'s evaluation order against the ' +
                'expected pricing flow.';
        }
        if (reasonCode == 'FLOW_MUTATES_RENEWAL_PRICING_FIELD') {
            return 'A record-triggered Flow on Quote / QuoteLine / Contract is ' +
                'active. We could not parse its definition automatically — verify ' +
                'manually that it does not write to NetPrice on renewal records.';
        }

        // Class D — Missing Governance
        if (reasonCode == 'DISCOUNT_SCHEDULE_PAST_END_DATE') {
            String sched = (String) evidence.get('schedule_name');
            Object endDate = evidence.get('schedule_end_date');
            String whenPhrase = (endDate != null) ? ' (ended ' + endDate + ')' : '';
            return 'Discount Schedule ' + (sched != null ? '"' + sched + '"' : '') +
                whenPhrase + ' has an EndDate in the past but is still being applied. ' +
                'No validation rule, approval, or activation guard prevents the ' +
                'discount from continuing past expiration.';
        }
        if (reasonCode == 'AMENDMENT_NO_EFFECTIVE_DATE') {
            return 'Amendment Quote was activated without SBQQ__StartDate__c ' +
                'populated. No validation rule prevented activation; downstream ' +
                'proration math has no anchor to compute against.';
        }
        if (reasonCode == 'OPPORTUNITY_NO_QUOTE_GOVERNANCE') {
            return 'Opportunity moved to Closed-Won without any CPQ Quote attached. ' +
                'No validation rule on Opportunity Stage requires a Primary Quote — ' +
                'the configured-pricing pipeline was bypassed entirely.';
        }
        if (reasonCode == 'CONTRACT_RENEWAL_GOVERNANCE_GAP') {
            return 'Contract is Activated but all subscriptions have expired and no ' +
                'renewal process fired. No scheduled job, Flow, or Approval routes ' +
                'the contract to a renewal owner — this is quiet churn.';
        }
        if (reasonCode == 'APPROVAL_PROCESS_NOT_BLOCKING') {
            Object disc = evidence.get('discount_pct');
            Object thr = evidence.get('threshold_pct');
            String discPhrase = (disc != null && thr != null)
                ? ' (' + disc + '% applied; threshold is ' + thr + '%)' : '';
            return 'Quote line was approved at a discount above the configured ' +
                'threshold without a matching Approval Rule firing' + discPhrase +
                '. Either the Approval Rule is inactive, its conditions do not ' +
                'match this scenario, or it was bypassed.';
        }

        // Class E — Poor Data Quality
        if (reasonCode == 'OPTION_PRICE_UNRESOLVED') {
            return 'Required bundle option is being given away at $0 even though ' +
                'the underlying product has a positive list price. Either the line ' +
                'override was never restored by a price-correction Rule, or the ' +
                'PricebookEntry for this option was never created. Inspect Product2 ' +
                'and Pricebook configuration directly.';
        }
        if (reasonCode == 'ASSET_RECORD_NOT_CREATED') {
            return 'Active subscription exists but no matching Asset record was ' +
                'created. Customer Asset tracking and entitlement automation that ' +
                'key off Asset records will silently skip this subscription.';
        }
        if (reasonCode == 'TERMINATED_ASSET_NO_CREDIT_RECORD') {
            return 'Asset was terminated mid-contract but no credit memo or refund ' +
                'record was generated. The termination flow updated the Asset status ' +
                'but the billing-side credit was never triggered.';
        }
        if (reasonCode == 'CONTRACTED_PRICE_DATA_GAP') {
            return 'Contracted Price record has an Expiration in the past but is ' +
                'still being applied. The EndDate field exists but no scheduled ' +
                'cleanup process inactivates expired contracted prices — stale ' +
                'data continues to drive current quotes.';
        }
        if (reasonCode == 'MDQ_SEGMENT_PRICING_DATA_GAP') {
            return 'MDQ segments on this Quote carry inconsistent prices for the ' +
                'same Product. Either segment-level overrides were entered manually ' +
                'without a matching price-escalator schedule, or segment data was ' +
                'imported with drift baked in.';
        }
        if (reasonCode == 'SUBSCRIPTION_QUANTITY_DRIFT') {
            return 'Subscription quantity has drifted from the source Quote Line / ' +
                'Asset quantity. Records that should agree on units do not. Billing ' +
                'keys off Subscription, so the customer is being invoiced for ' +
                'whatever value sits on this row — not what was sold.';
        }
        if (reasonCode == 'PROVISIONED_NOT_BILLED_DATA_GAP') {
            return 'Asset has been installed for some time but no Subscription / ' +
                'OrderItem with a matching billing rule exists. The provisioning ' +
                'system created the Asset; the corresponding billing record was ' +
                'never written.';
        }

        // Fallback — unknown reason code. Return a generic but useful sentence
        // so the UI doesn't show an empty Ai Explanation field.
        return 'Attribution flagged this finding under reason code ' + reasonCode +
            '. Review the Evidence panel below for details.';
    }
}
