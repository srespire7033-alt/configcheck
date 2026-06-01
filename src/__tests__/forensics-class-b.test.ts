import { describe, it, expect } from 'vitest';
import CLASS_B_TRACER from '@/lib/forensics/attribution/class-b-manual-override';
import type { DetectorResult, DetectorContext } from '@/lib/forensics/types';

const stubCtx = {} as unknown as DetectorContext;

function makeRen002Finding(overrides: Partial<DetectorResult> = {}, meta: Record<string, unknown> = {}): DetectorResult {
  return {
    detectorId: 'REN-002',
    severity: 'critical',
    entitledUsd: 120_000,
    realizedUsd: 96_000,
    gapUsd: 24_000,
    currencyIsoCode: 'USD',
    recoverabilityScore: 0.85,
    primaryRecord: { type: 'SBQQ__QuoteLine__c', id: 'a0X00000UCL01', name: 'QL-UCL-01' },
    supportingRecords: [],
    title: 'Renewal 20% below current list',
    metadata: {
      current_list_price: 120000,
      renewal_net_price: 96000,
      percent_below_list: 20,
      pricing_method: null,
      tolerance_used: 0.9,
      ...meta,
    },
    ...overrides,
  };
}

describe('Class B tracer', () => {
  it('returns 1.0 confidence when SBQQ__PricingMethod__c is Manual', async () => {
    const f = makeRen002Finding({}, { pricing_method: 'Manual' });
    const [candidate] = await CLASS_B_TRACER.trace(f, stubCtx);
    expect(candidate.rootCauseClass).toBe('B');
    expect(candidate.confidence).toBe(1.0);
    expect(candidate.reasonCode).toBe('MANUAL_OVERRIDE_BELOW_LIST');
    expect(candidate.rootConfigType).toBe('SBQQ__QuoteLine__c');
    expect(candidate.rootConfigId).toBe(f.primaryRecord.id);
  });

  it('returns 0.6 confidence when PricingMethod is null but price is below list', async () => {
    const f = makeRen002Finding({}, { pricing_method: null });
    const [candidate] = await CLASS_B_TRACER.trace(f, stubCtx);
    expect(candidate.confidence).toBe(0.6);
    expect(candidate.reasonCode).toBe('IMPLIED_OVERRIDE_BELOW_LIST');
  });

  it('returns 0.6 when PricingMethod is some other value (List, Block, etc.)', async () => {
    const f = makeRen002Finding({}, { pricing_method: 'List' });
    const [candidate] = await CLASS_B_TRACER.trace(f, stubCtx);
    expect(candidate.confidence).toBe(0.6);
    expect(candidate.reasonCode).toBe('IMPLIED_OVERRIDE_BELOW_LIST');
  });

  it('produces zero candidates for non-REN-002 findings (routing guard)', async () => {
    const f = makeRen002Finding({ detectorId: 'REN-001' });
    const candidates = await CLASS_B_TRACER.trace(f, stubCtx);
    expect(candidates).toEqual([]);
  });

  it('attaches a governance_gap explanation in the evidence', async () => {
    const explicit = await CLASS_B_TRACER.trace(makeRen002Finding({}, { pricing_method: 'Manual' }), stubCtx);
    expect(explicit[0].evidence.governance_gap).toContain('Manual');
    expect(explicit[0].evidence.governance_gap).toContain('no approval rule');

    const implied = await CLASS_B_TRACER.trace(makeRen002Finding({}, { pricing_method: null }), stubCtx);
    expect(implied[0].evidence.governance_gap).toContain('not Manual');
  });

  it('preserves percent_below_list in evidence for the renderer to use', async () => {
    const f = makeRen002Finding({}, { pricing_method: 'Manual', percent_below_list: 20 });
    const [candidate] = await CLASS_B_TRACER.trace(f, stubCtx);
    expect(candidate.evidence.percent_below_list).toBe(20);
  });
});
