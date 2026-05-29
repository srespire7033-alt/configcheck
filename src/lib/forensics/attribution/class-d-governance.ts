/**
 * Class D — Missing Governance tracer.
 *
 * Identifies when a leak occurred because nothing prevented it — not
 * because someone misconfigured something, but because the org never
 * built a guardrail.
 *
 * Typical Class D signals:
 *   - DiscountSchedule with no SBQQ__EndDate__c (no expiry, no validation)
 *   - DiscountSchedule with EndDate in past but no ValidationRule
 *     blocking use after that date
 *   - No ApprovalRule catching the affected pattern (e.g. "discount > X%
 *     past schedule expiry requires approval")
 *
 * For DSC-FOR-001 findings specifically, the root config IS the
 * DiscountSchedule itself — that's the object that should have had
 * end-date enforcement and didn't. The attribution surfaces it as the
 * thing to fix.
 *
 * Confidence model:
 *   1.0  — schedule.SBQQ__EndDate__c is null (clear governance gap)
 *   0.85 — schedule.SBQQ__EndDate__c is in past AND no ValidationRule
 *          guards its use (could prove with metadata trace; v1 skips
 *          the ValidationRule check and uses the in-past-end-date
 *          signal alone)
 *   0.5  — generic "missing governance" fallback for non-discount
 *          findings that route through Class D
 */

import type { AttributionTracer, AttributionCandidate, DetectorResult } from '../types';

const CLASS_D_TRACER: AttributionTracer = {
  rootCauseClass: 'D',

  async trace(finding: DetectorResult): Promise<AttributionCandidate[]> {
    // v1: only DSC-FOR-001 findings route through Class D. As we add
    // more detectors that map to governance gaps (ORD-FOR-002 stray
    // lines, REN-007 under-renewed ACV without approval), we extend
    // this routing table.
    if (finding.detectorId !== 'DSC-FOR-001') return [];

    // The root config is the DiscountSchedule itself — that's the
    // object that needed guardrails and didn't have them.
    const schedule = finding.supportingRecords.find((r) => r.type === 'SBQQ__DiscountSchedule__c');
    if (!schedule) return [];

    const subCase = (finding.metadata?.sub_case as string) ?? '';
    const endDate = finding.metadata?.schedule_end_date as string | null | undefined;

    if (subCase === 'null_end_promo') {
      // Highest-confidence Class D: the schedule had no end date at all.
      // There's nothing to debate — fixing this is a one-field update.
      return [
        {
          rootCauseClass: 'D',
          rootConfigType: 'SBQQ__DiscountSchedule__c',
          rootConfigId: schedule.id,
          rootConfigName: schedule.name,
          reasonCode: 'DISCOUNT_SCHEDULE_NO_END_DATE',
          confidence: 1.0,
          evidence: {
            schedule_name: schedule.name,
            end_date: null,
            affected_quote_line_id: finding.primaryRecord.id,
            governance_gap: 'SBQQ__EndDate__c is null — no expiry, no validation rule, no approval gate',
          },
        },
      ];
    }

    if (subCase === 'expired') {
      // The end date exists, it's in the past, lines created after it
      // still apply the discount. Class D because no validation rule
      // is enforcing the end date.
      return [
        {
          rootCauseClass: 'D',
          rootConfigType: 'SBQQ__DiscountSchedule__c',
          rootConfigId: schedule.id,
          rootConfigName: schedule.name,
          reasonCode: 'DISCOUNT_END_DATE_NOT_ENFORCED',
          confidence: 0.85,
          evidence: {
            schedule_name: schedule.name,
            end_date: endDate,
            line_created_at: finding.metadata?.line_created_at,
            affected_quote_line_id: finding.primaryRecord.id,
            governance_gap: 'SBQQ__EndDate__c is in the past but no ValidationRule blocks use after that date',
          },
        },
      ];
    }

    return [];
  },
};

export default CLASS_D_TRACER;
