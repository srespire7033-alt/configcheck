/**
 * MDQ-FOR-001 — MDQ segment pricing inconsistency.
 *
 * Pattern: a multi-year MDQ (Multi-Dimensional Quoting) subscription
 * has segment quote lines (Year 1, Year 2, Year 3) where the
 * year-over-year uplift wasn't applied. Year 2 should be Y1 × (1 +
 * uplift%), Year 3 should be Y2 × (1 + uplift%). When CPQ's
 * segmentation logic doesn't compound the uplift, the out-years are
 * priced at Year 1 — the customer locks in flat pricing on a
 * multi-year deal.
 *
 * Detection model:
 *   1. Probe SBQQ__SegmentIndex__c and SBQQ__UpgradedSubscription__c.
 *      Both are MDQ-specific. Skip if absent.
 *   2. Pull QuoteLines with SBQQ__SegmentIndex__c >= 1 (Year 2+).
 *   3. Group by (Quote, RootProduct) — find the Year-1 sibling.
 *   4. Compare NetPrice of Year N vs Year 1 expected_uplifted_price.
 *   5. If flat (Y2.net ≈ Y1.net), flag.
 *
 * Gap = (expected_uplifted_price - actual_price) × quantity per segment.
 *
 * Category: revenue_leakage.
 */

import type { DetectorContext, DetectorResult, ForensicDetector, SourceRecord } from '../types';

interface SegmentLineRow {
  Id: string;
  Name: string;
  SBQQ__Quote__c: string;
  SBQQ__Product__c: string | null;
  SBQQ__Product__r?: { Name?: string } | null;
  SBQQ__NetPrice__c: string | number | null;
  SBQQ__Quantity__c: string | number | null;
  SBQQ__SegmentIndex__c?: number | null;
  SBQQ__UpgradedSubscription__c?: string | null;
}

const DEFAULT_UPLIFT_PCT = 5;

const MDQ_FOR_001: ForensicDetector = {
  id: 'MDQ-FOR-001',
  label: 'MDQ segment Year-N priced flat vs Year-1 (no uplift)',
  appliesTo: ['cpq', 'cpq_billing'],
  freeTier: false,
  category: 'revenue_leakage',

  async run(ctx: DetectorContext): Promise<DetectorResult[]> {
    // MDQ is opt-in CPQ functionality. Probe the field; bail if absent.
    let hasSegmentIndex = false;
    try {
      const qlDesc = await ctx.conn.describe('SBQQ__QuoteLine__c');
      hasSegmentIndex = qlDesc.fields.some((f) => f.name === 'SBQQ__SegmentIndex__c');
    } catch {
      hasSegmentIndex = false;
    }
    if (!hasSegmentIndex) {
      console.log('[MDQ-FOR-001] SBQQ__SegmentIndex__c not in org — MDQ not used, skipping');
      return [];
    }

    const sinceIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    // Pull segmented lines. CPQ creates one line per segment per
    // product, with SegmentIndex 0,1,2,... for Year 1, Year 2, etc.
    const res = await ctx.conn.query<SegmentLineRow>(`
      SELECT Id, Name, SBQQ__Quote__c, SBQQ__Product__c, SBQQ__Product__r.Name,
             SBQQ__NetPrice__c, SBQQ__Quantity__c, SBQQ__SegmentIndex__c
      FROM SBQQ__QuoteLine__c
      WHERE SBQQ__SegmentIndex__c != null
        AND CreatedDate >= ${sinceIso}
    `);
    console.log(`[MDQ-FOR-001] MDQ segmented lines: ${res.records.length}`);
    if (res.records.length === 0) return [];

    // Group by (Quote, Product) → array of segments sorted by index.
    interface SegGroup {
      quoteId: string;
      productId: string | null;
      productName: string;
      segments: SegmentLineRow[];
    }
    const groups = new Map<string, SegGroup>();
    for (const ln of res.records) {
      const key = `${ln.SBQQ__Quote__c}::${ln.SBQQ__Product__c ?? 'no-product'}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          quoteId: ln.SBQQ__Quote__c,
          productId: ln.SBQQ__Product__c,
          productName: ln.SBQQ__Product__r?.Name ?? ln.SBQQ__Product__c ?? 'Unknown',
          segments: [],
        };
        groups.set(key, g);
      }
      g.segments.push(ln);
    }

    const findings: DetectorResult[] = [];
    for (const g of Array.from(groups.values())) {
      // Sort by segment index ascending — Year 1 (idx=0) first.
      g.segments.sort((a, b) => Number(a.SBQQ__SegmentIndex__c ?? 0) - Number(b.SBQQ__SegmentIndex__c ?? 0));
      if (g.segments.length < 2) continue; // need at least Y1 + Y2

      const year1 = g.segments[0];
      const year1Net = Number(year1.SBQQ__NetPrice__c ?? 0);
      if (year1Net <= 0) continue;
      const upliftFraction = DEFAULT_UPLIFT_PCT / 100;

      // For each Year N (N >= 1), expected = Y1 × (1 + uplift)^N
      // Flag if actual is below expected by > $1.
      let totalGap = 0;
      const segmentDetails: Array<{ segment: number; expected: number; actual: number; gap: number }> = [];
      for (let i = 1; i < g.segments.length; i++) {
        const seg = g.segments[i];
        const segIdx = Number(seg.SBQQ__SegmentIndex__c ?? i);
        const segQty = Number(seg.SBQQ__Quantity__c ?? 1);
        const expectedUnit = year1Net * Math.pow(1 + upliftFraction, segIdx);
        const actualUnit = Number(seg.SBQQ__NetPrice__c ?? 0);
        const segGap = (expectedUnit - actualUnit) * segQty;
        if (segGap > 1) {
          totalGap += segGap;
          segmentDetails.push({
            segment: segIdx,
            expected: round2(expectedUnit),
            actual: round2(actualUnit),
            gap: round2(segGap),
          });
        }
      }
      if (segmentDetails.length === 0) continue;

      const ccy = ctx.defaultCurrencyIsoCode;
      const primaryRecord: SourceRecord = {
        type: 'SBQQ__QuoteLine__c',
        id: year1.Id,
        name: year1.Name,
        financials: {
          year_1_net_price: year1Net,
          year_1_quantity: Number(year1.SBQQ__Quantity__c ?? 1),
          expected_uplift_pct: DEFAULT_UPLIFT_PCT,
          flagged_segments: segmentDetails.length,
        },
      };
      const supportingRecords: SourceRecord[] = [
        { type: 'SBQQ__Quote__c', id: g.quoteId, name: g.quoteId },
      ];
      if (g.productId) {
        supportingRecords.push({ type: 'Product2', id: g.productId, name: g.productName });
      }
      for (const seg of g.segments.slice(1, 4)) {
        supportingRecords.push({
          type: 'SBQQ__QuoteLine__c',
          id: seg.Id,
          name: `${seg.Name} (segment ${seg.SBQQ__SegmentIndex__c})`,
          financials: {
            net_price: Number(seg.SBQQ__NetPrice__c ?? 0),
            quantity: Number(seg.SBQQ__Quantity__c ?? 1),
            segment_index: Number(seg.SBQQ__SegmentIndex__c ?? 0),
          },
        });
      }

      findings.push({
        detectorId: 'MDQ-FOR-001',
        severity: totalGap >= 50_000 ? 'critical' : totalGap >= 5_000 ? 'warning' : 'info',
        entitledUsd: round2(year1Net + totalGap),
        realizedUsd: round2(year1Net),
        gapUsd: round2(totalGap),
        currencyIsoCode: ccy,
        recoverabilityScore: 0.7,
        primaryRecord,
        supportingRecords,
        title: `MDQ multi-year ${g.productName} priced flat across ${g.segments.length} segments (${ccy} ${Math.round(totalGap).toLocaleString()} uplift gap)`,
        description: `Multi-year segmented quote for ${g.productName}. Year 1 priced at ${ccy} ${year1Net.toFixed(2)}/unit. Expected ${DEFAULT_UPLIFT_PCT}% YoY uplift not applied in segments ${segmentDetails.map((s) => s.segment).join(', ')}. Total uplift forgone: ${ccy} ${Math.round(totalGap).toLocaleString()}.`,
        metadata: {
          quote_id: g.quoteId,
          product_id: g.productId,
          product_name: g.productName,
          segment_count: g.segments.length,
          year_1_net_price: year1Net,
          expected_uplift_pct: DEFAULT_UPLIFT_PCT,
          flagged_segments: segmentDetails,
        },
      });
    }

    console.log(`[MDQ-FOR-001] Emitting ${findings.length} findings (sum gap = $${Math.round(findings.reduce((s, f) => s + f.gapUsd, 0)).toLocaleString()})`);
    return findings;
  },
};

export default MDQ_FOR_001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
