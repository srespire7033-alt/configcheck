import { LightningElement } from 'lwc';

/**
 * Visual sanity-check for Phase 1 primitives. Drop this LWC onto any
 * Lightning App / Home / Record page to see dashboardCard +
 * severityBadge + moneyDisplay rendering side-by-side with realistic
 * compositions. Delete after Phase 2 lands — preview-only.
 */
export default class DashboardPreview extends LightningElement {
  // Sample numbers chosen to exercise all three money-display sizes
  // + each severity tier + at least one card variant.
  heroValue = 247500;
  largeValue = 12450;
  mediumValue = 850;
  smallValue = 42;
  zeroValue = 0;
  millionValue = 1247500;

  criticalCount = 14;
  warningCount = 23;
  infoCount = 8;
}
