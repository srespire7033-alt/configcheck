/**
 * ORD-FOR-001 — Order activated, no billing schedule.
 *
 * The pattern: an Order is in 'Activated' status (the customer is
 * receiving the product/service) but has zero billing schedules
 * generated against it. No invoices ever go out. Revenue accrues
 * every day the customer uses the product but never lands in AR.
 *
 * This is the #1 highest-$ leak in Billing-enabled CPQ orgs. Causes:
 *   - The Order Activation workflow doesn't trigger billing schedule
 *     generation (system disconnect — Class A)
 *   - The OrderItem's billing rule is null/inactive (Class A)
 *   - A custom integration that bridges Sales Cloud and Billing
 *     silently failed (Class A)
 *
 * Detection model:
 *   1. Confirm Salesforce Billing is installed (probe for
 *      blng__BillingSchedule__c). If not, return [] — this detector
 *      only applies to Billing/RCA customers.
 *   2. Pull every Order activated in the last 24 months.
 *   3. For each Order, count related billing schedules (via the
 *      Order → OrderItem → blng__BillingSchedule__c chain).
 *   4. If schedules = 0 → flag. Gap = Order.TotalAmount, annualized.
 *      For Orders with TotalAmount = $0 (unusual) we fall back to
 *      sum of OrderItem.UnitPrice × Quantity.
 *
 * Recoverability is high (0.9): generating the missing schedules
 * back-dated is a documented recovery flow in Salesforce Billing,
 * and customers expect to be invoiced for product they've received.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface OrderRow {
  Id: string;
  OrderNumber: string;
  Status: string;
  ActivatedDate: string;
  TotalAmount: string | null;
  AccountId: string;
}

interface BillingScheduleRow {
  Id: string;
  blng__Order__c?: string | null;
  blng__OrderProduct__c?: string | null;
}

interface OrderItemRow {
  Id: string;
  OrderId: string;
  UnitPrice: string;
  Quantity: string;
  Product2Id: string;
  Product2: { Name: string };
  blng__BillingRule__c?: string | null;
}

const ORD_FOR_001: ForensicDetector = {
  id: 'ORD-FOR-001',
  label: 'Order activated, no billing schedule generated',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    // 1. Probe whether Salesforce Billing is installed. If not, this
    //    detector has nothing to find. Silent skip — don't pollute
    //    detectors_failed when the org legitimately doesn't have
    //    Billing.
    try {
      await ctx.conn.describe('blng__BillingSchedule__c');
    } catch {
      console.log('[ORD-FOR-001] Salesforce Billing (blng__) not installed — skipping detector.');
      return [];
    }

    const sinceIso = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();

    // 2. Activated Orders in window.
    const ordersRes = await ctx.conn.query<OrderRow>(`
      SELECT Id, OrderNumber, Status, ActivatedDate, TotalAmount, AccountId
      FROM Order
      WHERE Status = 'Activated'
        AND ActivatedDate >= ${sinceIso}
    `);
    console.log(`[ORD-FOR-001] Activated Orders in window: ${ordersRes.records.length}`);
    if (ordersRes.records.length === 0) return [];

    const orderIds = ordersRes.records.map((o) => o.Id);

    // 3. For each Order, count related billing schedules. We chunk
    //    the IN clause to stay under SOQL char limits.
    const billingByOrderId = new Map<string, number>();
    for (let i = 0; i < orderIds.length; i += 500) {
      const chunk = orderIds.slice(i, i + 500);
      const schedulesRes = await ctx.conn.query<BillingScheduleRow>(`
        SELECT Id, blng__Order__c
        FROM blng__BillingSchedule__c
        WHERE blng__Order__c IN (${chunk.map((id) => `'${id}'`).join(',')})
      `);
      for (const s of schedulesRes.records) {
        const oid = s.blng__Order__c;
        if (!oid) continue;
        billingByOrderId.set(oid, (billingByOrderId.get(oid) ?? 0) + 1);
      }
    }
    console.log(`[ORD-FOR-001] Orders with schedules: ${billingByOrderId.size} of ${ordersRes.records.length}`);

    // 4. Identify orders with zero schedules and pull their OrderItems
    //    for gap calculation + Class A evidence.
    const ordersWithoutSchedules = ordersRes.records.filter((o) => !billingByOrderId.has(o.Id));
    if (ordersWithoutSchedules.length === 0) {
      console.log('[ORD-FOR-001] All activated orders have billing schedules. Clean.');
      return [];
    }

    const orphanIds = ordersWithoutSchedules.map((o) => o.Id);
    const itemsByOrderId = new Map<string, OrderItemRow[]>();
    for (let i = 0; i < orphanIds.length; i += 500) {
      const chunk = orphanIds.slice(i, i + 500);
      const itemsRes = await ctx.conn.query<OrderItemRow>(`
        SELECT Id, OrderId, UnitPrice, Quantity, Product2Id, Product2.Name, blng__BillingRule__c
        FROM OrderItem
        WHERE OrderId IN (${chunk.map((id) => `'${id}'`).join(',')})
      `);
      for (const item of itemsRes.records) {
        const list = itemsByOrderId.get(item.OrderId) ?? [];
        list.push(item);
        itemsByOrderId.set(item.OrderId, list);
      }
    }

    // 5. Emit one finding per orphan Order.
    const findings: DetectorResult[] = [];
    for (const order of ordersWithoutSchedules) {
      const items = itemsByOrderId.get(order.Id) ?? [];
      const totalAmount = parseFloat(order.TotalAmount || '0');
      const itemsSum = items.reduce(
        (sum, i) => sum + parseFloat(i.UnitPrice || '0') * parseFloat(i.Quantity || '1'),
        0
      );
      // Fall back to OrderItem sum when TotalAmount is missing/zero —
      // both numbers should agree in a well-formed Order; either works
      // as the gap.
      const gap = totalAmount > 0 ? totalAmount : itemsSum;
      if (gap < 1) continue;

      const hasNullBillingRule = items.some((i) => !i.blng__BillingRule__c);

      const productSummary = items
        .map((i) => i.Product2?.Name ?? i.Product2Id)
        .slice(0, 3)
        .join(', ');

      const primaryRecord: SourceRecord = {
        type: 'Order',
        id: order.Id,
        name: order.OrderNumber,
        financials: {
          total_amount: totalAmount,
          item_count: items.length,
          activated_date: order.ActivatedDate,
        },
      };
      const supportingRecords: SourceRecord[] = items.slice(0, 5).map((i) => ({
        type: 'OrderItem',
        id: i.Id,
        name: i.Product2?.Name ?? i.Product2Id,
        financials: {
          unit_price: parseFloat(i.UnitPrice || '0'),
          quantity: parseFloat(i.Quantity || '1'),
          billing_rule_id: i.blng__BillingRule__c ?? null,
        },
      }));
      supportingRecords.push({
        type: 'Account',
        id: order.AccountId,
        name: `Account ${order.AccountId}`,
      });

      // Days since activation — drives the urgency hint
      const daysActive = Math.floor((Date.now() - new Date(order.ActivatedDate).getTime()) / (1000 * 60 * 60 * 24));

      findings.push({
        detectorId: 'ORD-FOR-001',
        severity: gap >= 100_000 ? 'critical' : gap >= 10_000 ? 'warning' : 'info',
        // 'Entitled' = the amount that should have been billed by now.
        // 'Realized' = $0 (no invoices generated). Gap = entitled.
        entitledUsd: round2(gap),
        realizedUsd: 0,
        gapUsd: round2(gap),
        currencyIsoCode: ctx.defaultCurrencyIsoCode,
        // Highly recoverable: documented Salesforce Billing recovery
        // path exists. Customer expects to be invoiced for product
        // they've received.
        recoverabilityScore: 0.9,
        primaryRecord,
        supportingRecords,
        title: `Order ${order.OrderNumber} activated ${daysActive}d ago — no billing schedule (${ctx.defaultCurrencyIsoCode} ${Math.round(gap).toLocaleString()})`,
        description: `Order activated ${daysActive} days ago for ${productSummary || items.length + ' line(s)'}. Total ${ctx.defaultCurrencyIsoCode} ${gap.toLocaleString()} accruing without invoices.`,
        metadata: {
          activated_date: order.ActivatedDate,
          days_since_activation: daysActive,
          item_count: items.length,
          has_orderitem_with_null_billing_rule: hasNullBillingRule,
          account_id: order.AccountId,
        },
      });
    }

    console.log(`[ORD-FOR-001] Emitting ${findings.length} findings (sum gap = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`);
    return findings;
  },
};

export default ORD_FOR_001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
