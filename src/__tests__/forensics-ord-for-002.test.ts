/**
 * ORD-FOR-002 — Quote↔Order variance (new business) detector + Class A/B
 * attribution + recovery payload.
 *
 * Test goals:
 *   1. The detector emits zero findings when totals match exactly.
 *   2. It absorbs sub-cent float drift but flags anything bigger.
 *   3. Sums across split Orders (one Quote → N Orders) before comparing.
 *   4. Tags direction (under vs over) correctly.
 *   5. Flags recovery_mode = post_invoice when an Invoice exists.
 *   6. Skips cross-currency pairs.
 *   7. Filters out Amendment/Renewal-type quotes.
 *   8. Class A tracer claims with elevated confidence when no manual-edit
 *      signal, Class B competes (and wins) when the signal is present.
 *   9. Recovery payload distributes variance proportionally across
 *      OrderItems for the pre-invoice case; post-invoice case emits a
 *      manual-review CSV instead of a patch.
 */

import { describe, it, expect, vi } from 'vitest';
import ORD_FOR_002 from '@/lib/forensics/detectors/ord-for-002-quote-order-variance';
import CLASS_A_TRACER from '@/lib/forensics/attribution/class-a-system-disconnect';
import CLASS_B_TRACER from '@/lib/forensics/attribution/class-b-manual-override';
import { buildRecoveryPayload } from '@/lib/forensics/recovery-payload';
import type { Connection } from 'jsforce';
import type { DetectorContext } from '@/lib/forensics/types';

// ─────────────────────────────────────────────────────────────────────
// Connection mock harness
// ─────────────────────────────────────────────────────────────────────

interface FakeOrder {
  Id: string;
  OrderNumber: string;
  TotalAmount: number;
  AccountId: string;
  EffectiveDate: string;
  Status: 'Activated';
  CurrencyIsoCode?: string;
  CreatedById: string;
  LastModifiedById: string;
  CreatedDate: string;
  LastModifiedDate: string;
  SBQQ__Quote__c: string;
  SBQQ__Quote__r: {
    Id: string;
    Name: string;
    SBQQ__NetAmount__c: number;
    SBQQ__Type__c: string | null;
    SBQQ__Account__c: string | null;
    CurrencyIsoCode?: string;
  };
}

interface FakeOrderItem {
  Id: string;
  OrderId: string;
  UnitPrice: number;
  Quantity: number;
  Product2Id: string;
  Product2: { Name: string };
  SBQQ__QuoteLine__c: string | null;
}

interface FakeInvoice {
  Id: string;
  blng__Order__c: string;
}

interface MockOrgState {
  orders: FakeOrder[];
  items: FakeOrderItem[];
  invoices: FakeInvoice[];
  billingInstalled: boolean;
  multiCurrency: boolean;
}

function buildMockConn(state: MockOrgState): Connection {
  const describe = vi.fn().mockImplementation(async (objName: string) => {
    if (objName === 'blng__Invoice__c') {
      if (!state.billingInstalled) throw new Error('Not installed');
      return { fields: [] };
    }
    if (objName === 'Order') {
      return {
        fields: state.multiCurrency ? [{ name: 'CurrencyIsoCode' }] : [],
      };
    }
    return { fields: [] };
  });

  const query = vi.fn().mockImplementation(async (soql: string) => {
    if (soql.includes('FROM Order') && soql.includes('Status = \'Activated\'')) {
      return { records: state.orders };
    }
    if (soql.includes('FROM OrderItem')) {
      const matches = soql.match(/'([a-zA-Z0-9]+)'/g) ?? [];
      const ids = new Set(matches.map((m) => m.slice(1, -1)));
      return { records: state.items.filter((it) => ids.has(it.OrderId)) };
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

// ─────────────────────────────────────────────────────────────────────
// Test data factory
// ─────────────────────────────────────────────────────────────────────

function makeOrder(over: Partial<FakeOrder>): FakeOrder {
  return {
    Id: 'O1',
    OrderNumber: 'O-001',
    TotalAmount: 1000,
    AccountId: 'A1',
    EffectiveDate: '2026-04-01',
    Status: 'Activated',
    CreatedById: 'U1',
    LastModifiedById: 'U1',
    CreatedDate: '2026-04-01T10:00:00Z',
    LastModifiedDate: '2026-04-01T10:05:00Z',
    SBQQ__Quote__c: 'Q1',
    SBQQ__Quote__r: {
      Id: 'Q1',
      Name: 'Q-001',
      SBQQ__NetAmount__c: 1000,
      SBQQ__Type__c: 'Quote',
      SBQQ__Account__c: 'A1',
    },
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Detector tests
// ─────────────────────────────────────────────────────────────────────

describe('ORD-FOR-002 detector', () => {
  it('emits zero findings when Order total matches Quote Net exactly', async () => {
    const state: MockOrgState = {
      orders: [makeOrder({ TotalAmount: 1000, SBQQ__Quote__r: { Id: 'Q1', Name: 'Q-001', SBQQ__NetAmount__c: 1000, SBQQ__Type__c: 'Quote', SBQQ__Account__c: 'A1' } })],
      items: [],
      invoices: [],
      billingInstalled: false,
      multiCurrency: false,
    };
    const findings = await ORD_FOR_002.run(ctx(buildMockConn(state)));
    expect(findings).toEqual([]);
  });

  it('absorbs sub-cent float drift', async () => {
    const state: MockOrgState = {
      orders: [makeOrder({ TotalAmount: 1000.005, SBQQ__Quote__r: { Id: 'Q1', Name: 'Q-001', SBQQ__NetAmount__c: 1000, SBQQ__Type__c: 'Quote', SBQQ__Account__c: 'A1' } })],
      items: [],
      invoices: [],
      billingInstalled: false,
      multiCurrency: false,
    };
    const findings = await ORD_FOR_002.run(ctx(buildMockConn(state)));
    expect(findings).toEqual([]);
  });

  it('flags under-billed orders', async () => {
    const state: MockOrgState = {
      orders: [makeOrder({ TotalAmount: 800, SBQQ__Quote__r: { Id: 'Q1', Name: 'Q-001', SBQQ__NetAmount__c: 1000, SBQQ__Type__c: 'Quote', SBQQ__Account__c: 'A1' } })],
      items: [{ Id: 'I1', OrderId: 'O1', UnitPrice: 800, Quantity: 1, Product2Id: 'P1', Product2: { Name: 'Widget' }, SBQQ__QuoteLine__c: 'QL1' }],
      invoices: [],
      billingInstalled: false,
      multiCurrency: false,
    };
    const findings = await ORD_FOR_002.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(1);
    expect(findings[0].gapUsd).toBe(200);
    expect(findings[0].metadata?.direction).toBe('under_billed');
    expect(findings[0].title).toContain('under-billed');
  });

  it('flags over-billed orders (compliance angle)', async () => {
    const state: MockOrgState = {
      orders: [makeOrder({ TotalAmount: 1200, SBQQ__Quote__r: { Id: 'Q1', Name: 'Q-001', SBQQ__NetAmount__c: 1000, SBQQ__Type__c: 'Quote', SBQQ__Account__c: 'A1' } })],
      items: [{ Id: 'I1', OrderId: 'O1', UnitPrice: 1200, Quantity: 1, Product2Id: 'P1', Product2: { Name: 'Widget' }, SBQQ__QuoteLine__c: 'QL1' }],
      invoices: [],
      billingInstalled: false,
      multiCurrency: false,
    };
    const findings = await ORD_FOR_002.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(1);
    expect(findings[0].gapUsd).toBe(200);
    expect(findings[0].metadata?.direction).toBe('over_billed');
    expect(findings[0].title).toContain('over-billed');
  });

  it('sums split Orders before comparing to one Quote', async () => {
    // One Quote at $1000 → two Orders at $400 + $400. Sum = $800, gap = $200 under.
    const state: MockOrgState = {
      orders: [
        makeOrder({ Id: 'O1', OrderNumber: 'O-A', TotalAmount: 400, SBQQ__Quote__c: 'Q1', SBQQ__Quote__r: { Id: 'Q1', Name: 'Q-001', SBQQ__NetAmount__c: 1000, SBQQ__Type__c: 'Quote', SBQQ__Account__c: 'A1' } }),
        makeOrder({ Id: 'O2', OrderNumber: 'O-B', TotalAmount: 400, SBQQ__Quote__c: 'Q1', SBQQ__Quote__r: { Id: 'Q1', Name: 'Q-001', SBQQ__NetAmount__c: 1000, SBQQ__Type__c: 'Quote', SBQQ__Account__c: 'A1' } }),
      ],
      items: [],
      invoices: [],
      billingInstalled: false,
      multiCurrency: false,
    };
    const findings = await ORD_FOR_002.run(ctx(buildMockConn(state)));
    expect(findings).toHaveLength(1); // one per Quote, not per Order
    expect(findings[0].gapUsd).toBe(200);
    expect((findings[0].metadata?.order_ids as string[]).length).toBe(2);
  });

  it('flags post-invoice findings with recovery_mode = manual_review', async () => {
    const state: MockOrgState = {
      orders: [makeOrder({ TotalAmount: 800, SBQQ__Quote__r: { Id: 'Q1', Name: 'Q-001', SBQQ__NetAmount__c: 1000, SBQQ__Type__c: 'Quote', SBQQ__Account__c: 'A1' } })],
      items: [],
      invoices: [{ Id: 'INV1', blng__Order__c: 'O1' }],
      billingInstalled: true,
      multiCurrency: false,
    };
    const findings = await ORD_FOR_002.run(ctx(buildMockConn(state)));
    expect(findings[0].metadata?.recovery_mode).toBe('post_invoice_manual_review');
    expect(findings[0].metadata?.has_invoices).toBe(true);
    // Recoverability drops sharply when post-invoice — can't auto-patch.
    expect(findings[0].recoverabilityScore).toBe(0.3);
  });

  it('skips cross-currency Quote↔Order pairs', async () => {
    const state: MockOrgState = {
      orders: [
        makeOrder({
          TotalAmount: 800,
          CurrencyIsoCode: 'EUR',
          SBQQ__Quote__r: { Id: 'Q1', Name: 'Q-001', SBQQ__NetAmount__c: 1000, SBQQ__Type__c: 'Quote', SBQQ__Account__c: 'A1', CurrencyIsoCode: 'USD' },
        }),
      ],
      items: [],
      invoices: [],
      billingInstalled: false,
      multiCurrency: true,
    };
    const findings = await ORD_FOR_002.run(ctx(buildMockConn(state)));
    expect(findings).toEqual([]);
  });

  it('sets manually_edited when LastModifiedBy differs and edit happened >1h after creation', async () => {
    const state: MockOrgState = {
      orders: [makeOrder({
        TotalAmount: 800,
        CreatedById: 'U1',
        LastModifiedById: 'U2',
        CreatedDate: '2026-04-01T10:00:00Z',
        LastModifiedDate: '2026-04-01T12:00:00Z', // 2 hours later
        SBQQ__Quote__r: { Id: 'Q1', Name: 'Q-001', SBQQ__NetAmount__c: 1000, SBQQ__Type__c: 'Quote', SBQQ__Account__c: 'A1' },
      })],
      items: [],
      invoices: [],
      billingInstalled: false,
      multiCurrency: false,
    };
    const findings = await ORD_FOR_002.run(ctx(buildMockConn(state)));
    expect(findings[0].metadata?.manually_edited).toBe(true);
  });

  it('does NOT set manually_edited when edit by same user', async () => {
    const state: MockOrgState = {
      orders: [makeOrder({
        TotalAmount: 800,
        CreatedById: 'U1',
        LastModifiedById: 'U1',
        CreatedDate: '2026-04-01T10:00:00Z',
        LastModifiedDate: '2026-04-01T15:00:00Z',
        SBQQ__Quote__r: { Id: 'Q1', Name: 'Q-001', SBQQ__NetAmount__c: 1000, SBQQ__Type__c: 'Quote', SBQQ__Account__c: 'A1' },
      })],
      items: [],
      invoices: [],
      billingInstalled: false,
      multiCurrency: false,
    };
    const findings = await ORD_FOR_002.run(ctx(buildMockConn(state)));
    expect(findings[0].metadata?.manually_edited).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Attribution tests
// ─────────────────────────────────────────────────────────────────────

function findingFixture(over: Partial<{ direction: string; manually_edited: boolean; variance_amount: number }>) {
  return {
    detectorId: 'ORD-FOR-002',
    severity: 'critical' as const,
    entitledUsd: 1000,
    realizedUsd: 800,
    gapUsd: 200,
    currencyIsoCode: 'USD',
    recoverabilityScore: 0.9,
    primaryRecord: { type: 'Order', id: 'O1', name: 'O-001' },
    supportingRecords: [],
    title: 'Order under-billed',
    metadata: {
      quote_id: 'Q1',
      quote_name: 'Q-001',
      quote_net_amount: 1000,
      order_ids: ['O1'],
      order_total_sum: 800,
      variance_amount: -200,
      direction: 'under_billed',
      manually_edited: false,
      recovery_mode: 'pre_invoice_patch',
      ...over,
    },
  };
}

const stubCtx = {} as unknown as DetectorContext;

describe('ORD-FOR-002 attribution', () => {
  it('Class A claims at 0.85 when no manual-edit signal', async () => {
    const f = findingFixture({});
    const [c] = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(c.rootCauseClass).toBe('A');
    expect(c.confidence).toBe(0.85);
    expect(c.reasonCode).toBe('QUOTE_ORDER_TOTAL_VARIANCE');
  });

  it('Class A drops to 0.5 when manual-edit signal present', async () => {
    const f = findingFixture({ manually_edited: true });
    const [c] = await CLASS_A_TRACER.trace(f, stubCtx);
    expect(c.confidence).toBe(0.5);
  });

  it('Class B silent when no manual-edit signal', async () => {
    const f = findingFixture({});
    const candidates = await CLASS_B_TRACER.trace(f, stubCtx);
    expect(candidates).toEqual([]);
  });

  it('Class B claims at 0.9 when manual-edit signal present — wins over Class A', async () => {
    const f = findingFixture({ manually_edited: true });
    const [c] = await CLASS_B_TRACER.trace(f, stubCtx);
    expect(c.rootCauseClass).toBe('B');
    expect(c.confidence).toBe(0.9);
    expect(c.reasonCode).toBe('ORDER_EDITED_POST_ACTIVATION');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Recovery payload tests
// ─────────────────────────────────────────────────────────────────────

describe('ORD-FOR-002 recovery payload', () => {
  function payloadFixture(over: Record<string, unknown> = {}) {
    return {
      id: 'F1',
      detector_id: 'ORD-FOR-002',
      gap_usd: 200,
      recoverability_score: 0.9,
      currency_iso_code: 'USD',
      title: 'Order under-billed',
      description: null,
      source_record_refs: { primary_record: { type: 'Order', id: 'O1', name: 'O-001' } },
      metadata: {
        quote_name: 'Q-001',
        quote_net_amount: 1000,
        order_total_sum: 800,
        variance_amount: -200,
        direction: 'under_billed',
        recovery_mode: 'pre_invoice_patch',
        line_breakdown: [
          { order_item_id: 'OI1', product_name: 'Widget', unit_price: 400, quantity: 1, line_total: 400 },
          { order_item_id: 'OI2', product_name: 'Gadget', unit_price: 400, quantity: 1, line_total: 400 },
        ],
        ...over,
      },
    };
  }

  it('distributes variance proportionally across OrderItems (pre-invoice)', async () => {
    const p = buildRecoveryPayload(payloadFixture());
    // Adjustment factor = 1000/800 = 1.25 → each $400 line becomes $500.
    expect(p.csvHeader).toBe('Id,UnitPrice,RecoveryNotes');
    expect(p.csvRow).toContain('OI1,500.00');
    expect(p.csvRow).toContain('OI2,500.00');
    expect(p.actionLabel).toContain('upward');
  });

  it('falls back to manual-review CSV for post-invoice findings', async () => {
    const p = buildRecoveryPayload(
      payloadFixture({ recovery_mode: 'post_invoice_manual_review' })
    );
    expect(p.csvHeader).toContain('Action');
    expect(p.csvRow).toContain('IssueDebitMemo');
    expect(p.actionLabel).toContain('debit memo');
  });

  it('uses credit-memo language for over-billed post-invoice', async () => {
    const p = buildRecoveryPayload(
      payloadFixture({
        recovery_mode: 'post_invoice_manual_review',
        direction: 'over_billed',
        variance_amount: 200,
      })
    );
    expect(p.csvRow).toContain('IssueCreditMemo');
    expect(p.actionLabel).toContain('credit memo');
  });

  it('correctly computes projected reclaim (gap × recoverability)', async () => {
    const p = buildRecoveryPayload(payloadFixture());
    expect(p.projectedReclaimUsd).toBe(180); // 200 × 0.9
  });
});
