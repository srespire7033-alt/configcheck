/**
 * Class A — Process & System Disconnect tracer.
 *
 * Identifies leakage caused by a missing or broken link between two
 * systems (CPQ ↔ Billing, Sales Cloud ↔ Order Management, etc.) where
 * each system is internally correct but the data flow between them
 * silently fails.
 *
 * Concrete pattern for ORD-FOR-001:
 *   The Order is in CPQ/Sales Cloud correctly (status='Activated',
 *   items priced). Billing exists. But no billing schedules were
 *   generated, which means EITHER:
 *     - The workflow/trigger that bridges Order Activation →
 *       blng__BillingSchedule__c generation isn't wired up
 *     - The OrderItem's required blng__BillingRule__c lookup is null
 *     - A custom integration silently failed
 *
 * Confidence model:
 *   1.0 BILLING_RULE_MISSING_ON_ORDERITEM   — at least one OrderItem
 *       has a null blng__BillingRule__c. Salesforce Billing REQUIRES
 *       this field to generate a schedule; a null value means the
 *       schedule generation logic would have raised an error or
 *       silently skipped. Clear smoking gun.
 *   0.7 ACTIVATION_WORKFLOW_NOT_TRIGGERING — items have billing rules
 *       set but no schedules exist. Workflow / trigger that should
 *       fire on Order.Status='Activated' isn't running (could be
 *       inactive, missing, or failing in a custom way). Requires
 *       manual inspection to confirm.
 *
 * v1 routes ORD-FOR-001 only. Future detectors with cross-system root
 * causes (BIL-FOR-001 unbilled usage, PROV-FOR-001 provisioned-not-
 * billed) route through here when shipped.
 */

import type { AttributionTracer, AttributionCandidate, DetectorResult } from '../types';

const CLASS_A_TRACER: AttributionTracer = {
  rootCauseClass: 'A',

  async trace(finding: DetectorResult): Promise<AttributionCandidate[]> {
    if (finding.detectorId === 'ORD-FOR-002') return traceQuoteOrderVariance(finding);
    if (finding.detectorId === 'ORD-FOR-003') return traceAmendmentVariance(finding);
    if (finding.detectorId !== 'ORD-FOR-001') return [];

    const hasNullBillingRule = finding.metadata?.has_orderitem_with_null_billing_rule === true;
    const daysActive = (finding.metadata?.days_since_activation as number | undefined) ?? 0;
    const itemCount = (finding.metadata?.item_count as number | undefined) ?? 0;

    if (hasNullBillingRule) {
      // High-confidence smoking gun: a required field is missing.
      return [
        {
          rootCauseClass: 'A',
          rootConfigType: 'Order',
          rootConfigId: finding.primaryRecord.id,
          rootConfigName: finding.primaryRecord.name,
          reasonCode: 'BILLING_RULE_MISSING_ON_ORDERITEM',
          confidence: 1.0,
          evidence: {
            order_id: finding.primaryRecord.id,
            order_number: finding.primaryRecord.name,
            days_since_activation: daysActive,
            item_count: itemCount,
            system_disconnect:
              'At least one OrderItem has blng__BillingRule__c = null. Salesforce Billing requires this lookup populated to generate a billing schedule; without it, activation-triggered schedule logic silently skips this Order.',
          },
        },
      ];
    }

    // Items have billing rules but no schedules exist → the
    // activation workflow / trigger itself isn't running.
    return [
      {
        rootCauseClass: 'A',
        rootConfigType: 'Order',
        rootConfigId: finding.primaryRecord.id,
        rootConfigName: finding.primaryRecord.name,
        reasonCode: 'ACTIVATION_WORKFLOW_NOT_TRIGGERING',
        confidence: 0.7,
        evidence: {
          order_id: finding.primaryRecord.id,
          order_number: finding.primaryRecord.name,
          days_since_activation: daysActive,
          item_count: itemCount,
          system_disconnect:
            'OrderItems carry billing rules but no billing schedules exist. The Order Activation workflow/trigger that should generate schedules either is not active, has a process error, or was never installed. Manual inspection of Setup → Process Builder / Flow / Apex Triggers needed.',
        },
      },
    ];
  },
};

export default CLASS_A_TRACER;

/**
 * ORD-FOR-002 — Quote-to-Order variance. Class A is the DEFAULT
 * explanation: the Q→O sync didn't preserve totals. We still emit a
 * Class A candidate at moderate confidence, then let Class B
 * (manual override) compete on the manual-edit signal.
 *
 * If `manually_edited = true` we lower our confidence so Class B can
 * win the ranking. If `manually_edited = false`, the field-mapping
 * disconnect explanation stands.
 */
/**
 * ORD-FOR-003 — Amendment variance. Class A's story: the amendment Q→O
 * conversion didn't preserve the delta. Yields when Class E
 * (data-quality) or Class B (manual edit) has stronger evidence.
 */
function traceAmendmentVariance(finding: DetectorResult): AttributionCandidate[] {
  // Class E wins outright if the data-quality smoking gun is present —
  // surface a low-confidence Class A so it stays in the candidate list
  // but doesn't beat E.
  const dataQualitySuspect =
    Array.isArray(finding.metadata?.existing_flag_suspect_line_ids) &&
    (finding.metadata?.existing_flag_suspect_line_ids as unknown[]).length > 0;
  const manuallyEdited = finding.metadata?.manually_edited === true;
  const prorationActive = finding.metadata?.proration_active === true;
  const crossValidated = finding.metadata?.cross_validated === true;
  const direction = (finding.metadata?.direction as string | undefined) ?? 'under_billed';
  const quoteId = finding.metadata?.quote_id as string | undefined;
  const quoteName = (finding.metadata?.quote_name as string | undefined) ?? 'Amendment Quote';

  // Base confidence:
  //   0.85 normally
  //   0.5 if manual-edit signal present (Class B should win)
  //   0.4 if data-quality suspect (Class E should win)
  //   +0.05 if cross-validated via prior Orders (Layer 2 agrees)
  //   −0.1 if proration active (uncertainty)
  let confidence = 0.85;
  if (dataQualitySuspect) confidence = 0.4;
  else if (manuallyEdited) confidence = 0.5;
  if (crossValidated) confidence = Math.min(1, confidence + 0.05);
  if (prorationActive) confidence = Math.max(0.1, confidence - 0.1);

  return [
    {
      rootCauseClass: 'A',
      rootConfigType: 'SBQQ__Quote__c',
      rootConfigId: quoteId ?? null,
      rootConfigName: quoteName,
      reasonCode: 'AMENDMENT_DELTA_MISMATCH',
      confidence,
      evidence: {
        quote_id: quoteId,
        quote_name: quoteName,
        expected_delta: finding.metadata?.expected_delta,
        order_total_sum: finding.metadata?.order_total_sum,
        variance_amount: finding.metadata?.variance_amount,
        direction,
        cross_validated: crossValidated,
        proration_active: prorationActive,
        system_disconnect:
          'Amendment Quote was activated and the resulting Order(s) do not sum to the expected delta (sum of new amendment lines). The Q→O conversion either dropped a new line, applied stale pricing, or a Flow/Apex on Order rewrote pricing fields. Inspect the amendment Q→O field mapping.',
      },
    },
  ];
}

function traceQuoteOrderVariance(finding: DetectorResult): AttributionCandidate[] {
  const direction = (finding.metadata?.direction as string | undefined) ?? 'under_billed';
  const manuallyEdited = finding.metadata?.manually_edited === true;
  const orderCount = (finding.metadata?.order_ids as string[] | undefined)?.length ?? 1;
  const quoteId = finding.metadata?.quote_id as string | undefined;
  const quoteName = (finding.metadata?.quote_name as string | undefined) ?? 'Quote';

  return [
    {
      rootCauseClass: 'A',
      rootConfigType: 'SBQQ__Quote__c',
      rootConfigId: quoteId ?? null,
      rootConfigName: quoteName,
      reasonCode: 'QUOTE_ORDER_TOTAL_VARIANCE',
      // Lower confidence when manual-edit signal is present so Class B
      // can take primary attribution. Higher when there's no manual
      // signal — the Q→O field-mapping story is the leading theory.
      confidence: manuallyEdited ? 0.5 : 0.85,
      evidence: {
        quote_id: quoteId,
        quote_name: quoteName,
        quote_net_amount: finding.metadata?.quote_net_amount,
        order_total_sum: finding.metadata?.order_total_sum,
        variance_amount: finding.metadata?.variance_amount,
        variance_pct: finding.metadata?.variance_pct,
        direction,
        order_count: orderCount,
        recovery_mode: finding.metadata?.recovery_mode,
        system_disconnect:
          'Quote was approved at the quoted Net Amount but the activated Order(s) totalled a different number. The Q→O conversion either dropped a line, applied a different Pricebook, or a Flow/Apex on Order rewrote pricing fields. Inspect the Q→O field mapping and any Order triggers/Flows.',
      },
    },
  ];
}
