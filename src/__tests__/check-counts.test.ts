import { describe, it, expect } from 'vitest';
import { allChecks } from '@/lib/analysis/checks';
import { allBillingChecks } from '@/lib/analysis/billing-checks';
import { armChecks } from '@/lib/analysis/arm-checks';
import {
  TOTAL_CHECKS,
  TOTAL_CATEGORIES,
  CPQ_CHECKS_COUNT,
  BILLING_CHECKS_COUNT,
  ARM_CHECKS_COUNT,
  CPQ_CATEGORIES_COUNT,
  BILLING_CATEGORIES_COUNT,
  ARM_CATEGORIES_COUNT,
} from '@/lib/analysis/constants';

/**
 * Drift guard for the marketing-copy check counts.
 *
 * These constants are referenced on the homepage (per-suite breakdown
 * cards), the dashboard, scan results, OG meta tags, and the all-checks
 * index page. If a developer adds a check anywhere without bumping the
 * matching constant, these tests fail and the bad number never ships.
 */
describe('check count constants', () => {
  it('CPQ_CHECKS_COUNT matches allChecks.length', () => {
    expect(CPQ_CHECKS_COUNT).toBe(allChecks.length);
  });

  it('BILLING_CHECKS_COUNT matches allBillingChecks.length', () => {
    expect(BILLING_CHECKS_COUNT).toBe(allBillingChecks.length);
  });

  it('ARM_CHECKS_COUNT matches armChecks.length', () => {
    expect(ARM_CHECKS_COUNT).toBe(armChecks.length);
  });

  it('TOTAL_CHECKS matches the actual sum of all three suites', () => {
    expect(TOTAL_CHECKS).toBe(allChecks.length + allBillingChecks.length + armChecks.length);
  });

  it('CPQ_CATEGORIES_COUNT matches unique CPQ category values', () => {
    const cats = new Set(allChecks.map((c) => c.category));
    expect(CPQ_CATEGORIES_COUNT).toBe(cats.size);
  });

  it('BILLING_CATEGORIES_COUNT matches unique Billing category values', () => {
    const cats = new Set(allBillingChecks.map((c) => c.category));
    expect(BILLING_CATEGORIES_COUNT).toBe(cats.size);
  });

  it('ARM_CATEGORIES_COUNT matches unique ARM category values', () => {
    const cats = new Set(armChecks.map((c) => c.category));
    expect(ARM_CATEGORIES_COUNT).toBe(cats.size);
  });

  it('TOTAL_CATEGORIES matches unique `category` values across all suites', () => {
    const categories = new Set<string>();
    for (const c of allChecks) categories.add(c.category);
    for (const c of allBillingChecks) categories.add(c.category);
    for (const c of armChecks) categories.add(c.category);
    expect(TOTAL_CATEGORIES).toBe(categories.size);
  });
});
