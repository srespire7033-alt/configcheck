/**
 * DSC-FOR-001 — Promo Discount Roll-Off Failure
 *
 * Detects QuoteLines / OrderItems where a discount keeps being applied
 * past when it should have stopped. Two distinct sub-cases, both produce
 * recurring leakage that compounds across every billing period:
 *
 *   (a) Schedule has an explicit SBQQ__EndDate__c in the past, but lines
 *       created AFTER that date still reference the schedule and apply
 *       its discount. Governance gap: no validation rule stops the
 *       discount from being used after expiry.
 *
 *   (b) Schedule has NO SBQQ__EndDate__c (null). The discount was
 *       intended as a one-time promo (name contains "promo", "intro",
 *       "trial", "new logo", etc.) but the missing end date means it
 *       keeps applying forever. Governance gap: end date wasn't set in
 *       the first place.
 *
 * Both cases emit per-line findings with verified $:
 *   gap = SBQQ__ListPrice__c × SBQQ__Quantity__c × (SBQQ__Discount__c / 100)
 *
 * The detector uses bulk reads but with a smaller scope than REN-001
 * — discount schedules are usually under 100 per org, and the line
 * pull is filtered by SBQQ__DiscountSchedule__c IS NOT NULL.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface DiscountScheduleRow {
  Id: string;
  Name: string;
  /** Aliased — present only when a start-date column was found via describe. */
  StartDate?: string | null;
  /** Aliased — present only when an end-date column was found via describe. */
  EndDate?: string | null;
  Type?: string | null;
}

interface DiscountedLineRow {
  Id: string;
  Name: string;
  SBQQ__Quote__c: string;
  'SBQQ__Quote__r.Name': string;
  SBQQ__Product__c: string;
  'SBQQ__Product__r.Name': string;
  SBQQ__DiscountSchedule__c: string;
  SBQQ__Discount__c: string;     // % discount applied (e.g. "25" for 25%)
  SBQQ__ListPrice__c: string;
  SBQQ__NetPrice__c: string;
  SBQQ__Quantity__c: string;
  CreatedDate: string;
}

// Promo keywords — used to flag sub-case (b) (null EndDate). A schedule
// named "Strategic Account Discount" with no end date might be
// intentional. One named "2025 Q1 New Logo Promo" with no end date
// almost certainly isn't.
const PROMO_KEYWORDS = ['promo', 'intro', 'trial', 'new logo', 'pilot', 'beta', 'launch', 'seasonal', 'limited'];

const DSC_FOR_001: ForensicDetector = {
  id: 'DSC-FOR-001',
  label: 'Promo discount expired but price never restored',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    // Standard CPQ DiscountSchedules don't have date fields — only the
    // 'Advanced Discounting' or custom-field configurations do. Describe
    // the object to learn what's present, then build the SELECT to
    // include whatever date columns exist. Schedules without date
    // tracking get detected via the name-keyword path only.
    const dsDesc = (await ctx.conn.describe('SBQQ__DiscountSchedule__c')) as { fields: Array<{ name: string }> };
    const dsFields = new Set(dsDesc.fields.map((f) => f.name));
    const startDateCol = ['SBQQ__StartDate__c', 'Start_Date__c', 'StartDate__c'].find((c) => dsFields.has(c));
    const endDateCol = ['SBQQ__EndDate__c', 'End_Date__c', 'EndDate__c', 'SBQQ__ExpirationDate__c', 'Expiration_Date__c'].find((c) => dsFields.has(c));
    const typeCol = dsFields.has('SBQQ__Type__c') ? 'SBQQ__Type__c' : null;

    const cols = ['Id', 'Name'];
    if (startDateCol) cols.push(`${startDateCol} StartDate`);
    if (endDateCol) cols.push(`${endDateCol} EndDate`);
    if (typeCol) cols.push(`${typeCol} Type`);

    // Regular SOQL — Discount Schedules are bounded (<500 per org).
    // Bulk API's submit+poll overhead would dwarf the actual query time.
    const schedulesRes = await ctx.conn.query<DiscountScheduleRow>(
      `SELECT ${cols.join(', ')} FROM SBQQ__DiscountSchedule__c`,
      { autoFetch: true, maxFetch: 10_000 }
    );
    if (schedulesRes.records.length === 0) return [];

    const today = new Date();
    const schedulesById = new Map<string, DiscountScheduleRow>();
    const expiredScheduleIds: string[] = [];
    const promoNullEndScheduleIds: string[] = [];

    for (const s of schedulesRes.records) {
      schedulesById.set(s.Id, s);
      if (s.EndDate) {
        const end = new Date(s.EndDate);
        if (end < today) expiredScheduleIds.push(s.Id);
      } else {
        // No end date — only treat as leaky if name suggests a promo.
        // A legit perpetual discount (e.g. "Strategic Account") shouldn't
        // fire DSC-FOR-001. A "2024 New Logo Promo" with no end date
        // almost certainly should.
        const name = (s.Name || '').toLowerCase();
        if (PROMO_KEYWORDS.some((kw) => name.includes(kw))) {
          promoNullEndScheduleIds.push(s.Id);
        }
      }
    }

    const candidateScheduleIds = [...expiredScheduleIds, ...promoNullEndScheduleIds];
    if (candidateScheduleIds.length === 0) return [];

    // 2. Pull QuoteLines that reference any candidate schedule AND have
    //    a non-zero discount applied. We cap at 24 months of data —
    //    older lines are usually out of recovery reach.
    const sinceIso = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();
    const idLiterals = candidateScheduleIds.map((id) => `'${id}'`).join(',');
    const linesQuery = `
      SELECT Id, Name,
        SBQQ__Quote__c, SBQQ__Quote__r.Name,
        SBQQ__Product__c, SBQQ__Product__r.Name,
        SBQQ__DiscountSchedule__c,
        SBQQ__Discount__c, SBQQ__ListPrice__c, SBQQ__NetPrice__c, SBQQ__Quantity__c,
        CreatedDate
      FROM SBQQ__QuoteLine__c
      WHERE SBQQ__DiscountSchedule__c IN (${idLiterals})
        AND SBQQ__Discount__c != null
        AND SBQQ__Discount__c > 0
        AND CreatedDate >= ${sinceIso}
    `;
    const linesRes = await ctx.conn.query<DiscountedLineRow>(linesQuery, {
      autoFetch: true,
      maxFetch: 50_000,
    });

    // 3. Reconcile per-line.
    const findings: DetectorResult[] = [];
    for (const line of linesRes.records) {
      const schedule = schedulesById.get(line.SBQQ__DiscountSchedule__c);
      if (!schedule) continue;

      // Sub-case routing:
      //   (a) expired: line was created after schedule's EndDate
      //   (b) null-end promo: name contains promo keyword, no EndDate
      const isExpired = !!schedule.EndDate &&
        new Date(line.CreatedDate) > new Date(schedule.EndDate);
      const isNullEndPromo = !schedule.EndDate &&
        promoNullEndScheduleIds.includes(schedule.Id);

      if (!isExpired && !isNullEndPromo) continue;

      const listPrice = parseFloat(line.SBQQ__ListPrice__c || '0');
      const quantity = parseFloat(line.SBQQ__Quantity__c || '1') || 1;
      const discountPct = parseFloat(line.SBQQ__Discount__c || '0');
      if (listPrice <= 0 || discountPct <= 0) continue;

      const discountFraction = discountPct > 1 ? discountPct / 100 : discountPct;
      // Gap = the discount that shouldn't have been applied
      const gap = listPrice * quantity * discountFraction;
      if (gap < 1) continue;

      const subCase: 'expired' | 'null_end_promo' = isExpired ? 'expired' : 'null_end_promo';

      const primaryRecord: SourceRecord = {
        type: 'SBQQ__QuoteLine__c',
        id: line.Id,
        name: line.Name,
        financials: {
          list_price: listPrice,
          quantity,
          discount_pct: discountPct,
          discount_amount: gap,
        },
      };
      const supportingRecords: SourceRecord[] = [
        {
          type: 'SBQQ__Quote__c',
          id: line.SBQQ__Quote__c,
          name: line['SBQQ__Quote__r.Name'],
        },
        {
          type: 'SBQQ__DiscountSchedule__c',
          id: schedule.Id,
          name: schedule.Name,
          financials: {
            // Stored as ISO strings so the renderer can format them.
            ...(schedule.StartDate && { start_date: schedule.StartDate }),
            ...(schedule.EndDate && { end_date: schedule.EndDate }),
          },
        },
        {
          type: 'Product2',
          id: line.SBQQ__Product__c,
          name: line['SBQQ__Product__r.Name'] || line.SBQQ__Product__c,
        },
      ];

      const subCaseTitle =
        subCase === 'expired'
          ? `applied past expiry of "${schedule.Name}"`
          : `applied indefinitely from open-ended promo "${schedule.Name}"`;

      findings.push({
        detectorId: 'DSC-FOR-001',
        severity: gap >= 10_000 ? 'critical' : gap >= 1_000 ? 'warning' : 'info',
        entitledUsd: round2(listPrice * quantity),
        realizedUsd: round2(listPrice * quantity * (1 - discountFraction)),
        gapUsd: round2(gap),
        currencyIsoCode: ctx.defaultCurrencyIsoCode,
        // Discount roll-off is highly recoverable on next invoice/renewal
        // — the customer-facing conversation is "this promo ended, here's
        // the standard price going forward." Less common to claw back
        // already-invoiced past periods.
        recoverabilityScore: 0.85,
        primaryRecord,
        supportingRecords,
        title: `Discount ${subCaseTitle}`,
        description: `${discountPct}% discount on ${line['SBQQ__Product__r.Name'] || 'product'} — schedule ${
          subCase === 'expired'
            ? `ended ${schedule.EndDate}`
            : `has no end date`
        }.`,
        metadata: {
          sub_case: subCase,
          schedule_end_date: schedule.EndDate,
          discount_pct: discountPct,
          list_price_per_unit: listPrice,
          line_created_at: line.CreatedDate,
        },
      });
    }

    return findings;
  },
};

export default DSC_FOR_001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
