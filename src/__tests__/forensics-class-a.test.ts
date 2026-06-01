import { describe, it, expect } from 'vitest';
import CLASS_A_TRACER from '@/lib/forensics/attribution/class-a-system-disconnect';
import type { DetectorResult, DetectorContext } from '@/lib/forensics/types';

const stubCtx = {} as unknown as DetectorContext;

function makeOrdFor001Finding(
  hasNullBillingRule: boolean,
  overrides: Partial<DetectorResult> = {}
): DetectorResult {
  return {
    detectorId: 'ORD-FOR-001',
    severity: 'critical',
    entitledUsd: 300_000,
    realizedUsd: 0,
    gapUsd: 300_000,
    currencyIsoCode: 'USD',
    recoverabilityScore: 0.9,
    primaryRecord: {
      type: 'Order',
      id: '801000000ORD01',
      name: 'O-00042',
    },
    supportingRecords: [
      { type: 'OrderItem', id: '802000000ITM01', name: 'RFID Key Card' },
      { type: 'Account', id: '001000000ACC01', name: 'Account 001000000ACC01' },
    ],
    title: 'Order activated, no billing schedule',
    metadata: {
      activated_date: '2025-09-01',
      days_since_activation: 240,
      item_count: 1,
      has_orderitem_with_null_billing_rule: hasNullBillingRule,
      account_id: '001000000ACC01',
    },
    ...overrides,
  };
}

describe('Class A tracer', () => {
  it('returns 1.0 confidence when at least one OrderItem has null blng__BillingRule__c', async () => {
    const f = makeOrdFor001Finding(true);
    const [c] = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(c.rootCauseClass).toBe('A');
    expect(c.confidence).toBe(1.0);
    expect(c.reasonCode).toBe('BILLING_RULE_MISSING_ON_ORDERITEM');
    expect(c.rootConfigType).toBe('Order');
    expect(c.rootConfigName).toBe('O-00042');
  });

  it('returns 0.7 confidence when all OrderItems have billing rules but no schedules', async () => {
    const f = makeOrdFor001Finding(false);
    const [c] = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(c.confidence).toBe(0.7);
    expect(c.reasonCode).toBe('ACTIVATION_WORKFLOW_NOT_TRIGGERING');
  });

  it('produces zero candidates for non-ORD-FOR-001 findings (routing guard)', async () => {
    const f = makeOrdFor001Finding(true, { detectorId: 'REN-001' });
    const candidates = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(candidates).toEqual([]);
  });

  it('attaches a system_disconnect explanation in the evidence', async () => {
    const explicit = await CLASS_A_TRACER.trace(makeOrdFor001Finding(true), stubCtx);
    expect(explicit[0].evidence.system_disconnect).toContain('blng__BillingRule__c = null');
    expect(explicit[0].evidence.system_disconnect).toContain('silently skips');

    const implied = await CLASS_A_TRACER.trace(makeOrdFor001Finding(false), stubCtx);
    expect(implied[0].evidence.system_disconnect).toContain('workflow/trigger');
  });

  it('preserves days_since_activation in evidence for the renderer', async () => {
    const f = makeOrdFor001Finding(true);
    const [c] = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(c.evidence.days_since_activation).toBe(240);
    expect(c.evidence.order_number).toBe('O-00042');
  });

  it('uses the Order itself as the root config (not OrderItems or Workflow)', async () => {
    // The Order is the user-actionable entity — what they click into to
    // investigate. Even though the actual broken automation lives
    // elsewhere, the Order is the canonical handle.
    const f = makeOrdFor001Finding(true);
    const [c] = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(c.rootConfigType).toBe('Order');
    expect(c.rootConfigId).toBe(f.primaryRecord.id);
  });
});
