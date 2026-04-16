import type { HealthCheck, CPQData, Issue } from '@/types';

export const lookupQueryChecks: HealthCheck[] = [
  // LQ-001: Incomplete Price Rule Lookups
  {
    id: 'LQ-001',
    name: 'Incomplete Price Rule Lookups',
    category: 'lookup_queries',
    severity: 'critical',
    description: 'Price rule has a lookup object configured but no action uses the source lookup field',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const activeRules = data.priceRules.filter(
        (r) => r.SBQQ__Active__c && r.SBQQ__LookupObject__c
      );

      for (const rule of activeRules) {
        const actions = rule.SBQQ__PriceActions__r?.records || [];
        const hasLookupAction = actions.some((a) => a.SBQQ__SourceLookupField__c);

        if (!hasLookupAction) {
          issues.push({
            check_id: 'LQ-001',
            category: 'lookup_queries',
            severity: 'critical',
            title: `Price rule lookup incomplete on "${rule.Name}"`,
            description: `"${rule.Name}" has Lookup Object = "${rule.SBQQ__LookupObject__c}" but none of its actions use a Source Lookup Field. The lookup is configured but never used, so the rule won't pull values from the lookup object.`,
            impact: 'Pricing logic silently skips the lookup — quotes may use hardcoded or null values instead of dynamic lookup values.',
            recommendation: `Add a Source Lookup Field to at least one action in "${rule.Name}", or remove the Lookup Object if it's not needed.`,
            affected_records: [{ id: rule.Id, name: rule.Name, type: 'SBQQ__PriceRule__c' }],
          });
        }
      }

      return issues;
    },
  },

  // LQ-002: Orphaned Lookup References
  {
    id: 'LQ-002',
    name: 'Orphaned Lookup References',
    category: 'lookup_queries',
    severity: 'critical',
    description: 'Price action uses source lookup field but rule has no lookup object configured',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const activeRules = data.priceRules.filter((r) => r.SBQQ__Active__c);

      for (const rule of activeRules) {
        if (rule.SBQQ__LookupObject__c) continue; // Has lookup object — fine

        const actions = rule.SBQQ__PriceActions__r?.records || [];
        const lookupActions = actions.filter((a) => a.SBQQ__SourceLookupField__c);

        if (lookupActions.length > 0) {
          issues.push({
            check_id: 'LQ-002',
            category: 'lookup_queries',
            severity: 'critical',
            title: `Orphaned lookup field on "${rule.Name}"`,
            description: `"${rule.Name}" has ${lookupActions.length} action(s) referencing Source Lookup Field "${lookupActions[0].SBQQ__SourceLookupField__c}" but the rule has no Lookup Object configured. The lookup has no source to query.`,
            impact: 'Actions will return null values from the lookup, potentially zeroing out pricing fields.',
            recommendation: `Set the Lookup Object on "${rule.Name}" to the object containing "${lookupActions[0].SBQQ__SourceLookupField__c}", or remove the Source Lookup Field from the action.`,
            affected_records: [{ id: rule.Id, name: rule.Name, type: 'SBQQ__PriceRule__c' }],
          });
        }
      }

      return issues;
    },
  },

  // LQ-003: Selection Rules Missing Target Product
  {
    id: 'LQ-003',
    name: 'Selection Rules Missing Target Product',
    category: 'lookup_queries',
    severity: 'warning',
    description: 'Selection-type product rules with Add/Remove actions but no target product specified',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const selectionRules = data.productRules.filter(
        (r) => r.SBQQ__Active__c && r.SBQQ__Type__c === 'Selection'
      );

      for (const rule of selectionRules) {
        const actions = rule.SBQQ__Actions__r?.records || [];
        const missingProduct = actions.filter(
          (a) =>
            (a.SBQQ__Type__c === 'Add' || a.SBQQ__Type__c === 'Remove' ||
             a.SBQQ__Type__c === 'Enable & Add' || a.SBQQ__Type__c === 'Disable & Remove') &&
            !a.SBQQ__Product__c
        );

        if (missingProduct.length > 0) {
          // Only flag if the rule doesn't use a lookup (lookup-based selections don't need static products)
          if (rule.SBQQ__LookupObject__c) continue;

          issues.push({
            check_id: 'LQ-003',
            category: 'lookup_queries',
            severity: 'warning',
            title: `Selection rule "${rule.Name}" has action without target product`,
            description: `"${rule.Name}" has ${missingProduct.length} selection action(s) of type "${missingProduct[0].SBQQ__Type__c}" but no target product is specified and no lookup object is configured. The action cannot select any product.`,
            impact: 'Selection rule fires but does nothing — configurator behaves as if the rule doesn\'t exist.',
            recommendation: `Set a target Product on the action(s) in "${rule.Name}", or configure a Lookup Object for dynamic product selection.`,
            affected_records: [{ id: rule.Id, name: rule.Name, type: 'SBQQ__ProductRule__c' }],
          });
        }
      }

      return issues;
    },
  },

  // LQ-004: Selection Rules Targeting Inactive Products
  {
    id: 'LQ-004',
    name: 'Selection Rules Targeting Inactive Products',
    category: 'lookup_queries',
    severity: 'warning',
    description: 'Active selection rules that add or remove inactive products',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const activeProductIds = new Set(
        data.products.filter((p) => p.IsActive).map((p) => p.Id)
      );

      const selectionRules = data.productRules.filter(
        (r) => r.SBQQ__Active__c && r.SBQQ__Type__c === 'Selection'
      );

      for (const rule of selectionRules) {
        const actions = rule.SBQQ__Actions__r?.records || [];

        for (const action of actions) {
          if (!action.SBQQ__Product__c) continue;

          // Check if product is inactive (either from relationship or products array)
          const isInactive =
            action.SBQQ__Product__r?.IsActive === false ||
            (!action.SBQQ__Product__r && !activeProductIds.has(action.SBQQ__Product__c));

          if (isInactive) {
            const productName = action.SBQQ__Product__r?.Name || action.SBQQ__Product__c;
            issues.push({
              check_id: 'LQ-004',
              category: 'lookup_queries',
              severity: 'warning',
              title: `Selection rule targets inactive product "${productName}"`,
              description: `"${rule.Name}" has a "${action.SBQQ__Type__c}" action targeting "${productName}" which is inactive. The rule will try to add/remove a product that can't be used on quotes.`,
              impact: 'Configurator errors when the selection rule fires, or the action is silently ignored.',
              recommendation: `Either reactivate "${productName}" or update the action in "${rule.Name}" to target an active product.`,
              affected_records: [
                { id: rule.Id, name: rule.Name, type: 'SBQQ__ProductRule__c' },
              ],
            });
          }
        }
      }

      return issues;
    },
  },
];
