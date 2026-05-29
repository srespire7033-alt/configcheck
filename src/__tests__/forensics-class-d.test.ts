import { describe, it, expect } from 'vitest';
import CLASS_D_TRACER from '@/lib/forensics/attribution/class-d-governance';
import type { DetectorResult, DetectorContext } from '@/lib/forensics/types';

// Class D tracer is deterministic and takes no Connection — we can test
// it without mocking jsforce. (The renderer's Gemini path is mocked
// separately in forensics-renderer.test.ts.)
const stubCtx = {} as unknown as DetectorContext;

function makeDscFinding(subCase: 'expired' | 'null_end_promo', overrides: Partial<DetectorResult> = {}): DetectorResult {
  return {
    detectorId: 'DSC-FOR-001',
    severity: 'warning',
    entitledUsd: 240_000,
    realizedUsd: 180_000,
    gapUsd: 60_000,
    currencyIsoCode: 'USD',
    recoverabilityScore: 0.85,
    primaryRecord: { type: 'SBQQ__QuoteLine__c', id: 'a0X000000Q1L01', name: 'QL-PROMO-1' },
    supportingRecords: [
      { type: 'SBQQ__Quote__c', id: 'a0Y000000Q1Q01', name: 'Q-PROMO-1' },
      {
        type: 'SBQQ__DiscountSchedule__c',
        id: 'a0Z000000DSC01',
        name: '2025 Q1 New Logo Promo',
      },
      { type: 'Product2', id: '01t000000PRD01', name: 'RFID Key Card' },
    ],
    title: 'Promo discount roll-off',
    metadata: {
      sub_case: subCase,
      schedule_end_date: subCase === 'expired' ? '2025-03-31' : null,
      discount_pct: 25,
      list_price_per_unit: 40000,
      line_created_at: '2025-06-15T10:00:00Z',
    },
    ...overrides,
  };
}

describe('Class D tracer', () => {
  it('produces a 1.0-confidence candidate when the schedule has no end date', async () => {
    const f = makeDscFinding('null_end_promo');
    const candidates = await CLASS_D_TRACER.trace(f, stubCtx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].rootCauseClass).toBe('D');
    expect(candidates[0].confidence).toBe(1.0);
    expect(candidates[0].reasonCode).toBe('DISCOUNT_SCHEDULE_NO_END_DATE');
    expect(candidates[0].rootConfigName).toBe('2025 Q1 New Logo Promo');
    expect(candidates[0].evidence.end_date).toBeNull();
  });

  it('produces a 0.85-confidence candidate when end date is in the past', async () => {
    const f = makeDscFinding('expired');
    const candidates = await CLASS_D_TRACER.trace(f, stubCtx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBe(0.85);
    expect(candidates[0].reasonCode).toBe('DISCOUNT_END_DATE_NOT_ENFORCED');
    expect(candidates[0].evidence.end_date).toBe('2025-03-31');
  });

  it('produces zero candidates for non-DSC-FOR-001 findings (routing guard)', async () => {
    const f = makeDscFinding('expired', { detectorId: 'REN-001' });
    const candidates = await CLASS_D_TRACER.trace(f, stubCtx);
    expect(candidates).toEqual([]);
  });

  it('produces zero candidates when DiscountSchedule supporting record is missing', async () => {
    const f = makeDscFinding('null_end_promo', {
      supportingRecords: [
        { type: 'SBQQ__Quote__c', id: 'a0Y0', name: 'Q-1' },
        { type: 'Product2', id: '01t0', name: 'P' },
      ],
    });
    const candidates = await CLASS_D_TRACER.trace(f, stubCtx);
    expect(candidates).toEqual([]);
  });

  it('attaches deterministic evidence — governance_gap explains the leak', async () => {
    const f = makeDscFinding('null_end_promo');
    const [candidate] = await CLASS_D_TRACER.trace(f, stubCtx);
    expect(candidate.evidence.governance_gap).toContain('SBQQ__EndDate__c is null');
    expect(candidate.evidence.affected_quote_line_id).toBe(f.primaryRecord.id);
  });
});
