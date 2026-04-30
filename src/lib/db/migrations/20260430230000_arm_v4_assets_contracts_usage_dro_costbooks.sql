-- ARM v4: add 5 new categories — Assets, Contracts, Usage Management,
-- Orchestration (DRO), and Cost Books.

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
    -- ARM v1+v2+v3
    'arm_product_catalog', 'arm_selling_models', 'arm_price_adjustments',
    'arm_attribute_pricing', 'arm_bundles', 'arm_pricing_procedures',
    'arm_price_books', 'arm_decision_tables', 'arm_context_service',
    'arm_rate_cards', 'arm_attributes',
    -- ARM v4
    'arm_assets', 'arm_contracts', 'arm_usage_management',
    'arm_orchestration', 'arm_cost_books'
  ));

insert into public.schema_migrations (version) values ('20260430230000_arm_v4_assets_contracts_usage_dro_costbooks')
on conflict (version) do nothing;
