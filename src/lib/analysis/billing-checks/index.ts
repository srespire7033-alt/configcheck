import type { BillingHealthCheck } from '@/types';
import { billingRuleChecks } from './billing-rules';
import { revRecRuleChecks } from './rev-rec-rules';
import { taxRuleChecks } from './tax-rules';
import { financeBookChecks } from './finance-books';
import { glRuleChecks } from './gl-rules';
import { legalEntityChecks } from './legal-entity';
import { productBillingConfigChecks } from './product-billing-config';
import { invoicingChecks } from './invoicing';

export const allBillingChecks: BillingHealthCheck[] = [
  ...billingRuleChecks,
  ...revRecRuleChecks,
  ...taxRuleChecks,
  ...financeBookChecks,
  ...glRuleChecks,
  ...legalEntityChecks,
  ...productBillingConfigChecks,
  ...invoicingChecks,
];
