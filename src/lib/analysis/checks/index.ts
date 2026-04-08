import type { HealthCheck } from '@/types';
import { priceRuleChecks } from './price-rules';
import { discountScheduleChecks } from './discount-schedules';
import { productChecks } from './products';
import { productRuleChecks } from './product-rules';
import { cpqSettingsChecks } from './cpq-settings';
import { quoteLineChecks } from './quote-lines';
import { subscriptionChecks } from './subscriptions';
import { twinFieldChecks } from './twin-fields';
import { contractedPriceChecks } from './contracted-prices';

/**
 * All registered health checks — 24 total
 * Add new check modules here
 */
export const allChecks: HealthCheck[] = [
  ...priceRuleChecks,        // PR-001 to PR-005
  ...discountScheduleChecks, // DS-001 to DS-004
  ...productChecks,          // PB-001 to PB-004
  ...productRuleChecks,      // PRD-001 to PRD-004
  ...cpqSettingsChecks,      // SET-001 to SET-004
  ...quoteLineChecks,        // QL-001 to QL-003
  ...subscriptionChecks,     // SR-001, SR-002
  ...twinFieldChecks,        // TF-001
  ...contractedPriceChecks,  // CP-001
];
