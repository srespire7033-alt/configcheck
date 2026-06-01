import { describe, it, expect } from 'vitest';
import { aggregateAttribution, type FindingWithTrace } from '@/lib/forensics/attribution-map';

function row(over: Partial<FindingWithTrace> = {}): FindingWithTrace {
  return {
    finding_id: 'F1',
    detector_id: 'REN-001',
    gap_usd: 10_000,
    currency_iso_code: 'USD',
    root_cause_class: 'C',
    root_config_type: 'SBQQ__PriceRule__c',
    root_config_id: 'rule-1',
    root_config_name: 'Renewal Floor Pricing',
    reason_code: 'RULE_OVERRIDES_NETPRICE_ON_RENEWAL',
    confidence: 1.0,
    ai_explanation: 'Standard explanation',
    ai_suggested_fix: 'Standard fix',
    ...over,
  };
}

describe('aggregateAttribution', () => {
  it('returns empty list for empty input', () => {
    expect(aggregateAttribution([])).toEqual([]);
  });

  it('groups findings sharing the same root config', () => {
    const rows = aggregateAttribution([
      row({ finding_id: 'F1', gap_usd: 10_000 }),
      row({ finding_id: 'F2', gap_usd: 20_000 }),
      row({ finding_id: 'F3', gap_usd: 30_000 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].finding_count).toBe(3);
    expect(rows[0].total_gap_usd).toBe(60_000);
    expect(rows[0].sample_finding_ids).toEqual(['F1', 'F2', 'F3']);
  });

  it('keeps separate rows for distinct root_config_ids even within same class', () => {
    const rows = aggregateAttribution([
      row({ finding_id: 'F1', root_config_id: 'rule-1', gap_usd: 10_000 }),
      row({ finding_id: 'F2', root_config_id: 'rule-2', root_config_name: 'Another Rule', gap_usd: 50_000 }),
    ]);
    expect(rows).toHaveLength(2);
    // Sorted by gap desc
    expect(rows[0].root_config_id).toBe('rule-2');
    expect(rows[1].root_config_id).toBe('rule-1');
  });

  it('keeps separate rows when same config_id appears under different classes', () => {
    // Edge case: a config object that's flagged by two different
    // attribution classes (rare but possible). They stay separate so
    // the user sees both perspectives.
    const rows = aggregateAttribution([
      row({ finding_id: 'F1', root_cause_class: 'C' }),
      row({ finding_id: 'F2', root_cause_class: 'B' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.root_cause_class).sort()).toEqual(['B', 'C']);
  });

  it('sorts rows by total_gap_usd descending', () => {
    const rows = aggregateAttribution([
      row({ finding_id: 'small', root_config_id: 'rule-small', gap_usd: 5_000 }),
      row({ finding_id: 'big', root_config_id: 'rule-big', gap_usd: 500_000 }),
      row({ finding_id: 'medium', root_config_id: 'rule-med', gap_usd: 50_000 }),
    ]);
    expect(rows.map((r) => r.total_gap_usd)).toEqual([500_000, 50_000, 5_000]);
  });

  it('keeps the highest-confidence reason code + explanation as the primary', () => {
    const rows = aggregateAttribution([
      row({
        finding_id: 'F1',
        confidence: 0.6,
        reason_code: 'LOWER_CONFIDENCE',
        ai_explanation: 'lower',
        ai_suggested_fix: 'lower fix',
      }),
      row({
        finding_id: 'F2',
        confidence: 1.0,
        reason_code: 'HIGHER_CONFIDENCE',
        ai_explanation: 'higher',
        ai_suggested_fix: 'higher fix',
      }),
    ]);
    expect(rows[0].primary_reason_code).toBe('HIGHER_CONFIDENCE');
    expect(rows[0].max_confidence).toBe(1.0);
    expect(rows[0].primary_explanation).toBe('higher');
    expect(rows[0].primary_suggested_fix).toBe('higher fix');
  });

  it('collects distinct detector IDs that contributed to a root', () => {
    const rows = aggregateAttribution([
      row({ finding_id: 'F1', detector_id: 'REN-001' }),
      row({ finding_id: 'F2', detector_id: 'REN-002' }),
      row({ finding_id: 'F3', detector_id: 'REN-001' }),
    ]);
    expect(rows[0].detectors.sort()).toEqual(['REN-001', 'REN-002']);
  });

  it('caps sample_finding_ids at 20', () => {
    const inputs: FindingWithTrace[] = [];
    for (let i = 0; i < 35; i += 1) {
      inputs.push(row({ finding_id: `F${i}` }));
    }
    const rows = aggregateAttribution(inputs);
    expect(rows[0].finding_count).toBe(35);
    expect(rows[0].sample_finding_ids).toHaveLength(20);
  });

  it('rounds total_gap_usd to 2 decimals (defends against float drift)', () => {
    const rows = aggregateAttribution([
      row({ finding_id: 'F1', gap_usd: 0.1 }),
      row({ finding_id: 'F2', gap_usd: 0.2 }),
    ]);
    expect(rows[0].total_gap_usd).toBe(0.3); // not 0.30000000000000004
  });

  it('handles null root_config_id consistently', () => {
    // Some attributions point at an object that has a name but no ID
    // (e.g., a Flow that's only identifiable by DeveloperName).
    const rows = aggregateAttribution([
      row({ finding_id: 'F1', root_config_id: null }),
      row({ finding_id: 'F2', root_config_id: null }),
    ]);
    // Both should group together as the same null-id root.
    expect(rows).toHaveLength(1);
    expect(rows[0].finding_count).toBe(2);
  });
});
