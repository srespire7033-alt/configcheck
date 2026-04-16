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
import { performanceChecks } from './performance';
import { impactAnalysisChecks } from './impact-analysis';
import { usageAnalyticsChecks } from './usage-analytics';
import { bundleIntegrityChecks } from './bundle-integrity';
import { lookupQueryChecks } from './lookup-queries';

/**
 * All registered health checks — 94 total
 * Add new check modules here
 */
export const allChecks: HealthCheck[] = [
  ...priceRuleChecks,               // PR-001 to PR-005 (5)
  ...discountScheduleChecks,        // DS-001 to DS-004 (4)
  ...productChecks,                 // PB-001 to PB-004 (4)
  ...productRuleChecks,             // PRD-001 to PRD-005 (5)
  ...cpqSettingsChecks,             // SET-001 to SET-004 (4)
  ...quoteLineChecks,               // QL-001 to QL-004 (4)
  ...subscriptionChecks,            // SR-001 to SR-004 (4)
  ...twinFieldChecks,               // TF-001 (1)
  ...contractedPriceChecks,         // CP-001 to CP-003 (3)
  ...summaryVariableChecks,         // SV-001 to SV-006 (6)
  ...approvalRuleChecks,            // AR-001 to AR-005 (5)
  ...customScriptChecks,            // QCP-001 to QCP-004 (4)
  ...quoteTemplateChecks,           // QT-001 to QT-005 (5)
  ...configurationAttributeChecks,  // CA-001 to CA-004 (4)
  ...guidedSellingChecks,           // GS-001 to GS-004 (4)
  ...advancedPricingChecks,         // AP-001 to AP-005 (5)
  ...performanceChecks,             // PERF-001 to PERF-005 (5)
  ...impactAnalysisChecks,          // IA-001 to IA-006 (6)
  ...usageAnalyticsChecks,          // UA-001 to UA-003 (3)
  ...bundleIntegrityChecks,         // BN-001 to BN-005 (5)
  ...lookupQueryChecks,             // LQ-001 to LQ-005 (5)
];
