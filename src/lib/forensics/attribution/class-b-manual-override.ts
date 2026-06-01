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
