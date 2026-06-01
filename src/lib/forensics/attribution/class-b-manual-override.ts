/**
 * Class B — Manual Override tracer.
 *
 * Identifies when a leak happened because a rep manually edited a
 * price field, bypassing the configured pricing logic. The
 * canonical signal is SBQQ__PricingMethod__c = 'Manual' on the
 * affected line — CPQ uses that field to record explicit overrides.
 *
 * Confidence model:
 *   1.0 MANUAL_OVERRIDE_BELOW_LIST   SBQQ__PricingMethod__c = 'Manual'
 *                                    and price below current list
 *   0.6 IMPLIED_OVERRIDE_BELOW_LIST  PricingMethod not 'Manual' but
 *                                    price still below list with no
 *                                    detected price rule explanation.
 *                                    Could be a missing automation
 *                                    instead — caller can verify.
 *
 * v1 routes REN-002 findings only. Future detectors that surface
 * under-quoting or unauthorized discounts can route through Class B
 * the same way.
 */

import type { AttributionTracer, AttributionCandidate, DetectorResult } from '../types';

const CLASS_B_TRACER: AttributionTracer = {
  rootCauseClass: 'B',

  async trace(finding: DetectorResult): Promise<AttributionCandidate[]> {
    // ORD-FOR-002 — manual override flavor competes with Class A. We
    // only emit a Class B candidate when the manual-edit signal is
    // present; otherwise Class A's field-mapping story wins.
    if (finding.detectorId === 'ORD-FOR-002') return traceOrd002ManualEdit(finding);
    if (finding.detectorId === 'ORD-FOR-003') return traceOrd003ManualEdit(finding);
    // v1 routing: only REN-002 findings are eligible. Other manual-
    // override-shaped detectors (QL-FOR-002 "manual override no
    // approval", DSC-FOR-002 "stacked discounts") will route through
    // here when we ship them.
    if (finding.detectorId !== 'REN-002') return [];

    // The root config is the affected QuoteLine itself — the manual
    // override happens at the line level, not on a separate config
    // object. We point the user back to the line for inspection.
    const pricingMethod = (finding.metadata?.pricing_method as string | null | undefined) ?? null;
    const isExplicitManual = pricingMethod === 'Manual';

    return [
      {
        rootCauseClass: 'B',
        rootConfigType: 'SBQQ__QuoteLine__c',
        rootConfigId: finding.primaryRecord.id,
        rootConfigName: finding.primaryRecord.name,
        reasonCode: isExplicitManual ? 'MANUAL_OVERRIDE_BELOW_LIST' : 'IMPLIED_OVERRIDE_BELOW_LIST',
        confidence: isExplicitManual ? 1.0 : 0.6,
        evidence: {
          quote_line_id: finding.primaryRecord.id,
          pricing_method: pricingMethod,
          current_list_price: finding.metadata?.current_list_price,
          renewal_net_price: finding.metadata?.renewal_net_price,
          percent_below_list: finding.metadata?.percent_below_list,
          governance_gap: isExplicitManual
            ? 'SBQQ__PricingMethod__c = Manual — rep overrode the calculated price, and no approval rule flagged the divergence from current list.'
            : 'Price differs from list but PricingMethod is not Manual — either an unrecorded manual edit or a missing pricing automation.',
        },
      },
    ];
  },
};

export default CLASS_B_TRACER;

/**
 * ORD-FOR-002 manual-edit path. We claim Class B with high
 * confidence when LastModifiedById differs from CreatedById AND the
 * edit happened >1 hour after creation — meaning someone touched the
 * activated Order after the fact. Otherwise stay silent and let
 * Class A explain via field-mapping disconnect.
 */
/**
 * ORD-FOR-003 — same shape as ORD-FOR-002 but on the amendment Order.
 * Only claim when the manual-edit signal is present AND data-quality
 * suspect lines are NOT — Class E should win the data-quality story.
 */
function traceOrd003ManualEdit(finding: DetectorResult): AttributionCandidate[] {
  if (finding.metadata?.manually_edited !== true) return [];
  const dataQualitySuspect =
    Array.isArray(finding.metadata?.existing_flag_suspect_line_ids) &&
    (finding.metadata?.existing_flag_suspect_line_ids as unknown[]).length > 0;

  const direction = (finding.metadata?.direction as string | undefined) ?? 'under_billed';
  const orderIds = (finding.metadata?.order_ids as string[] | undefined) ?? [];
  const primaryOrderId = orderIds[0] ?? finding.primaryRecord.id;

  return [
    {
      rootCauseClass: 'B',
      rootConfigType: 'Order',
      rootConfigId: primaryOrderId,
      rootConfigName: finding.primaryRecord.name,
      reasonCode: 'AMENDMENT_ORDER_EDITED_POST_ACTIVATION',
      // Drop below Class E if data-quality is the smoking gun.
      confidence: dataQualitySuspect ? 0.5 : 0.9,
      evidence: {
        order_id: primaryOrderId,
        order_number: finding.primaryRecord.name,
        variance_amount: finding.metadata?.variance_amount,
        direction,
        governance_gap:
          'Amendment Order was edited by a different user >1 hour after creation. The variance between the expected amendment delta and the activated Order total is consistent with a manual price adjustment that bypassed CPQ.',
      },
    },
  ];
}

function traceOrd002ManualEdit(finding: DetectorResult): AttributionCandidate[] {
  if (finding.metadata?.manually_edited !== true) return [];

  const direction = (finding.metadata?.direction as string | undefined) ?? 'under_billed';
  const orderIds = (finding.metadata?.order_ids as string[] | undefined) ?? [];
  const primaryOrderId = orderIds[0] ?? finding.primaryRecord.id;

  return [
    {
      rootCauseClass: 'B',
      rootConfigType: 'Order',
      rootConfigId: primaryOrderId,
      rootConfigName: finding.primaryRecord.name,
      reasonCode: 'ORDER_EDITED_POST_ACTIVATION',
      confidence: 0.9,
      evidence: {
        order_id: primaryOrderId,
        order_number: finding.primaryRecord.name,
        variance_amount: finding.metadata?.variance_amount,
        direction,
        governance_gap:
          'Order was edited by a different user >1 hour after creation. The variance between Quote total and Order total is consistent with a manual price adjustment that bypassed CPQ. No approval rule on the Order object prevented the change.',
      },
    },
  ];
}
