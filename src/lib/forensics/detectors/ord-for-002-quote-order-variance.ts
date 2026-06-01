/**
 * ORD-FOR-002 — Quote Net Total ≠ Order Total (new business).
 *
 * The pattern: a Quote was approved at $X but the activated Order(s)
 * for that Quote totalled $Y, with X ≠ Y. The difference bypasses
 * quoting controls — either the customer is under-billed (revenue
 * leak) or over-billed (refund exposure + audit risk).
 *
 * Why this happens (all genuine in the field):
 *   - Q→O sync field-mapping silently drops a line or a charge
 *   - Pricebook on the Order differs from the Pricebook on the Quote
 *   - A custom Apex trigger on Order rewrites UnitPrice/Quantity on
 *     insert/update
 *   - Someone manually edited the Order after activation
 *   - A Flow/Process touches Order pricing fields without leaving an
 *     audit trail
 *
 * Detection model:
 *   1. Pull Orders activated in the last 12 months that came from CPQ
 *      (SBQQ__Quote__c populated). Filter to Type = 'Quote' (new biz)
 *      — amendments handled by ORD-FOR-003.
 *   2. Group Orders by Quote so split orders are summed before
 *      comparison. One Quote → N Orders is legitimate; what matters
 *      is whether the *sum* matches.
 *   3. Compare SUM(Order.TotalAmount) to Quote.SBQQ__NetAmount__c.
 *      Use $0.01 tolerance for float-drift only — anything bigger is
 *      a real finding.
 *   4. Skip cross-currency pairs (Order currency ≠ Quote currency) —
 *      those need separate handling and are vanishingly rare in
 *      practice.
 *   5. If Salesforce Billing is installed, detect whether any related
 *      Invoice exists. Invoiced orders shift to manual-review-only
 *      recovery (can't reprice activated billed lines without a
 *      Credit Memo workflow).
 *
 * One finding per affected Quote. Direction is captured in metadata
 * (under_billed vs over_billed) so the renderer + recovery payload
 * can speak the right language.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface OrderRow {
  Id: string;
  OrderNumber: string;
  TotalAmount: string | null;
  AccountId: string;
  EffectiveDate: string;
  Status: string;
  CurrencyIsoCode?: string;
  CreatedById: string;
  LastModifiedById: string;
  CreatedDate: string;
  LastModifiedDate: string;
  SBQQ__Quote__c: string;
  SBQQ__Quote__r: {
    Id: string;
    Name: string;
    SBQQ__NetAmount__c: string | number | null;
    SBQQ__Type__c: string | null;
    SBQQ__Account__c: string | null;
    CurrencyIsoCode?: string;
  } | null;
}

interface OrderItemRow {
  Id: string;
  OrderId: string;
  UnitPrice: string | null;
  Quantity: string | null;
  Product2Id: string | null;
  Product2?: { Name?: string } | null;
  SBQQ__QuoteLine__c?: string | null;
}

interface InvoiceRow {
  Id: string;
  blng__Order__c?: string | null;
}

const TOLERANCE_USD = 0.01;

const ORD_FOR_002: ForensicDetector = {
  id: 'ORD-FOR-002',
  label: 'Quote Net Total ≠ Order Total (new business)',
  appliesTo: ['cpq', 'cpq_billing', 'arm'],
  freeTier: false,

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    const sinceIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    // Detect multi-currency support up-front. Affects SELECT clause —
    // querying CurrencyIsoCode on a single-currency org raises a SOQL
    // error. Same probe pattern as REN-001.
    let hasCurrencyIsoCode = false;
    try {
      const desc = await ctx.conn.describe('Order');
      hasCurrencyIsoCode = (desc.fields ?? []).some((f) => f.name === 'CurrencyIsoCode');
    } catch {
      // describe failure → skip the field; downstream code handles absent value.
    }
    const currencyField = hasCurrencyIsoCode ? ', CurrencyIsoCode' : '';
    const quoteCurrencyField = hasCurrencyIsoCode ? ', SBQQ__Quote__r.CurrencyIsoCode' : '';

    // 1. Activated Orders in window that came from CPQ.
    //    SBQQ__Type__c filter excludes Amendment / Renewal — those go
    //    to ORD-FOR-003. We tolerate null Type (some orgs leave it
    //    blank for first-time new biz quotes; default to new-biz).
    const ordersRes = await ctx.conn.query<OrderRow>(`
      SELECT Id, OrderNumber, TotalAmount, AccountId, EffectiveDate, Status${currencyField},
             CreatedById, LastModifiedById, CreatedDate, LastModifiedDate,
             SBQQ__Quote__c, SBQQ__Quote__r.Id, SBQQ__Quote__r.Name,
             SBQQ__Quote__r.SBQQ__NetAmount__c, SBQQ__Quote__r.SBQQ__Type__c,
             SBQQ__Quote__r.SBQQ__Account__c${quoteCurrencyField}
      FROM Order
      WHERE Status = 'Activated'
        AND SBQQ__Quote__c != null
        AND EffectiveDate >= ${sinceIso.split('T')[0]}
        AND (SBQQ__Quote__r.SBQQ__Type__c = 'Quote' OR SBQQ__Quote__r.SBQQ__Type__c = null)
    `);
    console.log(`[ORD-FOR-002] Activated new-biz Orders from CPQ: ${ordersRes.records.length}`);
    if (ordersRes.records.length === 0) return [];

    // 2. Group by Quote ID. One Quote → many Orders is normal (splits).
    const ordersByQuote = new Map<string, OrderRow[]>();
    for (const o of ordersRes.records) {
      if (!o.SBQQ__Quote__r) continue;
      const list = ordersByQuote.get(o.SBQQ__Quote__c) ?? [];
      list.push(o);
      ordersByQuote.set(o.SBQQ__Quote__c, list);
    }

    // 3. Probe for Salesforce Billing — used to flag invoiced orders.
    //    No probe failure handling needed; if blng isn't installed,
    //    every finding stays in pre-invoice mode.
    let hasBilling = false;
    try {
      await ctx.conn.describe('blng__Invoice__c');
      hasBilling = true;
    } catch {
      hasBilling = false;
    }

    // 4. If Billing is installed, fetch invoice counts per Order.
    const allOrderIds = ordersRes.records.map((o) => o.Id);
    const orderIdsWithInvoices = new Set<string>();
    if (hasBilling && allOrderIds.length > 0) {
      for (let i = 0; i < allOrderIds.length; i += 500) {
        const chunk = allOrderIds.slice(i, i + 500);
        const invRes = await ctx.conn.query<InvoiceRow>(`
          SELECT Id, blng__Order__c
          FROM blng__Invoice__c
          WHERE blng__Order__c IN (${chunk.map((id) => `'${id}'`).join(',')})
        `);
        for (const inv of invRes.records) {
          if (inv.blng__Order__c) orderIdsWithInvoices.add(inv.blng__Order__c);
        }
      }
    }

    // 5. Pull line-level breakdown so the recovery payload can patch
    //    OrderItems individually. Only for Orders we're about to flag.
    //    We'll fetch lazily after the variance check.
    const itemsByOrderId = new Map<string, OrderItemRow[]>();

    // 6. Build per-Quote variance findings.
    const findings: DetectorResult[] = [];
    for (const [quoteId, orders] of Array.from(ordersByQuote.entries()) as Array<[string, OrderRow[]]>) {
      const firstWithQuote = orders[0];
      const quote = firstWithQuote.SBQQ__Quote__r;
      if (!quote || quote.SBQQ__NetAmount__c == null) {
        console.log(`[ORD-FOR-002] Skip ${quoteId} — quote NetAmount missing`);
        continue;
      }
      const quoteNet = Number(quote.SBQQ__NetAmount__c);
      if (!isFinite(quoteNet)) continue;

      // Currency mismatch — skip the Quote entirely. Cross-currency
      // variance is its own kind of finding (would belong in a future
      // CUR-FOR detector) and "exact match" math is undefined across
      // FX rates.
      if (hasCurrencyIsoCode) {
        const quoteCcy = quote.CurrencyIsoCode;
        const mixedCurrency = orders.some((o) => o.CurrencyIsoCode && o.CurrencyIsoCode !== quoteCcy);
        if (mixedCurrency) {
          console.log(`[ORD-FOR-002] Skip ${quote.Name} — Order currency differs from Quote (${quoteCcy})`);
          continue;
        }
      }

      const orderTotalSum = orders.reduce((s, o) => s + Number(o.TotalAmount ?? 0), 0);
      const variance = orderTotalSum - quoteNet; // positive = over-billed
      const absVariance = Math.abs(variance);

      // Exact match per user spec — $0.01 absorbs JS float artifacts only.
      if (absVariance <= TOLERANCE_USD) continue;

      const direction: 'over_billed' | 'under_billed' = variance > 0 ? 'over_billed' : 'under_billed';

      const hasInvoice = orders.some((o) => orderIdsWithInvoices.has(o.Id));
      const recoveryMode: 'pre_invoice_patch' | 'post_invoice_manual_review' = hasInvoice
        ? 'post_invoice_manual_review'
        : 'pre_invoice_patch';

      // For pre-invoice recovery we need OrderItem-level detail to
      // build the patch CSV. Fetch lazily — only for flagged Orders.
      if (recoveryMode === 'pre_invoice_patch') {
        const orderIdsToLoad = orders.map((o) => o.Id).filter((id) => !itemsByOrderId.has(id));
        if (orderIdsToLoad.length > 0) {
          for (let i = 0; i < orderIdsToLoad.length; i += 500) {
            const chunk = orderIdsToLoad.slice(i, i + 500);
            const itemsRes = await ctx.conn.query<OrderItemRow>(`
              SELECT Id, OrderId, UnitPrice, Quantity, Product2Id, Product2.Name, SBQQ__QuoteLine__c
              FROM OrderItem
              WHERE OrderId IN (${chunk.map((id) => `'${id}'`).join(',')})
            `);
            for (const item of itemsRes.records) {
              const list = itemsByOrderId.get(item.OrderId) ?? [];
              list.push(item);
              itemsByOrderId.set(item.OrderId, list);
            }
          }
        }
      }

      const totalItemCount = orders.reduce((s, o) => s + (itemsByOrderId.get(o.Id)?.length ?? 0), 0);

      // Manual-edit signal for attribution. If LastModified differs
      // from Created by user AND >1 hour after activation, someone
      // touched the Order after the fact.
      const manualEdited = orders.some((o) => {
        if (o.LastModifiedById === o.CreatedById) return false;
        const delta = new Date(o.LastModifiedDate).getTime() - new Date(o.CreatedDate).getTime();
        return delta > 60 * 60 * 1000;
      });

      const variancePct = quoteNet !== 0 ? (variance / quoteNet) * 100 : 0;

      const primaryOrder = orders[0];
      const primaryRecord: SourceRecord = {
        type: 'Order',
        id: primaryOrder.Id,
        name: primaryOrder.OrderNumber,
        financials: {
          order_total: Number(primaryOrder.TotalAmount ?? 0),
          quote_net_amount: quoteNet,
          variance_amount: round2(variance),
          variance_pct: round2(variancePct),
          direction,
          order_count: orders.length,
          activated_date: primaryOrder.EffectiveDate,
        },
      };
      const supportingRecords: SourceRecord[] = [
        {
          type: 'SBQQ__Quote__c',
          id: quote.Id,
          name: quote.Name,
          financials: {
            net_amount: quoteNet,
            type: quote.SBQQ__Type__c ?? 'Quote',
          },
        },
        ...orders.slice(1, 4).map<SourceRecord>((o) => ({
          type: 'Order',
          id: o.Id,
          name: o.OrderNumber,
          financials: {
            total_amount: Number(o.TotalAmount ?? 0),
          },
        })),
      ];
      if (primaryOrder.AccountId) {
        supportingRecords.push({
          type: 'Account',
          id: primaryOrder.AccountId,
          name: `Account ${primaryOrder.AccountId}`,
        });
      }

      // Recovery is highly possible pre-invoice (just reprice
      // OrderItems). Drops sharply once invoices exist — Credit Memo
      // path is operational, not automatable from a CSV.
      const recoverabilityScore = recoveryMode === 'pre_invoice_patch' ? 0.9 : 0.3;

      const ccy = (hasCurrencyIsoCode && quote.CurrencyIsoCode) || ctx.defaultCurrencyIsoCode;

      const directionLabel = direction === 'under_billed' ? 'under-billed' : 'over-billed';
      const title = `Order ${primaryOrder.OrderNumber} ${directionLabel} ${ccy} ${Math.round(absVariance).toLocaleString()} vs Quote ${quote.Name}`;

      // Line-level breakdown for the recovery payload — only when we
      // loaded items.
      const lineBreakdown = orders.flatMap((o) =>
        (itemsByOrderId.get(o.Id) ?? []).map((it) => ({
          order_id: o.Id,
          order_number: o.OrderNumber,
          order_item_id: it.Id,
          product_name: it.Product2?.Name ?? it.Product2Id ?? 'Unknown',
          unit_price: Number(it.UnitPrice ?? 0),
          quantity: Number(it.Quantity ?? 0),
          line_total: Number(it.UnitPrice ?? 0) * Number(it.Quantity ?? 0),
          quote_line_id: it.SBQQ__QuoteLine__c ?? null,
        }))
      );

      findings.push({
        detectorId: 'ORD-FOR-002',
        severity: absVariance >= 100_000 ? 'critical' : absVariance >= 10_000 ? 'warning' : 'info',
        entitledUsd: round2(quoteNet),
        realizedUsd: round2(orderTotalSum),
        gapUsd: round2(absVariance),
        currencyIsoCode: ccy,
        recoverabilityScore,
        primaryRecord,
        supportingRecords,
        title,
        description:
          direction === 'under_billed'
            ? `Quote approved at ${ccy} ${quoteNet.toLocaleString()} but Order(s) totalled ${ccy} ${orderTotalSum.toLocaleString()} — ${ccy} ${absVariance.toLocaleString()} short.`
            : `Quote approved at ${ccy} ${quoteNet.toLocaleString()} but Order(s) totalled ${ccy} ${orderTotalSum.toLocaleString()} — customer over-charged by ${ccy} ${absVariance.toLocaleString()}.`,
        metadata: {
          quote_id: quote.Id,
          quote_name: quote.Name,
          quote_net_amount: quoteNet,
          order_ids: orders.map((o) => o.Id),
          order_numbers: orders.map((o) => o.OrderNumber),
          order_total_sum: round2(orderTotalSum),
          variance_amount: round2(variance),
          variance_pct: round2(variancePct),
          direction,
          recovery_mode: recoveryMode,
          has_invoices: hasInvoice,
          item_count: totalItemCount,
          manually_edited: manualEdited,
          account_id: primaryOrder.AccountId,
          line_breakdown: lineBreakdown,
        },
      });
    }

    console.log(
      `[ORD-FOR-002] Emitting ${findings.length} findings (sum gap = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`
    );
    return findings;
  },
};

export default ORD_FOR_002;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
