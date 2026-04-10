import type { HealthCheck, CPQData, Issue } from '@/types';

export const impactAnalysisChecks: HealthCheck[] = [
  // IA-001: Price Rule Dependency Chains
  {
    id: 'IA-001',
    name: 'Price Rule Dependency Chains',
    category: 'impact_analysis',
    severity: 'warning',
    description: 'Price rules that depend on fields set by other price rules, creating execution order dependencies',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const activeRules = data.priceRules.filter((r) => r.SBQQ__Active__c);

      // Build a map of which fields each rule writes to
      const ruleWrites: Record<string, string[]> = {};
      for (const rule of activeRules) {
        const actions = rule.SBQQ__PriceActions__r?.records || [];
        ruleWrites[rule.Id] = actions.map((a) => a.SBQQ__Field__c).filter((f): f is string => Boolean(f));
      }

      // Check if any rule's conditions read from fields that another rule writes to
      const chains: { reader: string; readerName: string; writer: string; writerName: string; field: string }[] = [];
      for (const rule of activeRules) {
        const conditions = rule.SBQQ__PriceConditions__r?.records || [];
        for (const cond of conditions) {
          const testedField = cond.SBQQ__Field__c;
          if (!testedField) continue;

          for (const otherRule of activeRules) {
            if (otherRule.Id === rule.Id) continue;
            if (ruleWrites[otherRule.Id]?.includes(testedField)) {
              chains.push({
                reader: rule.Id,
                readerName: rule.Name,
                writer: otherRule.Id,
                writerName: otherRule.Name,
                field: testedField,
              });
            }
          }
        }
      }

      if (chains.length > 0) {
        const uniquePairs = new Set(chains.map((c) => `${c.writer}->${c.reader}`));
        issues.push({
          check_id: 'IA-001',
          category: 'impact_analysis',
          severity: chains.length >= 5 ? 'critical' : 'warning',
          title: `${uniquePairs.size} price rule dependency chain(s) detected`,
          description: `Found ${chains.length} dependencies where one rule reads a field that another rule writes. Examples: ${chains.slice(0, 3).map((c) => `"${c.writerName}" writes ${c.field} → "${c.readerName}" reads it`).join('; ')}. Changing evaluation order may break pricing.`,
          impact: 'Modifying or deactivating any rule in these chains may cause cascading pricing changes across dependent rules.',
          recommendation: 'Document the dependency chain. Test in sandbox before changing evaluation order. Consider consolidating chained rules into a single rule or QCP.',
          affected_records: chains.slice(0, 10).map((c) => ({
            id: c.writer,
            name: `${c.writerName} → ${c.readerName} (${c.field})`,
            type: 'SBQQ__PriceRule__c',
          })),
        });
      }

      return issues;
    },
  },

  // IA-002: Overlapping Rule Scope
  {
    id: 'IA-002',
    name: 'Overlapping Rule Scope',
    category: 'impact_analysis',
    severity: 'warning',
    description: 'Multiple active rules that could apply to the same products or conditions',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const activeRules = data.priceRules.filter((r) => r.SBQQ__Active__c);

      // Group rules by target field
      const rulesByField: Record<string, typeof activeRules> = {};
      for (const rule of activeRules) {
        const actions = rule.SBQQ__PriceActions__r?.records || [];
        for (const action of actions) {
          const field = action.SBQQ__Field__c;
          if (!field) continue;
          if (!rulesByField[field]) rulesByField[field] = [];
          rulesByField[field].push(rule);
        }
      }

      // Flag fields targeted by 4+ rules (3+ was PR-004, this is higher threshold)
      for (const [field, rules] of Object.entries(rulesByField)) {
        if (rules.length >= 4) {
          issues.push({
            check_id: 'IA-002',
            category: 'impact_analysis',
            severity: rules.length >= 6 ? 'critical' : 'warning',
            title: `${rules.length} rules compete for ${field}`,
            description: `${rules.length} active price rules write to ${field}. With this many rules targeting the same field, the final value depends entirely on evaluation order. Any change to one rule may have unexpected downstream effects.`,
            impact: `Changing any of these ${rules.length} rules requires testing all of them together. Risk of unintended pricing changes is high.`,
            recommendation: 'Map out which products/scenarios each rule covers. Consider consolidating into fewer rules with more specific conditions. Document the intended execution flow.',
            affected_records: rules.map((r) => ({
              id: r.Id,
              name: `${r.Name} (order: ${r.SBQQ__EvaluationOrder__c || 'none'})`,
              type: 'SBQQ__PriceRule__c',
            })),
          });
        }
      }

      return issues;
    },
  },

  // IA-003: Discount Schedule + Price Rule Conflict
  {
    id: 'IA-003',
    name: 'Discount Schedule and Price Rule Overlap',
    category: 'impact_analysis',
    severity: 'warning',
    description: 'Products with both discount schedules and price rules that modify the same pricing fields',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      // Discount schedules exist if any are defined
      const hasDiscountSchedules = data.discountSchedules.length > 0;

      // Get fields that price rules write to
      const priceRuleTargetFields = new Set<string>();
      for (const rule of data.priceRules.filter((r) => r.SBQQ__Active__c)) {
        const actions = rule.SBQQ__PriceActions__r?.records || [];
        for (const a of actions) {
          if (a.SBQQ__Field__c) priceRuleTargetFields.add(a.SBQQ__Field__c);
        }
      }

      // Discount schedules typically affect SBQQ__Discount__c or SBQQ__UnitPrice__c
      const discountFields = ['SBQQ__Discount__c', 'SBQQ__UnitPrice__c', 'SBQQ__NetPrice__c'];
      const overlappingFields = discountFields.filter((f) => priceRuleTargetFields.has(f));

      if (hasDiscountSchedules && overlappingFields.length > 0) {
        issues.push({
          check_id: 'IA-003',
          category: 'impact_analysis',
          severity: 'warning',
          title: `Discount schedules and price rules both modify ${overlappingFields.join(', ')}`,
          description: `${data.discountSchedules.length} discount schedule(s) exist, and active price rules also target ${overlappingFields.join(', ')}. The CPQ calculator evaluation sequence determines which takes precedence. Check SET-001 for the current sequence.`,
          impact: 'Depending on Calculator Evaluation Sequence setting, discounts may be overwritten by price rules or vice versa. This is a common source of "why is my discount not applying" bugs.',
          recommendation: 'Verify SBQQ__CalculatorEvaluationSequence__c setting. Test with a sample quote to confirm the intended pricing flow. Document which method (discount schedule vs price rule) should take precedence for each product.',
          affected_records: [],
        });
      }

      return issues;
    },
  },

  // IA-004: Orphaned Configuration Dependencies
  {
    id: 'IA-004',
    name: 'Orphaned Configuration References',
    category: 'impact_analysis',
    severity: 'warning',
    description: 'Rules or schedules referencing products or fields that no longer exist or are inactive',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const activeProductIds = new Set(data.products.filter((p) => p.IsActive).map((p) => p.Id));

      // Check contracted prices linked to inactive products
      const orphanedCP = data.contractedPrices.filter(
        (cp) => cp.SBQQ__Product__c && !activeProductIds.has(cp.SBQQ__Product__c)
      );

      if (orphanedCP.length > 0) {
        issues.push({
          check_id: 'IA-004',
          category: 'impact_analysis',
          severity: 'warning',
          title: `${orphanedCP.length} contracted price(s) linked to inactive products`,
          description: `Found ${orphanedCP.length} contracted price(s) attached to products that are no longer active. These prices will never apply but may confuse admins reviewing the configuration.`,
          impact: 'Configuration clutter. Contracted prices for inactive products waste lookup cycles and may confuse deal desk.',
          recommendation: 'Review and remove contracted prices for retired products.',
          affected_records: orphanedCP.slice(0, 10).map((cp) => ({
            id: cp.Id,
            name: cp.Name,
            type: 'SBQQ__ContractedPrice__c',
          })),
        });
      }

      return issues;
    },
  },
];
