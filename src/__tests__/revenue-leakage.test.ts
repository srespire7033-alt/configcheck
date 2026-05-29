import { describe, it, expect } from 'vitest';
import { calculateRevenueLeakage, resolveAssumptions, DEFAULT_ASSUMPTIONS } from '@/lib/analysis/revenue-leakage';
import { checksWithFormulas, INDUSTRY_DEFAULTS } from '@/lib/analysis/revenue-formulas';
import type { Issue } from '@/types';
import type { RevenueBaseline } from '@/lib/salesforce/queries-revenue-baseline';

function makeIssue(checkId: string, affectedCount = 1, overrides: Partial<Issue> = {}): Issue {
  return {
    check_id: checkId,
    category: 'price_rules',
    severity: 'critical',
    title: `Test ${checkId}`,
    description: 'Test issue',
    impact: 'Test impact',
    recommendation: 'Test rec',
    affected_records: Array.from({ length: affectedCount }, (_, i) => ({
      id: `00x${i.toString().padStart(15, '0')}`,
      name: `Record ${i}`,
      type: 'Test',
    })),
    revenue_impact: null,
    effort_hours: null,
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<RevenueBaseline> = {}): RevenueBaseline {
  return {
    median_deal_size: 50_000,
    mean_deal_size: 75_000,
    annual_revenue: 10_000_000,
    avg_discount_pct: 12,
    median_days_to_invoice: 14,
    source: 'opportunity',
    sample_size: 500,
    confidence: 'high',
    currency_iso_code: 'USD',
    audit: {
      queried_at: '2026-05-29T00:00:00Z',
      queries_attempted: [],
      queries_succeeded: [],
      notes: [],
    },
    ...overrides,
  };
}

describe('revenue-leakage engine', () => {
  describe('calculateRevenueLeakage', () => {
    it('returns zero leakage when there are no issues', () => {
      const out = calculateRevenueLeakage([], makeBaseline());
      expect(out.estimated_annual_leakage).toBe(0);
      expect(out.top_contributors).toEqual([]);
      expect(out.coverage.issues_evaluated).toBe(0);
    });

    it('skips issues that have no formula registered', () => {
      const issues = [makeIssue('SOME-CHECK-WITHOUT-FORMULA-XYZ', 5)];
      const out = calculateRevenueLeakage(issues, makeBaseline());
      expect(out.estimated_annual_leakage).toBe(0);
      expect(out.coverage.issues_evaluated).toBe(1);
      expect(out.coverage.issues_with_formula).toBe(0);
    });

    it('applies QL-001 formula (zero NetPrice quote lines)', () => {
      // QL-001: count × median × 1.0 × 0.7 × ltv
      // With SaaS (LTV 4): 5 × 50000 × 1.0 × 0.7 × 4 = 700,000
      const issues = [makeIssue('QL-001', 5)];
      const out = calculateRevenueLeakage(issues, makeBaseline(), { industry: 'saas' });
      expect(out.estimated_annual_leakage).toBe(700_000);
      expect(out.coverage.issues_with_impact).toBe(1);
      expect(out.top_contributors).toHaveLength(1);
      expect(out.top_contributors[0].check_id).toBe('QL-001');
    });

    it('SaaS LTV multiplier compounds vs manufacturing (one-time)', () => {
      const saasOut = calculateRevenueLeakage([makeIssue('QL-001', 5)], makeBaseline(), { industry: 'saas' });
      const mfgOut = calculateRevenueLeakage([makeIssue('QL-001', 5)], makeBaseline(), { industry: 'manufacturing' });
      // SaaS = 4× LTV; mfg = 1× LTV → SaaS should be 4× higher
      expect(saasOut.estimated_annual_leakage).toBe(mfgOut.estimated_annual_leakage * 4);
    });

    it('aggregates multiple findings and ranks top contributors by impact', () => {
      const issues = [
        makeIssue('QL-001', 1), // small
        makeIssue('QL-001', 10), // big
        makeIssue('QL-002', 3),
      ];
      const out = calculateRevenueLeakage(issues, makeBaseline(), { industry: 'manufacturing' });
      expect(out.top_contributors.length).toBe(3);
      // Top contributor should be the larger QL-001 (10 records)
      expect(out.top_contributors[0].impact).toBeGreaterThan(out.top_contributors[1].impact);
    });

    it('caps top_contributors at 10', () => {
      const issues = Array.from({ length: 20 }, (_, i) => makeIssue('QL-001', i + 1));
      const out = calculateRevenueLeakage(issues, makeBaseline());
      expect(out.top_contributors.length).toBeLessThanOrEqual(10);
    });

    it('falls back to system defaults when baseline has no data', () => {
      const baseline = makeBaseline({
        median_deal_size: null,
        mean_deal_size: null,
        annual_revenue: null,
        source: 'default',
        sample_size: 0,
        confidence: 'unknown',
      });
      const out = calculateRevenueLeakage([makeIssue('QL-001', 1)], baseline, { industry: 'saas' });
      // System default median = $10K, so: 1 × 10000 × 0.7 × 4 = 28000
      expect(out.estimated_annual_leakage).toBe(28_000);
      expect(out.audit.notes.some((n) => n.includes('system defaults'))).toBe(true);
    });

    it('marks low confidence when sample size is below threshold', () => {
      const baseline = makeBaseline({ sample_size: 10, confidence: 'low' });
      const out = calculateRevenueLeakage([makeIssue('QL-001', 1)], baseline, {
        industry: 'saas',
        confidence_min_sample: 50,
      });
      expect(out.confidence).toBe('low');
      expect(out.audit.notes.some((n) => n.toLowerCase().includes('confidence'))).toBe(true);
    });

    it('uses median by default but switches to mean when use_median=false', () => {
      const baseline = makeBaseline({ median_deal_size: 20_000, mean_deal_size: 100_000 });
      const issues = [makeIssue('QL-001', 1)];
      const medianOut = calculateRevenueLeakage(issues, baseline, { industry: 'manufacturing', use_median: true });
      const meanOut = calculateRevenueLeakage(issues, baseline, { industry: 'manufacturing', use_median: false });
      expect(meanOut.estimated_annual_leakage).toBe(medianOut.estimated_annual_leakage * 5);
    });

    it('computes percent_of_revenue when annual_revenue is real', () => {
      const baseline = makeBaseline({ annual_revenue: 5_000_000 });
      const issues = [makeIssue('QL-001', 2)]; // 2 × 50K × 0.7 × 4 (SaaS) = 280K
      const out = calculateRevenueLeakage(issues, baseline, { industry: 'saas' });
      // 280000 / 5000000 = 5.6%
      expect(out.percent_of_revenue).toBeCloseTo(5.6, 1);
    });

    it('keeps audit trail with formula version + computed_at timestamp', () => {
      const out = calculateRevenueLeakage([], makeBaseline());
      expect(out.audit.formula_version).toMatch(/^\d{4}\.\d{2}\.\d{2}/);
      expect(out.audit.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(out.audit.baseline_source).toBe('opportunity');
      expect(out.audit.industry_used).toBe('saas');
    });

    it('every formula returns a positive impact for positive inputs', () => {
      // Smoke test the whole formula table — if any returns NaN or
      // negative, it'll show up here
      const baseline = makeBaseline();
      for (const checkId of checksWithFormulas()) {
        const out = calculateRevenueLeakage([makeIssue(checkId, 3)], baseline, { industry: 'saas' });
        expect(Number.isFinite(out.estimated_annual_leakage)).toBe(true);
        expect(out.estimated_annual_leakage).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('resolveAssumptions', () => {
    it('falls back to system defaults when no overrides', () => {
      const r = resolveAssumptions(null, null);
      expect(r.industry).toBe(DEFAULT_ASSUMPTIONS.industry);
      expect(r.use_median).toBe(DEFAULT_ASSUMPTIONS.use_median);
    });

    it('per-org overrides take priority over per-user', () => {
      const r = resolveAssumptions(
        { industry: 'manufacturing' },
        { industry: 'saas', use_median: false }
      );
      expect(r.industry).toBe('manufacturing');
      expect(r.use_median).toBe(false); // came from user
    });

    it('per-user overrides take priority over system defaults', () => {
      const r = resolveAssumptions(null, { industry: 'financial' });
      expect(r.industry).toBe('financial');
    });
  });

  describe('INDUSTRY_DEFAULTS', () => {
    it('every industry has the required profile fields', () => {
      for (const ind of Object.keys(INDUSTRY_DEFAULTS) as Array<keyof typeof INDUSTRY_DEFAULTS>) {
        const p = INDUSTRY_DEFAULTS[ind];
        expect(typeof p.ltv_multiplier).toBe('number');
        expect(p.ltv_multiplier).toBeGreaterThan(0);
        expect(typeof p.is_recurring).toBe('boolean');
        expect(p.default_discount_leak_rate).toBeGreaterThan(0);
        expect(p.default_discount_leak_rate).toBeLessThan(1);
      }
    });

    it('SaaS has the highest LTV multiplier (recurring revenue compounds)', () => {
      expect(INDUSTRY_DEFAULTS.saas.ltv_multiplier).toBeGreaterThanOrEqual(INDUSTRY_DEFAULTS.manufacturing.ltv_multiplier);
    });
  });
});
