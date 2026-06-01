/**
 * Recovery payload generator — turns a forensic finding into a
 * Data Loader-friendly CSV row plus the projected reclaim $.
 *
 * Each detector emits a different remediation shape:
 *   - REN-001 (uplift suppressed)       → patch SBQQ__NetPrice__c on the renewal QuoteLine
 *   - REN-002 (renewal below list)      → repricing recommendation per line
 *   - DSC-FOR-001 (promo roll-off)      → discount-removal patch on the QuoteLine
 *   - ORD-FOR-001 (no billing schedule) → operational fix (generate schedule); no field patch
 *   - QL-FOR-001 (free bundle option)   → patch SBQQ__NetPrice__c on the option line
 *
 * For the operational-fix cases (ORD-FOR-001) the CSV holds the
 * affected record IDs + a recommended Salesforce Billing action
 * instead of field values. Same format the consultant can paste into
 * their delivery runbook.
 *
 * Pure function — no DB access. Caller persists the result.
 */

export interface RecoveryPayload {
  csvHeader: string;
  csvRow: string;
  /** What this CSV is for — drives the suggested next action in the UI. */
  actionLabel: string;
  /** Filename hint for downloads. */
  filename: string;
  /** Recoverable $ for this single finding (gap × recoverability). */
  projectedReclaimUsd: number;
}

interface FindingShape {
  id: string;
  detector_id: string;
  gap_usd: number;
  recoverability_score: number;
  currency_iso_code: string;
  title: string;
  description: string | null;
  source_record_refs: unknown;
  metadata: unknown;
}

interface SourceRecord {
  type: string;
  id: string;
  name: string;
  financials?: Record<string, number | string | null>;
}

interface RefsShape {
  primary_record?: SourceRecord;
  supporting_records?: SourceRecord[];
}

function refs(finding: FindingShape): RefsShape {
  return (finding.source_record_refs as RefsShape) ?? {};
}

function meta(finding: FindingShape): Record<string, unknown> {
  return (finding.metadata as Record<string, unknown>) ?? {};
}

function findSupporting(finding: FindingShape, type: string): SourceRecord | undefined {
  return refs(finding).supporting_records?.find((r) => r.type === type);
}

function csvField(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildRecoveryPayload(finding: FindingShape): RecoveryPayload {
  const projectedReclaimUsd = Math.round(finding.gap_usd * finding.recoverability_score * 100) / 100;
  const m = meta(finding);
  const r = refs(finding);

  switch (finding.detector_id) {
    // ────────────────── REN-001 / REN-002 — patch NetPrice ──────────────
    case 'REN-001': {
      const upliftPct = (m.uplift_pct_entitled as number | undefined) ?? 0;
      const originalPerUnit = (m.original_price_per_unit as number | undefined) ?? 0;
      const fraction = upliftPct > 1 ? upliftPct / 100 : upliftPct;
      const correctedPerUnit = originalPerUnit * (1 + fraction);
      const subRef = findSupporting(finding, 'SBQQ__Subscription__c');
      const contractRef = findSupporting(finding, 'Contract');
      return {
        csvHeader: 'Id,SBQQ__NetPrice__c,RecoveryNotes',
        csvRow: [
          csvField(r.primary_record?.id),
          csvField(correctedPerUnit.toFixed(2)),
          csvField(
            `Corrected per-unit = original ${originalPerUnit} × (1 + ${upliftPct}% uplift, Contract ${contractRef?.name ?? ''}, Subscription ${subRef?.name ?? ''})`
          ),
        ].join(','),
        actionLabel: 'Patch NetPrice via Data Loader upsert',
        filename: `recovery-REN-001-${r.primary_record?.name ?? finding.id}.csv`,
        projectedReclaimUsd,
      };
    }
    case 'REN-002': {
      const currentList = (m.current_list_price as number | undefined) ?? 0;
      const pctBelow = (m.percent_below_list as number | undefined) ?? 0;
      return {
        csvHeader: 'Id,SBQQ__NetPrice__c,RecoveryNotes',
        csvRow: [
          csvField(r.primary_record?.id),
          csvField(currentList.toFixed(2)),
          csvField(
            `Reprice to current list (${currentList.toLocaleString()}) — quote was ${pctBelow.toFixed(1)}% below`
          ),
        ].join(','),
        actionLabel: 'Reprice quote line to current list via Data Loader',
        filename: `recovery-REN-002-${r.primary_record?.name ?? finding.id}.csv`,
        projectedReclaimUsd,
      };
    }
    // ────────────────── DSC-FOR-001 — remove the discount ──────────────
    case 'DSC-FOR-001': {
      const schedule = findSupporting(finding, 'SBQQ__DiscountSchedule__c');
      const subCase = (m.sub_case as string | undefined) ?? '';
      return {
        csvHeader: 'Id,SBQQ__Discount__c,SBQQ__DiscountSchedule__c,RecoveryNotes',
        csvRow: [
          csvField(r.primary_record?.id),
          csvField(0),
          csvField(''),
          csvField(
            subCase === 'expired'
              ? `Schedule "${schedule?.name ?? ''}" expired — remove discount`
              : `Open-ended promo "${schedule?.name ?? ''}" should end — remove discount`
          ),
        ].join(','),
        actionLabel: 'Remove expired discount via Data Loader',
        filename: `recovery-DSC-FOR-001-${r.primary_record?.name ?? finding.id}.csv`,
        projectedReclaimUsd,
      };
    }
    // ────────────────── ORD-FOR-002 — patch OrderItem unit prices ──
    case 'ORD-FOR-002': {
      const recoveryMode = (m.recovery_mode as string | undefined) ?? 'pre_invoice_patch';
      const direction = (m.direction as string | undefined) ?? 'under_billed';
      const quoteName = (m.quote_name as string | undefined) ?? '';
      const quoteNet = (m.quote_net_amount as number | undefined) ?? 0;
      const orderSum = (m.order_total_sum as number | undefined) ?? 0;
      const variance = (m.variance_amount as number | undefined) ?? 0;
      const breakdown =
        (m.line_breakdown as Array<{
          order_item_id: string;
          product_name: string;
          unit_price: number;
          quantity: number;
          line_total: number;
        }> | undefined) ?? [];

      // Post-invoice: no CSV — invoices already exist, can't reprice
      // activated OrderItems without a Credit Memo. The recovery row
      // exists but draft_payload is just a guidance note. Consultant
      // handles externally and marks Committed manually.
      if (recoveryMode === 'post_invoice_manual_review' || breakdown.length === 0) {
        return {
          csvHeader: 'OrderId,Variance,Direction,Action,RecoveryNotes',
          csvRow: [
            csvField(r.primary_record?.id),
            csvField(variance.toFixed(2)),
            csvField(direction),
            csvField(direction === 'under_billed' ? 'IssueDebitMemo' : 'IssueCreditMemo'),
            csvField(
              `Quote ${quoteName} approved at ${quoteNet.toLocaleString()}; Order(s) totalled ${orderSum.toLocaleString()}. Order has invoices — handle via Salesforce Billing Credit/Debit Memo flow.`
            ),
          ].join(','),
          actionLabel: direction === 'under_billed'
            ? 'Issue debit memo (invoiced order — manual)'
            : 'Issue credit memo (invoiced order — manual)',
          filename: `recovery-ORD-FOR-002-${r.primary_record?.name ?? finding.id}.csv`,
          projectedReclaimUsd,
        };
      }

      // Pre-invoice: distribute the variance proportionally across
      // OrderItems by current line_total. Each line's patched
      // UnitPrice = original × adjustment_factor. Adjustment factor
      // is the ratio that makes SUM(line_totals) == quoteNet.
      //
      // The CSV is a multi-row patch — Data Loader applies all rows
      // in one upsert. We override the bundle's default single-row
      // semantics by stuffing rows into csvRow with embedded newlines;
      // bundlePayloads() groups by header so multiple ORD-FOR-002
      // findings still merge correctly.
      const adjustmentFactor = orderSum !== 0 ? quoteNet / orderSum : 1;
      const patchedRows = breakdown.map((line) => {
        const newUnitPrice = line.quantity > 0
          ? Math.round(line.unit_price * adjustmentFactor * 100) / 100
          : line.unit_price;
        return [
          csvField(line.order_item_id),
          csvField(newUnitPrice.toFixed(2)),
          csvField(
            `${line.product_name}: was ${line.unit_price.toFixed(2)} × ${line.quantity}, patch to match Quote ${quoteName}`
          ),
        ].join(',');
      });

      return {
        csvHeader: 'Id,UnitPrice,RecoveryNotes',
        csvRow: patchedRows.join('\n'),
        actionLabel: direction === 'under_billed'
          ? 'Patch OrderItem UnitPrices upward to match Quote'
          : 'Patch OrderItem UnitPrices downward to match Quote',
        filename: `recovery-ORD-FOR-002-${r.primary_record?.name ?? finding.id}.csv`,
        projectedReclaimUsd,
      };
    }
    // ────────────────── ORD-FOR-001 — operational fix (no field patch) ──
    case 'ORD-FOR-001': {
      const days = (m.days_since_activation as number | undefined) ?? 0;
      return {
        csvHeader: 'OrderId,Action,RecoveryNotes',
        csvRow: [
          csvField(r.primary_record?.id),
          csvField('GenerateBillingSchedule'),
          csvField(
            `Order activated ${days} days ago with no billing schedule. Run Salesforce Billing's 'Generate Billing Schedule' action against this Order to back-fill.`
          ),
        ].join(','),
        actionLabel: 'Run Salesforce Billing → Generate Billing Schedule',
        filename: `recovery-ORD-FOR-001-${r.primary_record?.name ?? finding.id}.csv`,
        projectedReclaimUsd,
      };
    }
    // ────────────────── QL-FOR-001 — restore option price ──────────────
    case 'QL-FOR-001': {
      const resolved = (m.resolved_list_price as number | undefined) ?? 0;
      const quantity = (m.quantity as number | undefined) ?? 1;
      return {
        csvHeader: 'Id,SBQQ__NetPrice__c,RecoveryNotes',
        csvRow: [
          csvField(r.primary_record?.id),
          csvField(resolved.toFixed(2)),
          csvField(`Restore required-option price (list ${resolved.toLocaleString()} × ${quantity})`),
        ].join(','),
        actionLabel: 'Restore required-option price via Data Loader',
        filename: `recovery-QL-FOR-001-${r.primary_record?.name ?? finding.id}.csv`,
        projectedReclaimUsd,
      };
    }
    // ────────────────── Default: generic finding-summary CSV ───────────
    default: {
      return {
        csvHeader: 'Id,RecordType,Title,GapUsd,Currency,Notes',
        csvRow: [
          csvField(r.primary_record?.id),
          csvField(r.primary_record?.type),
          csvField(finding.title),
          csvField(finding.gap_usd),
          csvField(finding.currency_iso_code),
          csvField(finding.description ?? ''),
        ].join(','),
        actionLabel: 'Review and patch manually',
        filename: `recovery-${finding.detector_id}-${finding.id}.csv`,
        projectedReclaimUsd,
      };
    }
  }
}

/**
 * Group a set of payloads by their CSV header so the bulk download
 * produces well-formed multi-row CSVs (one section per detector
 * shape). Header rows can't mix across detectors — Data Loader will
 * reject a CSV with inconsistent columns.
 */
export interface PayloadBundle {
  detectorIds: string[];
  csvSections: Array<{ header: string; rows: string[]; detectorIds: string[] }>;
  totalProjectedReclaimUsd: number;
}

export function bundlePayloads(payloads: Array<RecoveryPayload & { detectorId: string }>): PayloadBundle {
  const byHeader = new Map<string, { header: string; rows: string[]; detectorIds: Set<string> }>();
  let total = 0;
  for (const p of payloads) {
    total += p.projectedReclaimUsd;
    const existing = byHeader.get(p.csvHeader);
    if (existing) {
      existing.rows.push(p.csvRow);
      existing.detectorIds.add(p.detectorId);
    } else {
      byHeader.set(p.csvHeader, {
        header: p.csvHeader,
        rows: [p.csvRow],
        detectorIds: new Set([p.detectorId]),
      });
    }
  }
  return {
    detectorIds: Array.from(new Set(payloads.map((p) => p.detectorId))),
    csvSections: Array.from(byHeader.values()).map((s) => ({
      header: s.header,
      rows: s.rows,
      detectorIds: Array.from(s.detectorIds),
    })),
    totalProjectedReclaimUsd: Math.round(total * 100) / 100,
  };
}
