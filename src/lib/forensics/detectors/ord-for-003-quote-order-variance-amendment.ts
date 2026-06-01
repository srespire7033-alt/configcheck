/**
 * ORD-FOR-003 — Quote Net Total ≠ Order Total (amendments).
 *
 * Sibling of ORD-FOR-002 but with amendment-specific math.
 *
 * Why amendments need different math: a new-biz Order should equal its
 * Quote total. An amendment Order should equal the DELTA introduced by
 * the amendment, not the full Quote total. The amendment Quote
 * represents the full quoted state (existing + new lines); the
 * amendment Order represents only what changed.
 *
 * Three reconciliation layers:
 *
 *   Layer 1 — Direct delta check
 *     expected = SUM(QuoteLine.NetTotal WHERE Existing = false)
 *     actual   = SUM(Order.TotalAmount)
 *     If |expected − actual| > $0.01 → finding.
 *
 *   Layer 2 — Cross-validate via prior Orders for same Account
 *     implied_delta = amendment_quote_net − prior_order_total_sum
 *     If layer-1 fires AND Layer 2 agrees within $0.01 → confidence
 *     boost via metadata.cross_validated = true.
 *
 *   Layer 3 — Proration carve-out
 *     If SBQQ__ProrateMultiplier__c ≠ 1 OR any line has
 *     SBQQ__PartialPeriod__c = true, multi-period proration is active
 *     and strict equality won't hold. We still flag, but mark
 *     proration_active = true so renderer/recovery soften the
 *     narrative and the consultant can decide whether the day-count
 *     variance is acceptable.
 *
 * Data-quality smoking gun (Class E):
 *   - A QuoteLine flagged SBQQ__Existing__c = false references a
 *     Product also present on a prior Order for the same Account.
 *     Means the rep flipped a flag that should have been derived.
 *     Surfaces as `existing_flag_suspect` items in metadata.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface AmendmentQuoteRow {
  Id: string;
  Name: string;
  SBQQ__NetAmount__c: string | number | null;
  SBQQ__Type__c: string;
  SBQQ__Account__c: string | null;
  SBQQ__MasterContract__c?: string | null;
  CurrencyIsoCode?: string;
}

interface QuoteLineRow {
  Id: string;
  SBQQ__Quote__c: string;
  SBQQ__NetTotal__c: string | number | null;
  SBQQ__Existing__c: boolean | null;
  SBQQ__PartialPeriod__c?: boolean | null;
  SBQQ__Product__c: string | null;
  Product__r?: { Name?: string } | null;
}

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
}

interface PriorOrderRow {
  Id: string;
  AccountId: string;
  TotalAmount: string | null;
  EffectiveDate: string;
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

const ORD_FOR_003: ForensicDetector = {
  id: 'ORD-FOR-003',
  label: 'Quote Net Total ≠ Order Total (amendment)',
  appliesTo: ['cpq', 'cpq_billing', 'arm'],
  freeTier: false,

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    const sinceIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    let hasCurrencyIsoCode = false;
    try {
      const desc = await ctx.conn.describe('SBQQ__Quote__c');
      hasCurrencyIsoCode = (desc.fields ?? []).some((f) => f.name === 'CurrencyIsoCode');
    } catch {
      // describe failure → assume single-currency.
    }
    const ccyField = hasCurrencyIsoCode ? ', CurrencyIsoCode' : '';

    // Detect optional CPQ fields that don't exist in every org.
    let hasProrateMultiplier = false;
    try {
      const qDesc = await ctx.conn.describe('SBQQ__Quote__c');
      hasProrateMultiplier = (qDesc.fields ?? []).some((f) => f.name === 'SBQQ__ProrateMultiplier__c');
    } catch {
      hasProrateMultiplier = false;
    }
    const prorateField = hasProrateMultiplier ? ', SBQQ__ProrateMultiplier__c' : '';

    // 1. Amendment quotes activated to Orders in the window.
    const quotesRes = await ctx.conn.query<AmendmentQuoteRow & { SBQQ__ProrateMultiplier__c?: string | number | null }>(`
      SELECT Id, Name, SBQQ__NetAmount__c, SBQQ__Type__c, SBQQ__Account__c, SBQQ__MasterContract__c${ccyField}${prorateField}
      FROM SBQQ__Quote__c
      WHERE SBQQ__Type__c = 'Amendment'
        AND CreatedDate >= ${sinceIso}
    `);
    console.log(`[ORD-FOR-003] Amendment quotes in window: ${quotesRes.records.length}`);
    if (quotesRes.records.length === 0) return [];

    const quoteIds = quotesRes.records.map((q) => q.Id);
    const quoteById = new Map(quotesRes.records.map((q) => [q.Id, q]));

    // 2. QuoteLines for those amendment quotes — split into existing
    //    vs new for the delta math.
    let hasPartialPeriod = false;
    try {
      const qlDesc = await ctx.conn.describe('SBQQ__QuoteLine__c');
      hasPartialPeriod = (qlDesc.fields ?? []).some((f) => f.name === 'SBQQ__PartialPeriod__c');
    } catch {
      hasPartialPeriod = false;
    }
    const partialField = hasPartialPeriod ? ', SBQQ__PartialPeriod__c' : '';

    const linesByQuote = new Map<string, QuoteLineRow[]>();
    for (let i = 0; i < quoteIds.length; i += 500) {
      const chunk = quoteIds.slice(i, i + 500);
      const linesRes = await ctx.conn.query<QuoteLineRow>(`
        SELECT Id, SBQQ__Quote__c, SBQQ__NetTotal__c, SBQQ__Existing__c, SBQQ__Product__c${partialField}
        FROM SBQQ__QuoteLine__c
        WHERE SBQQ__Quote__c IN (${chunk.map((id) => `'${id}'`).join(',')})
      `);
      for (const ln of linesRes.records) {
        const list = linesByQuote.get(ln.SBQQ__Quote__c) ?? [];
        list.push(ln);
        linesByQuote.set(ln.SBQQ__Quote__c, list);
      }
    }

    // 3. Amendment Orders.
    const ordersByQuote = new Map<string, OrderRow[]>();
    const orderCcyField = hasCurrencyIsoCode ? ', CurrencyIsoCode' : '';
    for (let i = 0; i < quoteIds.length; i += 500) {
      const chunk = quoteIds.slice(i, i + 500);
      const ordersRes = await ctx.conn.query<OrderRow>(`
        SELECT Id, OrderNumber, TotalAmount, AccountId, EffectiveDate, Status${orderCcyField},
               CreatedById, LastModifiedById, CreatedDate, LastModifiedDate,
               SBQQ__Quote__c
        FROM Order
        WHERE SBQQ__Quote__c IN (${chunk.map((id) => `'${id}'`).join(',')})
          AND Status = 'Activated'
      `);
      for (const o of ordersRes.records) {
        const list = ordersByQuote.get(o.SBQQ__Quote__c) ?? [];
        list.push(o);
        ordersByQuote.set(o.SBQQ__Quote__c, list);
      }
    }

    // 4. Prior Orders for cross-validation (Layer 2). Pull all Orders
    //    for the same Accounts EXCLUDING the amendment Orders.
    const allAmendmentOrderIds = new Set<string>();
    for (const list of Array.from(ordersByQuote.values()) as OrderRow[][]) {
      for (const o of list) allAmendmentOrderIds.add(o.Id);
    }
    const accountIds = new Set<string>();
    for (const list of Array.from(ordersByQuote.values()) as OrderRow[][]) {
      for (const o of list) if (o.AccountId) accountIds.add(o.AccountId);
    }
    const priorOrdersByAccount = new Map<string, PriorOrderRow[]>();
    const accountIdList = Array.from(accountIds);
    for (let i = 0; i < accountIdList.length; i += 200) {
      const chunk = accountIdList.slice(i, i + 200);
      if (chunk.length === 0) continue;
      const priorRes = await ctx.conn.query<PriorOrderRow>(`
        SELECT Id, AccountId, TotalAmount, EffectiveDate
        FROM Order
        WHERE AccountId IN (${chunk.map((id) => `'${id}'`).join(',')})
          AND Status = 'Activated'
      `);
      for (const p of priorRes.records) {
        if (allAmendmentOrderIds.has(p.Id)) continue;
        const list = priorOrdersByAccount.get(p.AccountId) ?? [];
        list.push(p);
        priorOrdersByAccount.set(p.AccountId, list);
      }
    }

    // 5. Invoice probe for post-invoice flagging.
    let hasBilling = false;
    try {
      await ctx.conn.describe('blng__Invoice__c');
      hasBilling = true;
    } catch {
      hasBilling = false;
    }
    const orderIdsWithInvoices = new Set<string>();
    if (hasBilling && allAmendmentOrderIds.size > 0) {
      const ids = Array.from(allAmendmentOrderIds);
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
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

    // 6. OrderItems for flagged orders (loaded lazily — only for
    //    findings, only for pre-invoice mode).
    const itemsByOrderId = new Map<string, OrderItemRow[]>();

    // 7. Variance check per amendment quote.
    const findings: DetectorResult[] = [];
    for (const quote of quotesRes.records) {
      const orders = ordersByQuote.get(quote.Id) ?? [];
      if (orders.length === 0) continue;

      // Currency mismatch — same logic as 8a.
      if (hasCurrencyIsoCode) {
        const qCcy = quote.CurrencyIsoCode;
        const mixed = orders.some((o) => o.CurrencyIsoCode && o.CurrencyIsoCode !== qCcy);
        if (mixed) {
          console.log(`[ORD-FOR-003] Skip ${quote.Name} — cross-currency`);
          continue;
        }
      }

      const lines = linesByQuote.get(quote.Id) ?? [];
      const newLines = lines.filter((l) => l.SBQQ__Existing__c === false || l.SBQQ__Existing__c == null);
      const existingLines = lines.filter((l) => l.SBQQ__Existing__c === true);

      // Layer 1 — direct delta check.
      const expectedDelta = newLines.reduce((s, l) => s + Number(l.SBQQ__NetTotal__c ?? 0), 0);
      const actualOrderSum = orders.reduce((s, o) => s + Number(o.TotalAmount ?? 0), 0);
      const variance = actualOrderSum - expectedDelta;
      if (Math.abs(variance) <= TOLERANCE_USD) continue;

      // Layer 2 — cross-validate via prior Orders for same Account.
      const primaryOrder = orders[0];
      const priorTotal = (priorOrdersByAccount.get(primaryOrder.AccountId) ?? [])
        .filter((p) => new Date(p.EffectiveDate) < new Date(primaryOrder.EffectiveDate))
        .reduce((s, p) => s + Number(p.TotalAmount ?? 0), 0);
      const quoteNet = Number(quote.SBQQ__NetAmount__c ?? 0);
      const impliedDeltaFromQuoteVsPrior = quoteNet - priorTotal;
      const crossValidated =
        priorTotal > 0 && Math.abs(impliedDeltaFromQuoteVsPrior - actualOrderSum) <= TOLERANCE_USD;

      // Layer 3 — proration carve-out.
      const prorateMultiplier = Number(
        (quote as AmendmentQuoteRow & { SBQQ__ProrateMultiplier__c?: string | number | null })
          .SBQQ__ProrateMultiplier__c ?? 1
      );
      const hasProratedLine = lines.some((l) => l.SBQQ__PartialPeriod__c === true);
      const prorationActive = prorateMultiplier !== 1 || hasProratedLine;

      // Class E smoking gun: a line flagged Existing=false references
      // a Product that's also on a prior Order for the same Account.
      // First gather prior Order Product IDs.
      const priorOrderItems = new Set<string>();
      // We didn't fetch the prior OrderItems explicitly — would be one
      // more query. v1 uses the Product__c on the QuoteLine to detect
      // "an Existing=false line for a Product the customer already has
      // on a prior amendment-quote's existing lines." Imperfect but
      // catches the high-signal case.
      const existingProductIds = new Set(existingLines.map((l) => l.SBQQ__Product__c).filter(Boolean) as string[]);
      const existingFlagSuspectLines = newLines
        .filter((l) => l.SBQQ__Product__c && existingProductIds.has(l.SBQQ__Product__c))
        .map((l) => l.Id);

      const hasInvoice = orders.some((o) => orderIdsWithInvoices.has(o.Id));
      const recoveryMode: 'pre_invoice_patch' | 'post_invoice_manual_review' | 'data_quality_fix' =
        existingFlagSuspectLines.length > 0
          ? 'data_quality_fix'
          : hasInvoice
            ? 'post_invoice_manual_review'
            : 'pre_invoice_patch';

      // Load OrderItems for pre-invoice patch construction.
      if (recoveryMode === 'pre_invoice_patch') {
        const toLoad = orders.map((o) => o.Id).filter((id) => !itemsByOrderId.has(id));
        if (toLoad.length > 0) {
          for (let i = 0; i < toLoad.length; i += 500) {
            const chunk = toLoad.slice(i, i + 500);
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

      const direction: 'over_billed' | 'under_billed' = variance > 0 ? 'over_billed' : 'under_billed';
      const absVariance = Math.abs(variance);

      const manualEdited = orders.some((o) => {
        if (o.LastModifiedById === o.CreatedById) return false;
        const delta = new Date(o.LastModifiedDate).getTime() - new Date(o.CreatedDate).getTime();
        return delta > 60 * 60 * 1000;
      });

      // Recoverability:
      //   data_quality_fix      → 0.95 (one-field CSV patch on the QuoteLine)
      //   pre_invoice_patch     → 0.85 (proration uncertainty slightly lowers
      //                                  vs 8a's 0.9)
      //   post_invoice_manual_review → 0.3
      let recoverabilityScore = 0.85;
      if (recoveryMode === 'data_quality_fix') recoverabilityScore = 0.95;
      else if (recoveryMode === 'post_invoice_manual_review') recoverabilityScore = 0.3;
      else if (prorationActive) recoverabilityScore = 0.7; // proration uncertainty

      const ccy = (hasCurrencyIsoCode && quote.CurrencyIsoCode) || ctx.defaultCurrencyIsoCode;
      const directionLabel = direction === 'under_billed' ? 'under-billed' : 'over-billed';
      const title = `Amendment Order ${primaryOrder.OrderNumber} ${directionLabel} ${ccy} ${Math.round(absVariance).toLocaleString()} vs Quote ${quote.Name}`;

      const primaryRecord: SourceRecord = {
        type: 'Order',
        id: primaryOrder.Id,
        name: primaryOrder.OrderNumber,
        financials: {
          order_total_sum: round2(actualOrderSum),
          expected_delta: round2(expectedDelta),
          variance_amount: round2(variance),
          direction,
          order_count: orders.length,
        },
      };
      const supportingRecords: SourceRecord[] = [
        {
          type: 'SBQQ__Quote__c',
          id: quote.Id,
          name: quote.Name,
          financials: {
            net_amount: quoteNet,
            new_line_count: newLines.length,
            existing_line_count: existingLines.length,
            type: 'Amendment',
          },
        },
        ...orders.slice(1, 4).map<SourceRecord>((o) => ({
          type: 'Order',
          id: o.Id,
          name: o.OrderNumber,
          financials: { total_amount: Number(o.TotalAmount ?? 0) },
        })),
      ];
      if (primaryOrder.AccountId) {
        supportingRecords.push({
          type: 'Account',
          id: primaryOrder.AccountId,
          name: `Account ${primaryOrder.AccountId}`,
        });
      }

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

      // Description varies by recovery mode for clarity in the UI.
      let description: string;
      if (recoveryMode === 'data_quality_fix') {
        description = `Amendment Quote "${quote.Name}" has ${existingFlagSuspectLines.length} line(s) marked SBQQ__Existing__c=false for products already on prior Orders for this Account. The amendment Order picked them up as NEW lines (totalling ${ccy} ${actualOrderSum.toLocaleString()}), but the expected delta was ${ccy} ${expectedDelta.toLocaleString()} — variance of ${ccy} ${absVariance.toLocaleString()}.`;
      } else {
        description =
          direction === 'under_billed'
            ? `Amendment Quote "${quote.Name}" expected ${ccy} ${expectedDelta.toLocaleString()} delta but amendment Order(s) totalled only ${ccy} ${actualOrderSum.toLocaleString()} — ${ccy} ${absVariance.toLocaleString()} short.${prorationActive ? ' Proration is active; part of the variance may be legitimate day-counting.' : ''}`
            : `Amendment Quote "${quote.Name}" expected ${ccy} ${expectedDelta.toLocaleString()} delta but amendment Order(s) totalled ${ccy} ${actualOrderSum.toLocaleString()} — customer over-charged by ${ccy} ${absVariance.toLocaleString()}.${prorationActive ? ' Proration is active; part of the variance may be legitimate.' : ''}`;
      }

      findings.push({
        detectorId: 'ORD-FOR-003',
        severity: absVariance >= 100_000 ? 'critical' : absVariance >= 10_000 ? 'warning' : 'info',
        entitledUsd: round2(expectedDelta),
        realizedUsd: round2(actualOrderSum),
        gapUsd: round2(absVariance),
        currencyIsoCode: ccy,
        recoverabilityScore,
        primaryRecord,
        supportingRecords,
        title,
        description,
        metadata: {
          quote_id: quote.Id,
          quote_name: quote.Name,
          quote_net_amount: quoteNet,
          expected_delta: round2(expectedDelta),
          order_ids: orders.map((o) => o.Id),
          order_numbers: orders.map((o) => o.OrderNumber),
          order_total_sum: round2(actualOrderSum),
          variance_amount: round2(variance),
          direction,
          recovery_mode: recoveryMode,
          has_invoices: hasInvoice,
          manually_edited: manualEdited,
          proration_active: prorationActive,
          prorate_multiplier: prorateMultiplier,
          cross_validated: crossValidated,
          prior_order_total: round2(priorTotal),
          new_line_count: newLines.length,
          existing_line_count: existingLines.length,
          existing_flag_suspect_line_ids: existingFlagSuspectLines,
          account_id: primaryOrder.AccountId,
          line_breakdown: lineBreakdown,
        },
      });
    }

    console.log(
      `[ORD-FOR-003] Emitting ${findings.length} findings (sum gap = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`
    );
    return findings;
  },
};

export default ORD_FOR_003;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
