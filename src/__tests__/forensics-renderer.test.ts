import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderFinding } from '@/lib/forensics/renderer';
import type { DetectorResult, AttributionCandidate } from '@/lib/forensics/types';

const baseFinding: DetectorResult = {
  detectorId: 'REN-001',
  severity: 'critical',
  entitledUsd: 50000,
  realizedUsd: 47500,
  gapUsd: 2500,
  currencyIsoCode: 'USD',
  recoverabilityScore: 0.75,
  primaryRecord: {
    type: 'SBQQ__QuoteLine__c',
    id: 'a0X000000ABC123',
    name: 'QL-00042',
  },
  supportingRecords: [
    { type: 'SBQQ__Quote__c', id: 'a0Y000000DEF456', name: 'Q-100' },
    { type: 'Contract', id: '800000000GHI789', name: 'C-9001' },
  ],
  title: 'Uplift suppressed',
};

const baseTrace: AttributionCandidate = {
  rootCauseClass: 'C',
  rootConfigType: 'SBQQ__PriceRule__c',
  rootConfigId: 'a0Z000000JKL012',
  rootConfigName: 'Renewal Floor Pricing',
  reasonCode: 'RULE_OVERRIDES_NETPRICE_ON_RENEWAL',
  confidence: 1.0,
  evidence: { evaluation_event: 'On Calculate', target_field: 'SBQQ__NetPrice__c' },
};

describe('forensic renderer', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.GEMINI_API_KEY;
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('falls back to template when no API key', async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await renderFinding(baseFinding, baseTrace);
    expect(r.model).toBe('template-fallback');
    expect(r.plainEnglish).toContain('Renewal Floor Pricing');
    expect(r.plainEnglish).toContain('QL-00042');
    expect(r.suggestedFix.length).toBeGreaterThan(20);
  });

  it('template uses the gap amount and currency from the finding', async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await renderFinding(baseFinding, baseTrace);
    expect(r.plainEnglish).toMatch(/USD\s+2,500/);
  });

  it('renders different prose for broad-rule vs renewal-condition variants', async () => {
    delete process.env.GEMINI_API_KEY;
    const renewalCondition = await renderFinding(baseFinding, {
      ...baseTrace,
      reasonCode: 'RULE_OVERRIDES_NETPRICE_ON_RENEWAL',
    });
    const broad = await renderFinding(baseFinding, {
      ...baseTrace,
      reasonCode: 'RULE_OVERRIDES_NETPRICE_BROADLY',
    });
    expect(renewalCondition.plainEnglish).not.toBe(broad.plainEnglish);
    // The renewal variant cites the renewal-specific evaluation.
    expect(renewalCondition.plainEnglish).toContain('renewal');
    expect(broad.plainEnglish).toContain('every quote');
  });

  it('uses the default template for an unknown reason code', async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await renderFinding(baseFinding, { ...baseTrace, reasonCode: 'SOME_NOVEL_REASON' });
    expect(r.model).toBe('template-fallback');
    expect(r.plainEnglish).toContain('SBQQ__PriceRule__c');
    expect(r.plainEnglish).toContain('Renewal Floor Pricing');
  });

  it('handles the Flow reason code with the verification-recommended copy', async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await renderFinding(baseFinding, {
      ...baseTrace,
      rootConfigType: 'Flow',
      rootConfigName: 'Update Renewal Pricing',
      reasonCode: 'FLOW_MUTATES_RENEWAL_PRICING_FIELD',
    });
    expect(r.plainEnglish.toLowerCase()).toContain('manual verification');
    expect(r.suggestedFix).toContain('Setup');
  });
});
