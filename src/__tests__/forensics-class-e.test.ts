import { describe, it, expect } from 'vitest';
import CLASS_E_TRACER from '@/lib/forensics/attribution/class-e-data-quality';
import type { DetectorResult, DetectorContext } from '@/lib/forensics/types';

const stubCtx = {} as unknown as DetectorContext;

function makeQlFor001Finding(
  subCase: 'price_override_missing' | 'unresolved_price',
  overrides: Partial<DetectorResult> = {}
): DetectorResult {
  const resolvedList = subCase === 'price_override_missing' ? 24_000 : 0;
  return {
    detectorId: 'QL-FOR-001',
    severity: 'warning',
    entitledUsd: resolvedList,
    realizedUsd: 0,
    gapUsd: resolvedList,
    currencyIsoCode: 'USD',
    recoverabilityScore: subCase === 'price_override_missing' ? 0.9 : 0.3,
    primaryRecord: { type: 'SBQQ__QuoteLine__c', id: 'a0X00000QL1', name: 'QL-OPT-1' },
    supportingRecords: [
      { type: 'SBQQ__Quote__c', id: 'a0Y00000Q1', name: 'Q-001' },
      { type: 'SBQQ__QuoteLine__c', id: 'a0X00000QL0', name: 'Bundle parent (RequiredBy=a0X000…)' },
      { type: 'Product2', id: '01t00000PRD', name: 'Premium Support' },
    ],
    title: 'Bundle option free',
    metadata: {
      sub_case: subCase,
      line_list_price: 0,
      product_list_price: subCase === 'price_override_missing' ? 24_000 : 0,
      resolved_list_price: resolvedList,
      quantity: 1,
    },
    ...overrides,
  };
}

describe('Class E tracer', () => {
  it('returns 1.0 confidence when sub_case is price_override_missing', async () => {
    const f = makeQlFor001Finding('price_override_missing');
    const [candidate] = await CLASS_E_TRACER.trace(f, stubCtx);
    expect(candidate.rootCauseClass).toBe('E');
    expect(candidate.confidence).toBe(1.0);
    expect(candidate.reasonCode).toBe('PRICE_OVERRIDE_MISSING_ON_OPTION');
    expect(candidate.rootConfigType).toBe('Product2');
    expect(candidate.rootConfigName).toBe('Premium Support');
  });

  it('returns 0.6 confidence when sub_case is unresolved_price', async () => {
    const f = makeQlFor001Finding('unresolved_price');
    const [candidate] = await CLASS_E_TRACER.trace(f, stubCtx);
    expect(candidate.confidence).toBe(0.6);
    expect(candidate.reasonCode).toBe('OPTION_PRICE_UNRESOLVED');
  });

  it('produces zero candidates for non-QL-FOR-001 findings (routing guard)', async () => {
    const f = makeQlFor001Finding('price_override_missing', { detectorId: 'REN-001' });
    const candidates = await CLASS_E_TRACER.trace(f, stubCtx);
    expect(candidates).toEqual([]);
  });

  it('produces zero candidates when Product2 supporting record is missing', async () => {
    const f = makeQlFor001Finding('price_override_missing', {
      supportingRecords: [
        { type: 'SBQQ__Quote__c', id: 'a0Y0', name: 'Q-1' },
      ],
    });
    const candidates = await CLASS_E_TRACER.trace(f, stubCtx);
    expect(candidates).toEqual([]);
  });

  it('produces zero candidates for unrecognized sub_case', async () => {
    const f = makeQlFor001Finding('price_override_missing', {
      metadata: { sub_case: 'something_else' },
    });
    const candidates = await CLASS_E_TRACER.trace(f, stubCtx);
    expect(candidates).toEqual([]);
  });

  it('attaches a data_quality_gap explanation in the evidence', async () => {
    const f = makeQlFor001Finding('price_override_missing');
    const [c] = await CLASS_E_TRACER.trace(f, stubCtx);
    expect(c.evidence.data_quality_gap).toContain('Product2');
    expect(c.evidence.data_quality_gap).toContain('list price');
  });

  it('preserves resolved_list_price in evidence for the renderer', async () => {
    const f = makeQlFor001Finding('price_override_missing');
    const [c] = await CLASS_E_TRACER.trace(f, stubCtx);
    expect(c.evidence.resolved_list_price).toBe(24_000);
    expect(c.evidence.quantity).toBe(1);
  });
});
