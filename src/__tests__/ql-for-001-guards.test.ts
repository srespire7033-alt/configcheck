/**
 * QL-FOR-001 guard logic — verifies the 4-guard system correctly
 * separates real leakage from intentional bundle inclusions.
 */

import { describe, it, expect, vi } from 'vitest';
import QL_FOR_001 from '@/lib/forensics/detectors/ql-for-001-bundle-option-free';
import type { Connection } from 'jsforce';
import type { DetectorContext } from '@/lib/forensics/types';

interface QlState {
  candidateLines: Array<{
    Id: string;
    Name: string;
    SBQQ__Quote__c: string;
    SBQQ__Quote__r: { Name: string };
    SBQQ__RequiredBy__c: string;
    SBQQ__RequiredBy__r?: { SBQQ__NetTotal__c: number | null };
    SBQQ__Product__c: string;
    SBQQ__Product__r: { Name: string };
    SBQQ__NetPrice__c: number;
    SBQQ__ListPrice__c: number;
    SBQQ__Quantity__c: number;
    SBQQ__Bundled__c?: boolean;
    CreatedDate: string;
  }>;
  pbe: Array<{ Id: string; Product2Id: string; UnitPrice: number }>;
  paidCounts: Array<{ SBQQ__Product__c: string; paid_count: number }>;
  hasBundledField: boolean;
}

function buildMockConn(state: QlState): Connection {
  const describe = vi.fn().mockImplementation(async () => ({
    fields: state.hasBundledField ? [{ name: 'SBQQ__Bundled__c' }] : [],
  }));
  const query = vi.fn().mockImplementation(async (soql: string) => {
    if (soql.includes('FROM SBQQ__QuoteLine__c') && soql.includes('SBQQ__RequiredBy__c != null')) {
      return { records: state.candidateLines };
    }
    if (soql.includes('FROM PricebookEntry')) {
      return { records: state.pbe };
    }
    if (soql.includes('SBQQ__NetPrice__c > 0') && soql.includes('GROUP BY SBQQ__Product__c')) {
      return { records: state.paidCounts };
    }
    return { records: [] };
  });
  return { describe, query } as unknown as Connection;
}

function ctx(conn: Connection): DetectorContext {
  return {
    conn,
    organizationId: 'org-1',
    defaultCurrencyIsoCode: 'USD',
    snapshots: new Map(),
  };
}

const baseLine = (over: Partial<QlState['candidateLines'][number]>): QlState['candidateLines'][number] => ({
  Id: 'QL1',
  Name: 'QL-1',
  SBQQ__Quote__c: 'Q1',
  SBQQ__Quote__r: { Name: 'Q-001' },
  SBQQ__RequiredBy__c: 'PARENT1',
  SBQQ__RequiredBy__r: { SBQQ__NetTotal__c: 0 },
  SBQQ__Product__c: 'P1',
  SBQQ__Product__r: { Name: 'Widget' },
  SBQQ__NetPrice__c: 0,
  SBQQ__ListPrice__c: 100,
  SBQQ__Quantity__c: 1,
  CreatedDate: new Date().toISOString(),
  ...over,
});

describe('QL-FOR-001 — Guard 1 (SBQQ__Bundled__c)', () => {
  it('skips lines where CPQ marked SBQQ__Bundled__c = true', async () => {
    const state: QlState = {
      candidateLines: [baseLine({ SBQQ__Bundled__c: true })],
      pbe: [{ Id: 'PBE1', Product2Id: 'P1', UnitPrice: 100 }],
      paidCounts: [{ SBQQ__Product__c: 'P1', paid_count: 5 }],
      hasBundledField: true,
    };
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(0);
  });

  it('does NOT skip when SBQQ__Bundled__c is false or unset', async () => {
    const state: QlState = {
      candidateLines: [baseLine({ SBQQ__Bundled__c: false })],
      pbe: [{ Id: 'PBE1', Product2Id: 'P1', UnitPrice: 100 }],
      paidCounts: [{ SBQQ__Product__c: 'P1', paid_count: 5 }],
      hasBundledField: true,
    };
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(1);
  });

  it('Guard 1 inactive when SBQQ__Bundled__c field absent from org', async () => {
    const state: QlState = {
      candidateLines: [baseLine({ SBQQ__Bundled__c: true })],
      pbe: [{ Id: 'PBE1', Product2Id: 'P1', UnitPrice: 100 }],
      paidCounts: [{ SBQQ__Product__c: 'P1', paid_count: 5 }],
      hasBundledField: false,
    };
    // Field doesn't exist in describe → Guard 1 doesn't check it,
    // line falls through to other guards and still gets flagged.
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(1);
  });
});

describe('QL-FOR-001 — Guard 2 (parent covers option)', () => {
  it('skips when parent NetTotal >= option_list × qty × 0.95', async () => {
    const state: QlState = {
      candidateLines: [baseLine({
        SBQQ__Quantity__c: 10,
        SBQQ__RequiredBy__r: { SBQQ__NetTotal__c: 1000 }, // covers $100 × 10 = $1000
      })],
      pbe: [{ Id: 'PBE1', Product2Id: 'P1', UnitPrice: 100 }],
      paidCounts: [{ SBQQ__Product__c: 'P1', paid_count: 5 }],
      hasBundledField: true,
    };
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(0);
  });

  it('allows 5% slack — parent at 95% of expected still skips', async () => {
    const state: QlState = {
      candidateLines: [baseLine({
        SBQQ__Quantity__c: 10,
        SBQQ__RequiredBy__r: { SBQQ__NetTotal__c: 950 }, // 95% of $1000
      })],
      pbe: [{ Id: 'PBE1', Product2Id: 'P1', UnitPrice: 100 }],
      paidCounts: [{ SBQQ__Product__c: 'P1', paid_count: 5 }],
      hasBundledField: true,
    };
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(0);
  });

  it('flags when parent only covers less than 95%', async () => {
    const state: QlState = {
      candidateLines: [baseLine({
        SBQQ__Quantity__c: 10,
        SBQQ__RequiredBy__r: { SBQQ__NetTotal__c: 800 }, // 80% of $1000 — not enough
      })],
      pbe: [{ Id: 'PBE1', Product2Id: 'P1', UnitPrice: 100 }],
      paidCounts: [{ SBQQ__Product__c: 'P1', paid_count: 5 }],
      hasBundledField: true,
    };
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(1);
  });
});

describe('QL-FOR-001 — Guard 3 (unresolved price)', () => {
  it('emits as unresolved_price when both line and PBE have $0 list', async () => {
    const state: QlState = {
      candidateLines: [baseLine({ SBQQ__ListPrice__c: 0 })],
      pbe: [{ Id: 'PBE1', Product2Id: 'P1', UnitPrice: 0 }],
      paidCounts: [],
      hasBundledField: true,
    };
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(1);
    expect(findings[0].metadata?.sub_case).toBe('unresolved_price');
    expect(findings[0].gapUsd).toBe(0);
    expect(findings[0].recoverabilityScore).toBe(0.3);
  });

  it('prefers PBE list price over line list price', async () => {
    const state: QlState = {
      candidateLines: [baseLine({ SBQQ__ListPrice__c: 50, SBQQ__Quantity__c: 2 })],
      pbe: [{ Id: 'PBE1', Product2Id: 'P1', UnitPrice: 100 }], // current Pricebook is higher
      paidCounts: [{ SBQQ__Product__c: 'P1', paid_count: 5 }],
      hasBundledField: true,
    };
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(1);
    expect(findings[0].gapUsd).toBe(200); // 100 × 2, not 50 × 2
  });
});

describe('QL-FOR-001 — Guard 4 (paid elsewhere = confidence)', () => {
  it('emits as price_override_missing with recoverability 0.9 when product paid elsewhere', async () => {
    const state: QlState = {
      candidateLines: [baseLine({})],
      pbe: [{ Id: 'PBE1', Product2Id: 'P1', UnitPrice: 100 }],
      paidCounts: [{ SBQQ__Product__c: 'P1', paid_count: 5 }],
      hasBundledField: true,
    };
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    expect(findings[0].metadata?.sub_case).toBe('price_override_missing');
    expect(findings[0].recoverabilityScore).toBe(0.9);
  });

  it('emits as isolated_free_option with recoverability 0.6 when product never paid', async () => {
    const state: QlState = {
      candidateLines: [baseLine({})],
      pbe: [{ Id: 'PBE1', Product2Id: 'P1', UnitPrice: 100 }],
      paidCounts: [], // never paid anywhere
      hasBundledField: true,
    };
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    expect(findings[0].metadata?.sub_case).toBe('isolated_free_option');
    expect(findings[0].recoverabilityScore).toBe(0.6);
  });

  it('captures paid_count_elsewhere in metadata for transparency', async () => {
    const state: QlState = {
      candidateLines: [baseLine({})],
      pbe: [{ Id: 'PBE1', Product2Id: 'P1', UnitPrice: 100 }],
      paidCounts: [{ SBQQ__Product__c: 'P1', paid_count: 12 }],
      hasBundledField: true,
    };
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    expect(findings[0].metadata?.paid_count_elsewhere).toBe(12);
  });
});

describe('QL-FOR-001 — combined scenarios', () => {
  it('mixed batch: each line takes the right path', async () => {
    const state: QlState = {
      candidateLines: [
        // GUARD 1 hit — should skip
        baseLine({ Id: 'A', SBQQ__Bundled__c: true }),
        // GUARD 2 hit — parent covers $200 (2 × $100)
        baseLine({ Id: 'B', SBQQ__Quantity__c: 2, SBQQ__RequiredBy__r: { SBQQ__NetTotal__c: 200 } }),
        // High-confidence flag — product paid elsewhere
        baseLine({ Id: 'C', SBQQ__Quantity__c: 5 }),
        // Unresolved — no PBE
        baseLine({ Id: 'D', SBQQ__Product__c: 'P_NO_PRICE', SBQQ__ListPrice__c: 0 }),
      ],
      pbe: [
        { Id: 'PBE1', Product2Id: 'P1', UnitPrice: 100 },
        // P_NO_PRICE deliberately absent
      ],
      paidCounts: [{ SBQQ__Product__c: 'P1', paid_count: 3 }],
      hasBundledField: true,
    };
    const findings = await QL_FOR_001.run(ctx(buildMockConn(state)));
    // Expect: A skipped, B skipped, C flagged, D unresolved → 2 findings
    expect(findings).toHaveLength(2);
    const byId = new Map(findings.map((f) => [f.primaryRecord.id, f]));
    expect(byId.get('C')?.metadata?.sub_case).toBe('price_override_missing');
    expect(byId.get('D')?.metadata?.sub_case).toBe('unresolved_price');
  });
});
