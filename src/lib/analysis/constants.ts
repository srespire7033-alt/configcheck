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

export const TOTAL_CHECKS = 209;
export const TOTAL_CATEGORIES = 49;
