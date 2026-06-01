/**
 * ORD-FOR-003 — Amendment Q↔O variance detector + tracer + recovery +
 * verifier.
 *
 * Coverage:
 *   1. Direct delta math (Layer 1)
 *   2. Cross-validation against prior Orders (Layer 2)
 *   3. Proration carve-out (Layer 3)
 *   4. Data-quality smoking gun (Existing flag mis-set)
 *   5. Attribution competition: Class E wins when data-quality suspect;
 *      Class B wins when manual-edit signal; Class A default.
 *   6. Recovery payload across all 3 modes.
 *   7. Verifier across all 3 recovery modes.
 */

import { describe, it, expect, vi } from 'vitest';
import ORD_FOR_003 from '@/lib/forensics/detectors/ord-for-003-quote-order-variance-amendment';
import CLASS_A_TRACER from '@/lib/forensics/attribution/class-a-system-disconnect';
import CLASS_B_TRACER from '@/lib/forensics/attribution/class-b-manual-override';
import CLASS_E_TRACER from '@/lib/forensics/attribution/class-e-data-quality';
import { buildRecoveryPayload } from '@/lib/forensics/recovery-payload';
import { verifyCommit } from '@/lib/forensics/commit-verifier';
import type { Connection } from 'jsforce';
import type { DetectorContext } from '@/lib/forensics/types';

// ─────────────────────────────────────────────────────────────────────
// Connection mock
// ─────────────────────────────────────────────────────────────────────

interface MockOrgState {
  amendmentQuotes: Array<{
    Id: string;
    Name: string;
    SBQQ__NetAmount__c: number;
    SBQQ__Type__c: string;
    SBQQ__Account__c: string;
    CurrencyIsoCode?: string;
    SBQQ__ProrateMultiplier__c?: number;
  }>;
  quoteLines: Array<{
    Id: string;
    SBQQ__Quote__c: string;
    SBQQ__NetTotal__c: number;
    SBQQ__Existing__c: boolean;
    SBQQ__Product__c: string;
    SBQQ__PartialPeriod__c?: boolean;
  }>;
  orders: Array<{
    Id: string;
    OrderNumber: string;
    TotalAmount: number;
    AccountId: string;
    EffectiveDate: string;
    Status: string;
    CurrencyIsoCode?: string;
    CreatedById: string;
    LastModifiedById: string;
    CreatedDate: string;
    LastModifiedDate: string;
    SBQQ__Quote__c: string;
  }>;
  priorOrders: Array<{ Id: string; AccountId: string; TotalAmount: number; EffectiveDate: string }>;
  orderItems: Array<{
    Id: string;
    OrderId: string;
    UnitPrice: number;
    Quantity: number;
    Product2Id: string;
    Product2: { Name: string };
  }>;
  invoices: Array<{ Id: string; blng__Order__c: string }>;
  billingInstalled: boolean;
  multiCurrency: boolean;
  hasProrate: boolean;
  hasPartialPeriod: boolean;
}

function buildMockConn(state: MockOrgState): Connection {
  const describe = vi.fn().mockImplementation(async (objName: string) => {
    if (objName === 'blng__Invoice__c') {
      if (!state.billingInstalled) throw new Error('Not installed');
      return { fields: [] };
    }
    if (objName === 'SBQQ__Quote__c') {
      const fields: Array<{ name: string }> = [];
      if (state.multiCurrency) fields.push({ name: 'CurrencyIsoCode' });
      if (state.hasProrate) fields.push({ name: 'SBQQ__ProrateMultiplier__c' });
      return { fields };
    }
    if (objName === 'SBQQ__QuoteLine__c') {
      return { fields: state.hasPartialPeriod ? [{ name: 'SBQQ__PartialPeriod__c' }] : [] };
    }
    return { fields: [] };
  });

  const query = vi.fn().mockImplementation(async (soql: string) => {
    if (soql.includes('FROM SBQQ__Quote__c') && soql.includes("SBQQ__Type__c = 'Amendment'")) {
      return { records: state.amendmentQuotes };
    }
    if (soql.includes('FROM SBQQ__QuoteLine__c')) {
      const matches = soql.match(/'([a-zA-Z0-9]+)'/g) ?? [];
      const ids = new Set(matches.map((m) => m.slice(1, -1)));
      return { records: state.quoteLines.filter((l) => ids.has(l.SBQQ__Quote__c)) };
    }
    if (soql.includes('FROM Order') && soql.includes('AccountId IN')) {
      // Prior orders query — match by AccountId.
      const matches = soql.match(/'([a-zA-Z0-9]+)'/g) ?? [];
      const ids = new Set(matches.map((m) => m.slice(1, -1)));
      // Return BOTH prior + amendment orders; detector filters out
      // amendment orders by ID.
      return {
        records: [
          ...state.priorOrders.filter((p) => ids.has(p.AccountId)),
          ...state.orders.filter((o) => ids.has(o.AccountId)),
        ],
      };
    }
    if (soql.includes('FROM Order')) {
      const matches = soql.match(/'([a-zA-Z0-9]+)'/g) ?? [];
      const ids = new Set(matches.map((m) => m.slice(1, -1)));
      return { records: state.orders.filter((o) => ids.has(o.SBQQ__Quote__c)) };
    }
    if (soql.includes('FROM OrderItem')) {
      const matches = soql.match(/'([a-zA-Z0-9]+)'/g) ?? [];
      const ids = new Set(matches.map((m) => m.slice(1, -1)));
      return { records: state.orderItems.filter((i) => ids.has(i.OrderId)) };
    }
    if (soql.includes('FROM blng__Invoice__c')) {
      const matches = soql.match(/'([a-zA-Z0-9]+)'/g) ?? [];
      const ids = new Set(matches.map((m) => m.slice(1, -1)));
      return { records: state.invoices.filter((inv) => ids.has(inv.blng__Order__c)) };
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

const baseState = (over: Partial<MockOrgState> = {}): MockOrgState => ({
  amendmentQuotes: [],
  quoteLines: [],
  orders: [],
  priorOrders: [],
  orderItems: [],
  invoices: [],
  billingInstalled: false,
  multiCurrency: false,
  hasProrate: false,
  hasPartialPeriod: false,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────
// Detector tests
// ─────────────────────────────────────────────────────────────────────

describe('ORD-FOR-003 detector — direct delta math', () => {
  it('clean when Order total matches sum of new (Existing=false) lines', async () => {
    const state = baseState({
      amendmentQuotes: [{ Id: 'Q1', Name: 'Q-AM-1', SBQQ__NetAmount__c: 5000, SBQQ__Type__c: 'Amendment', SBQQ__Account__c: 'A1' }],
      quoteLines: [
        { Id: 'QL1', SBQQ__Quote__c: 'Q1', SBQQ__NetTotal__c: 4000, SBQQ__Existing__c: true, SBQQ__Product__c: 'P1' },
        { Id: 'QL2', SBQQ__Quote__c: 'Q1', SBQQ__NetTotal__c: 1000, SBQQ__Existing__c: false, SBQQ__Product__c: 'P2' },
      ],
      orders: [{ Id: 'O1', OrderNumber: 'O-AM-1', TotalAmount: 1000, AccountId: 'A1', EffectiveDate: '2026-04-01', Status: 'Activated', CreatedById: 'U1', LastModifiedById: 'U1', CreatedDate: '2026-04-01T10:00Z', LastModifiedDate: '2026-04-01T10:05Z', SBQQ__Quote__c: 'Q1' }],
    });
    const findings = await ORD_FOR_003.run(ctx(buildMockConn(state)));
    expect(findings).toEqual([]);
  });

  it('flags variance when Order total != sum of new lines', async () => {
    const state = baseState({
      amendmentQuotes: [{ Id: 'Q1', Name: 'Q-AM-1', SBQQ__NetAmount__c: 5000, SBQQ__Type__c: 'Amendment', SBQQ__Account__c: 'A1' }],
      quoteLines: [
        { Id: 'QL1', SBQQ__Quote__c: 'Q1', SBQQ__NetTotal__c: 4000, SBQQ__Existing__c: true, SBQQ__Product__c: 'P1' },
        { Id: 'QL2', SBQQ__Quote__c: 'Q1', SBQQ__NetTotal__c: 1000, SBQQ__Existing__c: false, SBQQ__Product__c: 'P2' },
      ],
      orders: [{ Id: 'O1', OrderNumber: 'O-AM-1', TotalAmount: 800, AccountId: 'A1', EffectiveDate: '2026-04-01', Status: 'Activated', CreatedById: 'U1', LastModifiedById: 'U1', CreatedDate: '2026-04-01T10:00Z', LastModifiedDate: '2026-04-01T10:05Z', SBQQ__Quote__c: 'Q1' }],
    });
    const findings = await ORD_FOR_003.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(1);
    expect(findings[0].gapUsd).toBe(200);
    expect(findings[0].metadata?.expected_delta).toBe(1000);
    expect(findings[0].metadata?.direction).toBe('under_billed');
  });

  it('detects data-quality smoking gun — Existing=false for product with existing-flagged sibling', async () => {
    const state = baseState({
      amendmentQuotes: [{ Id: 'Q1', Name: 'Q-AM-1', SBQQ__NetAmount__c: 5000, SBQQ__Type__c: 'Amendment', SBQQ__Account__c: 'A1' }],
      quoteLines: [
        { Id: 'QL1', SBQQ__Quote__c: 'Q1', SBQQ__NetTotal__c: 4000, SBQQ__Existing__c: true, SBQQ__Product__c: 'P1' },
        // Suspect: marked Existing=false but P1 is already existing on QL1
        { Id: 'QL_SUSPECT', SBQQ__Quote__c: 'Q1', SBQQ__NetTotal__c: 1000, SBQQ__Existing__c: false, SBQQ__Product__c: 'P1' },
      ],
      orders: [{ Id: 'O1', OrderNumber: 'O-AM-1', TotalAmount: 800, AccountId: 'A1', EffectiveDate: '2026-04-01', Status: 'Activated', CreatedById: 'U1', LastModifiedById: 'U1', CreatedDate: '2026-04-01T10:00Z', LastModifiedDate: '2026-04-01T10:05Z', SBQQ__Quote__c: 'Q1' }],
    });
    const findings = await ORD_FOR_003.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(1);
    expect(findings[0].metadata?.recovery_mode).toBe('data_quality_fix');
    expect(findings[0].metadata?.existing_flag_suspect_line_ids).toEqual(['QL_SUSPECT']);
    expect(findings[0].recoverabilityScore).toBe(0.95);
  });

  it('flags proration_active=true when partial-period lines present', async () => {
    const state = baseState({
      hasPartialPeriod: true,
      amendmentQuotes: [{ Id: 'Q1', Name: 'Q-AM-1', SBQQ__NetAmount__c: 5000, SBQQ__Type__c: 'Amendment', SBQQ__Account__c: 'A1' }],
      quoteLines: [
        { Id: 'QL1', SBQQ__Quote__c: 'Q1', SBQQ__NetTotal__c: 1000, SBQQ__Existing__c: false, SBQQ__Product__c: 'P1', SBQQ__PartialPeriod__c: true },
      ],
      orders: [{ Id: 'O1', OrderNumber: 'O-AM-1', TotalAmount: 800, AccountId: 'A1', EffectiveDate: '2026-04-01', Status: 'Activated', CreatedById: 'U1', LastModifiedById: 'U1', CreatedDate: '2026-04-01T10:00Z', LastModifiedDate: '2026-04-01T10:05Z', SBQQ__Quote__c: 'Q1' }],
    });
    const findings = await ORD_FOR_003.run(ctx(buildMockConn(state)));
    expect(findings[0].metadata?.proration_active).toBe(true);
    expect(findings[0].recoverabilityScore).toBe(0.7); // softer recoverability
  });
});

// ─────────────────────────────────────────────────────────────────────
// Attribution competition
// ─────────────────────────────────────────────────────────────────────

const stubCtx = {} as unknown as DetectorContext;

function ord003Finding(over: Record<string, unknown> = {}) {
  return {
    detectorId: 'ORD-FOR-003',
    severity: 'warning' as const,
    entitledUsd: 1000,
    realizedUsd: 800,
    gapUsd: 200,
    currencyIsoCode: 'USD',
    recoverabilityScore: 0.85,
    primaryRecord: { type: 'Order', id: 'O1', name: 'O-AM-1' },
    supportingRecords: [],
    title: 'Amendment under-billed',
    metadata: {
      quote_id: 'Q1',
      quote_name: 'Q-AM-1',
      expected_delta: 1000,
      order_ids: ['O1'],
      order_total_sum: 800,
      variance_amount: -200,
      direction: 'under_billed',
      manually_edited: false,
      existing_flag_suspect_line_ids: [] as string[],
      recovery_mode: 'pre_invoice_patch',
      proration_active: false,
      cross_validated: false,
      ...over,
    },
  };
}

describe('ORD-FOR-003 attribution competition', () => {
  it('Class E wins with 0.95 when data-quality suspect present', async () => {
    const f = ord003Finding({ existing_flag_suspect_line_ids: ['QL_SUSPECT'] });
    const e = await CLASS_E_TRACER.trace(f, stubCtx);
    expect(e[0].rootCauseClass).toBe('E');
    expect(e[0].confidence).toBe(0.95);
    expect(e[0].reasonCode).toBe('AMENDMENT_EXISTING_FLAG_MISCONFIGURED');

    // Class A should be present but quieted to 0.4 — beat by Class E.
    const a = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(a[0].confidence).toBe(0.4);
  });

  it('Class B wins at 0.9 when manual-edit signal alone', async () => {
    const f = ord003Finding({ manually_edited: true });
    const b = await CLASS_B_TRACER.trace(f, stubCtx);
    expect(b[0].rootCauseClass).toBe('B');
    expect(b[0].confidence).toBe(0.9);

    // Class A drops to 0.5
    const a = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(a[0].confidence).toBe(0.5);
  });

  it('Class A wins at 0.85 in the default case', async () => {
    const f = ord003Finding();
    const a = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(a[0].confidence).toBe(0.85);
    expect(a[0].reasonCode).toBe('AMENDMENT_DELTA_MISMATCH');
  });

  it('cross-validation lifts Class A confidence by 0.05', async () => {
    const f = ord003Finding({ cross_validated: true });
    const a = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(a[0].confidence).toBe(0.9); // 0.85 + 0.05
  });

  it('proration drops Class A confidence by 0.10', async () => {
    const f = ord003Finding({ proration_active: true });
    const a = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(a[0].confidence).toBeCloseTo(0.75, 2); // 0.85 - 0.10
  });

  it('Class E silent when no data-quality suspect', async () => {
    const f = ord003Finding();
    const e = await CLASS_E_TRACER.trace(f, stubCtx);
    expect(e).toEqual([]);
  });

  it('Class B silent when no manual-edit', async () => {
    const f = ord003Finding();
    const b = await CLASS_B_TRACER.trace(f, stubCtx);
    expect(b).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Recovery payload
// ─────────────────────────────────────────────────────────────────────

describe('ORD-FOR-003 recovery payload', () => {
  function payloadFixture(over: Record<string, unknown> = {}) {
    return {
      id: 'F1',
      detector_id: 'ORD-FOR-003',
      gap_usd: 200,
      recoverability_score: 0.85,
      currency_iso_code: 'USD',
      title: 'Amendment under-billed',
      description: null,
      source_record_refs: { primary_record: { type: 'Order', id: 'O1', name: 'O-AM-1' } },
      metadata: {
        quote_name: 'Q-AM-1',
        expected_delta: 1000,
        order_total_sum: 800,
        variance_amount: -200,
        direction: 'under_billed',
        recovery_mode: 'pre_invoice_patch',
        existing_flag_suspect_line_ids: [] as string[],
        line_breakdown: [
          { order_item_id: 'OI1', product_name: 'Widget', unit_price: 400, quantity: 1, line_total: 400 },
          { order_item_id: 'OI2', product_name: 'Gadget', unit_price: 400, quantity: 1, line_total: 400 },
        ],
        ...over,
      },
    };
  }

  it('data_quality_fix mode emits SBQQ__Existing__c=true patch CSV', async () => {
    const p = buildRecoveryPayload(
      payloadFixture({
        recovery_mode: 'data_quality_fix',
        existing_flag_suspect_line_ids: ['QL_S1', 'QL_S2'],
      })
    );
    expect(p.csvHeader).toBe('Id,SBQQ__Existing__c,RecoveryNotes');
    expect(p.csvRow).toContain('QL_S1,true');
    expect(p.csvRow).toContain('QL_S2,true');
    expect(p.actionLabel).toContain('re-activate');
  });

  it('pre_invoice_patch mode scales line UnitPrices toward expected_delta', async () => {
    const p = buildRecoveryPayload(payloadFixture());
    // Factor = 1000/800 = 1.25 → $400 lines become $500.
    expect(p.csvHeader).toBe('Id,UnitPrice,RecoveryNotes');
    expect(p.csvRow).toContain('OI1,500.00');
    expect(p.csvRow).toContain('OI2,500.00');
  });

  it('post_invoice mode emits manual-review CSV', async () => {
    const p = buildRecoveryPayload(
      payloadFixture({ recovery_mode: 'post_invoice_manual_review' })
    );
    expect(p.csvHeader).toContain('Action');
    expect(p.csvRow).toContain('IssueDebitMemo');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Verifier
// ─────────────────────────────────────────────────────────────────────

describe('ORD-FOR-003 verifier', () => {
  function baseFinding(over: Record<string, unknown> = {}) {
    return {
      id: 'F1',
      detector_id: 'ORD-FOR-003',
      source_record_refs: { primary_record: { type: 'Order', id: 'O1', name: 'O-AM-1' } },
      metadata: {
        expected_delta: 1000,
        order_ids: ['O1'],
        recovery_mode: 'pre_invoice_patch',
        existing_flag_suspect_line_ids: [] as string[],
        ...over,
      },
    };
  }

  function mockConn(records: Array<Record<string, unknown>>) {
    return {
      query: vi.fn().mockResolvedValue({ records }),
    } as unknown as Connection;
  }

  it('pre_invoice mode: verified when Order sum matches expected_delta', async () => {
    const v = await verifyCommit(baseFinding(), mockConn([{ TotalAmount: 1000 }]));
    expect(v?.verified).toBe(true);
  });

  it('pre_invoice mode: NOT verified when sum still differs', async () => {
    const v = await verifyCommit(baseFinding(), mockConn([{ TotalAmount: 850 }]));
    expect(v?.verified).toBe(false);
    expect(v?.message).toContain('850');
  });

  it('data_quality_fix mode: verified when all suspect lines have Existing=true', async () => {
    const v = await verifyCommit(
      baseFinding({
        recovery_mode: 'data_quality_fix',
        existing_flag_suspect_line_ids: ['QL_S1', 'QL_S2'],
      }),
      mockConn([{ SBQQ__Existing__c: true }, { SBQQ__Existing__c: true }])
    );
    expect(v?.verified).toBe(true);
  });

  it('data_quality_fix mode: NOT verified when some lines still Existing=false', async () => {
    const v = await verifyCommit(
      baseFinding({
        recovery_mode: 'data_quality_fix',
        existing_flag_suspect_line_ids: ['QL_S1', 'QL_S2'],
      }),
      mockConn([{ SBQQ__Existing__c: true }, { SBQQ__Existing__c: false }])
    );
    expect(v?.verified).toBe(false);
    expect(v?.message).toContain('1 of 2');
  });

  it('post_invoice mode: returns manual-review-only message, no auto-verify', async () => {
    const v = await verifyCommit(
      baseFinding({ recovery_mode: 'post_invoice_manual_review' }),
      mockConn([])
    );
    expect(v?.verified).toBe(false);
    expect(v?.message).toContain('manual');
  });
});
