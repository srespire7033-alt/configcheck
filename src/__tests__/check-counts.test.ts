import { describe, it, expect } from 'vitest';
import { allChecks } from '@/lib/analysis/checks';
import { allBillingChecks } from '@/lib/analysis/billing-checks';
import { armChecks } from '@/lib/analysis/arm-checks';
import { TOTAL_CHECKS, TOTAL_CATEGORIES } from '@/lib/analysis/constants';

/**
 * Drift guard for the marketing-copy check count.
 *
 * `TOTAL_CHECKS` is referenced on the homepage, dashboard, scan results,
 * OG meta tags, and the all-checks index page. If a developer adds a new
 * check without updating the constant, this test fails and the bad count
 * never ships.
 */
describe('check count constants', () => {
  it('TOTAL_CHECKS matches the actual sum of CPQ + Billing + ARM checks', () => {
    const actual = allChecks.length + allBillingChecks.length + armChecks.length;
    expect(TOTAL_CHECKS).toBe(actual);
  });

  it('TOTAL_CATEGORIES matches the unique `category` values across all check suites', () => {
    const categories = new Set<string>();
    for (const c of allChecks) categories.add(c.category);
    for (const c of allBillingChecks) categories.add(c.category);
    for (const c of armChecks) categories.add(c.category);
    expect(TOTAL_CATEGORIES).toBe(categories.size);
  });
});
