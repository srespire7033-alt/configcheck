-- Allow ARM (Revenue Cloud) issue categories on the issues table.
-- ARM/RLM is a native Salesforce platform feature, not a managed package
-- like CPQ (SBQQ__) or Billing (blng__) — categories are prefixed `arm_`
-- to keep the namespace clear.

alter table public.issues drop constraint if exists issues_category_check;

alter table public.issues
  add constraint issues_category_check
  check (category in (
    -- CPQ
    'price_rules', 'discount_schedules', 'products', 'product_rules',
    'cpq_settings', 'subscriptions', 'twin_fields', 'contracted_prices', 'quote_lines',
    'summary_variables', 'approval_rules', 'quote_calculator_plugin',
    'quote_templates', 'configuration_attributes', 'guided_selling', 'advanced_pricing',
    'performance', 'impact_analysis', 'bundles', 'lookup_queries',
    -- Billing
    'billing_rules', 'rev_rec_rules', 'tax_rules', 'finance_books',
    'gl_rules', 'legal_entity', 'product_billing_config', 'invoicing',
    -- ARM (Revenue Cloud / RLM)
    'arm_product_catalog', 'arm_selling_models', 'arm_price_adjustments',
    'arm_attribute_pricing', 'arm_bundles', 'arm_pricing_procedures',
    'arm_price_books', 'arm_decision_tables', 'arm_context_service'
  ));

insert into public.schema_migrations (version) values ('20260430210000_arm_issue_categories')
on conflict (version) do nothing;
