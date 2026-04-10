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
import { summaryVariableChecks } from './summary-variables';
import { approvalRuleChecks } from './approval-rules';
import { customScriptChecks } from './custom-scripts';
import { quoteTemplateChecks } from './quote-templates';
import { configurationAttributeChecks } from './configuration-attributes';
import { guidedSellingChecks } from './guided-selling';
import { advancedPricingChecks } from './advanced-pricing';

/**
 * All registered health checks — 49 total
 * Add new check modules here
 */
export const allChecks: HealthCheck[] = [
  ...priceRuleChecks,               // PR-001 to PR-005
  ...discountScheduleChecks,        // DS-001 to DS-004
  ...productChecks,                 // PB-001 to PB-004
  ...productRuleChecks,             // PRD-001 to PRD-004
  ...cpqSettingsChecks,             // SET-001 to SET-004
  ...quoteLineChecks,               // QL-001 to QL-003
  ...subscriptionChecks,            // SR-001, SR-002
  ...twinFieldChecks,               // TF-001
  ...contractedPriceChecks,         // CP-001
  ...summaryVariableChecks,         // SV-001 to SV-005
  ...approvalRuleChecks,            // AR-001 to AR-004
  ...customScriptChecks,            // QCP-001 to QCP-004
  ...quoteTemplateChecks,           // QT-001 to QT-004
  ...configurationAttributeChecks,  // CA-001 to CA-004
  ...guidedSellingChecks,           // GS-001 to GS-003
  ...advancedPricingChecks,         // AP-001 to AP-004
];
