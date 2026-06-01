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
