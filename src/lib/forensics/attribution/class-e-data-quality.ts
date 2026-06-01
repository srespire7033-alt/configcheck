/**
 * Class E — Poor Data Quality tracer.
 *
 * Identifies leakage caused by missing or inconsistent data on the
 * configuration records themselves. Distinct from Class D (no
 * guardrail) — Class E is "the guardrail would have worked if the data
 * supporting it was populated."
 *
 * For QL-FOR-001 (required bundle option charged at $0), the data-
 * quality story is:
 *   - PRICE_OVERRIDE_MISSING_ON_OPTION (1.0 conf)
 *     The product DOES have a list price, but the Quote Line's
 *     NetPrice was overridden to 0 and no price-correction logic
 *     restored it. The data is RIGHT on Product2 but WRONG on the
 *     line — a data-flow gap.
 *   - OPTION_PRICE_UNRESOLVED (0.6 conf)
 *     Neither the Quote Line nor the Product2 has a non-zero list
 *     price. Genuinely undefined data — could be intentional (the
 *     option is in fact free) or a missing Pricebook entry. Lower
 *     confidence because we can't prove the option SHOULD have been
 *     charged.
 *
 * v1 routes QL-FOR-001 only. Future detectors with data-quality root
 * causes (REN-005 sibling-line mismatch, AST-FOR-001 asset price drift)
 * route through here when shipped.
 */

import type { AttributionTracer, AttributionCandidate, DetectorResult } from '../types';

const CLASS_E_TRACER: AttributionTracer = {
  rootCauseClass: 'E',

  async trace(finding: DetectorResult): Promise<AttributionCandidate[]> {
    if (finding.detectorId === 'ORD-FOR-003') return traceAmendmentDataQuality(finding);
    if (finding.detectorId !== 'QL-FOR-001') return [];

    const subCase = (finding.metadata?.sub_case as string | undefined) ?? '';
    // The root config is the Product2 (the data IS the config here).
    // Tracer surfaces the product so the user can navigate straight to
    // Setup → Products and fix the upstream data, not the symptom.
    const productRef = finding.supportingRecords.find((r) => r.type === 'Product2');
    if (!productRef) return [];

    if (subCase === 'price_override_missing') {
      return [
        {
          rootCauseClass: 'E',
          rootConfigType: 'Product2',
          rootConfigId: productRef.id,
          rootConfigName: productRef.name,
          reasonCode: 'PRICE_OVERRIDE_MISSING_ON_OPTION',
          confidence: 1.0,
          evidence: {
            product_id: productRef.id,
            product_name: productRef.name,
            line_list_price: finding.metadata?.line_list_price,
            product_list_price: finding.metadata?.product_list_price,
            resolved_list_price: finding.metadata?.resolved_list_price,
            quantity: finding.metadata?.quantity,
            data_quality_gap:
              'Product2 carries a current list price but the QuoteLine was overridden to $0 with no price-correction Rule restoring it. The data IS right on Product2; the line broke the contract.',
          },
        },
      ];
    }

    if (subCase === 'unresolved_price') {
      return [
        {
          rootCauseClass: 'E',
          rootConfigType: 'Product2',
          rootConfigId: productRef.id,
          rootConfigName: productRef.name,
          reasonCode: 'OPTION_PRICE_UNRESOLVED',
          confidence: 0.6,
          evidence: {
            product_id: productRef.id,
            product_name: productRef.name,
            line_list_price: finding.metadata?.line_list_price,
            product_list_price: finding.metadata?.product_list_price,
            data_quality_gap:
              "Neither the Quote Line nor Product2's Standard Pricebook entry carries a non-zero list price. Either this option is genuinely free (intentional) or its Pricebook entry was never created.",
          },
        },
      ];
    }

    return [];
  },
};

export default CLASS_E_TRACER;

/**
 * ORD-FOR-003 — Amendment data-quality smoking gun. Only emits when
 * the detector flagged QuoteLine(s) with Existing=false for Products
 * already present on existing-flagged lines (clear rep-error pattern).
 * Wins at 0.95 confidence — beats both Class A (0.4 with this
 * signal) and Class B (0.5 with this signal).
 */
function traceAmendmentDataQuality(finding: DetectorResult): AttributionCandidate[] {
  const suspectIds = (finding.metadata?.existing_flag_suspect_line_ids as string[] | undefined) ?? [];
  if (suspectIds.length === 0) return [];

  const quoteId = finding.metadata?.quote_id as string | undefined;
  const quoteName = (finding.metadata?.quote_name as string | undefined) ?? 'Amendment Quote';

  return [
    {
      rootCauseClass: 'E',
      rootConfigType: 'SBQQ__QuoteLine__c',
      rootConfigId: suspectIds[0] ?? null,
      rootConfigName: `${suspectIds.length} mis-flagged line(s) on ${quoteName}`,
      reasonCode: 'AMENDMENT_EXISTING_FLAG_MISCONFIGURED',
      confidence: 0.95,
      evidence: {
        quote_id: quoteId,
        quote_name: quoteName,
        suspect_line_ids: suspectIds,
        suspect_count: suspectIds.length,
        variance_amount: finding.metadata?.variance_amount,
        data_quality_gap:
          'Amendment Quote has lines marked SBQQ__Existing__c=false for Products already on existing-flagged lines for the same amendment. The flag should have been derived (TRUE for products carried over from the original contract) but was set to FALSE — so the line is being treated as a NEW addition and double-counted on the amendment Order.',
      },
    },
  ];
}
