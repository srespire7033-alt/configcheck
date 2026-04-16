import type { HealthCheck, CPQData, Issue } from '@/types';

export const quoteLineChecks: HealthCheck[] = [
  // QL-001: Zero NetPrice on Non-Zero Quantity
  {
    id: 'QL-001',
    name: 'Zero NetPrice on Non-Zero Quantity',
    category: 'quote_lines',
    severity: 'critical',
    description: 'Quote lines with quantity > 0 but NetPrice = 0',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const zeroPrice = data.quoteLines.filter(
        (ql) =>
          ql.SBQQ__Quantity__c !== null &&
          ql.SBQQ__Quantity__c > 0 &&
          (ql.SBQQ__NetPrice__c === 0 || ql.SBQQ__NetPrice__c === null) &&
          ql.SBQQ__ListPrice__c !== null &&
          ql.SBQQ__ListPrice__c > 0
      );

      if (zeroPrice.length > 0) {
        // Group by quote to avoid noise
        const byQuote: Record<string, typeof zeroPrice> = {};
        for (const ql of zeroPrice) {
          const quoteId = ql.SBQQ__Quote__c;
          if (!byQuote[quoteId]) byQuote[quoteId] = [];
          byQuote[quoteId].push(ql);
        }

        for (const [quoteId, lines] of Object.entries(byQuote)) {
          issues.push({
            check_id: 'QL-001',
            category: 'quote_lines',
            severity: 'critical',
            title: `${lines.length} quote line(s) with zero NetPrice`,
            description: `Quote ${quoteId} has ${lines.length} line(s) where Quantity > 0 and ListPrice > 0 but NetPrice = $0. Products: ${lines.slice(0, 3).map((l) => l.SBQQ__Product__r?.Name || 'Unknown').join(', ')}${lines.length > 3 ? ` and ${lines.length - 3} more` : ''}.`,
            impact: 'Revenue leakage - products are being given away for free. Check price rules, discount schedules, and subscription pricing configuration.',
            recommendation: 'Investigate the pricing waterfall: List Price → Price Rules → Discount Schedules → NetPrice. A Price Rule may be zeroing out the price, or Subscription Pricing may not be set correctly.',
            affected_records: lines.map((l) => ({
              id: l.Id,
              name: l.SBQQ__Product__r?.Name || 'Quote Line',
              type: 'SBQQ__QuoteLine__c',
            })),
          });
        }
      }

      return issues;
    },
  },

  // QL-002: NetTotal and NetPrice x Quantity Mismatch
  {
    id: 'QL-002',
    name: 'NetTotal Calculation Mismatch',
    category: 'quote_lines',
    severity: 'critical',
    description: 'NetTotal does not equal NetPrice x Quantity (accounting for proration)',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const mismatched = data.quoteLines.filter((ql) => {
        if (
          ql.SBQQ__NetPrice__c === null ||
          ql.SBQQ__Quantity__c === null ||
          ql.SBQQ__NetTotal__c === null
        ) return false;

        const expected = ql.SBQQ__NetPrice__c * ql.SBQQ__Quantity__c;
        const actual = ql.SBQQ__NetTotal__c;
        // Allow small rounding difference (0.02)
        const diff = Math.abs(expected - actual);
        // Only flag significant mismatches (> $1 and > 1% difference)
        return diff > 1 && diff / Math.abs(expected || 1) > 0.01;
      });

      if (mismatched.length > 0) {
        issues.push({
          check_id: 'QL-002',
          category: 'quote_lines',
          severity: 'critical',
          title: `${mismatched.length} quote line(s) with calculation mismatch`,
          description: `NetTotal does not equal NetPrice × Quantity on ${mismatched.length} line(s). This typically indicates prorate multiplier issues or custom calculator plugin interference. Example: "${mismatched[0].SBQQ__Product__r?.Name || 'Unknown'}" has NetPrice $${mismatched[0].SBQQ__NetPrice__c} × Qty ${mismatched[0].SBQQ__Quantity__c} = $${(mismatched[0].SBQQ__NetPrice__c! * mismatched[0].SBQQ__Quantity__c!).toFixed(2)} but NetTotal shows $${mismatched[0].SBQQ__NetTotal__c}.`,
          impact: 'Math is wrong somewhere in the calculation chain. Could indicate prorate multiplier, additional discount, or QCP issues.',
          recommendation: 'Check SBQQ__ProrateMultiplier__c, SBQQ__AdditionalDiscount__c, and any Quote Calculator Plugin logic for these lines.',
          affected_records: mismatched.slice(0, 10).map((l) => ({
            id: l.Id,
            name: l.SBQQ__Product__r?.Name || 'Quote Line',
            type: 'SBQQ__QuoteLine__c',
          })),
        });
      }

      return issues;
    },
  },

  // QL-003: Negative Net Totals
  {
    id: 'QL-003',
    name: 'Negative Net Totals',
    category: 'quote_lines',
    severity: 'warning',
    description: 'Quote lines with negative NetTotal values',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const negative = data.quoteLines.filter(
        (ql) => ql.SBQQ__NetTotal__c !== null && ql.SBQQ__NetTotal__c < 0
      );

      if (negative.length > 0) {
        issues.push({
          check_id: 'QL-003',
          category: 'quote_lines',
          severity: 'warning',
          title: `${negative.length} quote line(s) with negative totals`,
          description: `${negative.length} quote lines have negative NetTotal values. Examples: ${negative.slice(0, 3).map((l) => `"${l.SBQQ__Product__r?.Name || 'Unknown'}" ($${l.SBQQ__NetTotal__c})`).join(', ')}.`,
          impact: 'Negative totals may indicate accidental credits or over-discounting. Verify these are intentional (e.g., credit lines or amendment reductions).',
          recommendation: 'Review each negative line. For amendments, negative values are normal (quantity reductions). For new quotes, investigate the pricing configuration.',
          affected_records: negative.slice(0, 10).map((l) => ({
            id: l.Id,
            name: l.SBQQ__Product__r?.Name || 'Quote Line',
            type: 'SBQQ__QuoteLine__c',
          })),
        });
      }

      return issues;
    },
  },

  // QL-004: Excessive Discounting on Quote Lines
  {
    id: 'QL-004',
    name: 'Excessive Discounting on Quote Lines',
    category: 'quote_lines',
    severity: 'info',
    description: 'Quote lines where discounts exceed 50% of list price — may indicate over-discounting patterns',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const heavyDiscount = data.quoteLines.filter((ql) => {
        if (!ql.SBQQ__ListPrice__c || ql.SBQQ__ListPrice__c <= 0) return false;
        if (!ql.SBQQ__NetPrice__c && ql.SBQQ__NetPrice__c !== 0) return false;
        const discountPct = (1 - ql.SBQQ__NetPrice__c! / ql.SBQQ__ListPrice__c) * 100;
        return discountPct > 50;
      });

      if (heavyDiscount.length > 0) {
        issues.push({
          check_id: 'QL-004',
          category: 'quote_lines',
          severity: 'info',
          title: `${heavyDiscount.length} quote line(s) with >50% discount`,
          description: `${heavyDiscount.length} quote line(s) have an effective discount exceeding 50% of list price. Examples: ${heavyDiscount.slice(0, 3).map((l) => `"${l.SBQQ__Product__r?.Name || 'Unknown'}"`).join(', ')}.`,
          impact: 'Heavy discounting patterns may signal approval process gaps or margin erosion. Worth reviewing for profitability.',
          recommendation: 'Review discount approval rules. Consider adding guardrails for discounts above a certain threshold.',
          affected_records: heavyDiscount.slice(0, 10).map((l) => ({
            id: l.Id,
            name: l.SBQQ__Product__r?.Name || 'Quote Line',
            type: 'SBQQ__QuoteLine__c',
          })),
        });
      }

      return issues;
    },
  },
];
