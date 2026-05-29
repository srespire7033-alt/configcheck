/**
 * Marketing copy constants — single source of truth for the check count
 * and category count that appears on the homepage, in dashboards, in OG
 * meta tags, and anywhere we tell users how big the audit is.
 *
 * Hardcoded rather than derived to keep the (heavy) check library out of
 * the marketing-page bundle. Kept honest by
 * `src/__tests__/check-counts.test.ts`, which imports the actual check
 * arrays and asserts these constants match. When you add or remove a
 * check, that test will fail until you bump these numbers.
 */

// Per-suite counts. Derived numbers — the drift-guard test asserts they
// match the live check arrays so adding/removing a check anywhere causes
// CI to fail until the constant gets bumped.
export const CPQ_CHECKS_COUNT = 92;
export const BILLING_CHECKS_COUNT = 39;
export const ARM_CHECKS_COUNT = 78;

export const CPQ_CATEGORIES_COUNT = 19;
export const BILLING_CATEGORIES_COUNT = 8;
export const ARM_CATEGORIES_COUNT = 22;

export const TOTAL_CHECKS = CPQ_CHECKS_COUNT + BILLING_CHECKS_COUNT + ARM_CHECKS_COUNT;
export const TOTAL_CATEGORIES =
  CPQ_CATEGORIES_COUNT + BILLING_CATEGORIES_COUNT + ARM_CATEGORIES_COUNT;
