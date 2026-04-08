import type { HealthCheck } from '@/types';
import { priceRuleChecks } from './price-rules';
import { discountScheduleChecks } from './discount-schedules';
import { productChecks } from './products';
import { productRuleChecks } from './product-rules';
import { cpqSettingsChecks } from './cpq-settings';
import { quoteLineChecks } from './quote-lines';
import { subscriptionChecks } from './subscriptions';

/**
 * All registered health checks
 * Add new check modules here
 */
export const allChecks: HealthCheck[] = [
  ...priceRuleChecks,
  ...discountScheduleChecks,
  ...productChecks,
  ...productRuleChecks,
  ...cpqSettingsChecks,
  ...quoteLineChecks,
  ...subscriptionChecks,
];
