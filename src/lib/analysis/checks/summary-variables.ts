import type { HealthCheck, CPQData, Issue } from '@/types';

export const summaryVariableChecks: HealthCheck[] = [
  // SV-001: Orphaned Summary Variables
  {
    id: 'SV-001',
    name: 'Orphaned Summary Variables',
    category: 'summary_variables',
    severity: 'warning',
    description: 'Active summary variables not referenced by any price rule or product rule',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const orphaned = data.summaryVariables.filter(
        (v) =>
          v.SBQQ__Active__c &&
          v.referencedByPriceRuleCount === 0 &&
          v.referencedByProductRuleCount === 0
      );

      if (orphaned.length > 0) {
        issues.push({
          check_id: 'SV-001',
          category: 'summary_variables',
          severity: 'warning',
          title: `${orphaned.length} summary variable(s) not used by any rule`,
          description: `${orphaned.map((v) => `"${v.Name}"`).join(', ')} ${orphaned.length === 1 ? 'is' : 'are'} active but not referenced by any price rule or product rule condition. These variables are computed on every quote calculation but their results are never used.`,
          impact:
            'Unnecessary CPU cycles on every quote save. Slows down quote calculation and adds maintenance confusion.',
          recommendation:
            'Either connect these variables to a rule condition, or deactivate them to improve quote calculation performance.',
          affected_records: orphaned.map((v) => ({
            id: v.Id,
            name: v.Name,
            type: 'SBQQ__SummaryVariable__c',
          })),
        });
      }

      return issues;
    },
  },

  // SV-002: Summary Variables Missing Aggregate Configuration
  {
    id: 'SV-002',
    name: 'Incomplete Summary Variable Configuration',
    category: 'summary_variables',
    severity: 'critical',
    description: 'Active summary variables missing required aggregate function or field',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const v of data.summaryVariables) {
        if (!v.SBQQ__Active__c) continue;

        const missing: string[] = [];
        if (!v.SBQQ__AggregateFunction__c) missing.push('Aggregate Function');
        if (!v.SBQQ__AggregateField__c) missing.push('Aggregate Field');
        if (!v.SBQQ__TargetObject__c) missing.push('Target Object');

        if (missing.length > 0) {
          issues.push({
            check_id: 'SV-002',
            category: 'summary_variables',
            severity: 'critical',
            title: `Summary variable "${v.Name}" missing ${missing.join(', ')}`,
            description: `"${v.Name}" is active but missing required configuration: ${missing.join(', ')}. Without these fields, the variable cannot compute a meaningful value.`,
            impact:
              'The variable returns null or zero, causing any rule that references it to evaluate incorrectly. May lead to wrong pricing or broken validations.',
            recommendation: `Open "${v.Name}" and set the ${missing.join(' and ')}. If this variable is no longer needed, deactivate it.`,
            affected_records: [
              { id: v.Id, name: v.Name, type: 'SBQQ__SummaryVariable__c' },
            ],
          });
        }
      }

      return issues;
    },
  },

  // SV-003: Duplicate Summary Variables
  {
    id: 'SV-003',
    name: 'Duplicate Summary Variables',
    category: 'summary_variables',
    severity: 'warning',
    description: 'Multiple active summary variables with the same aggregate function and field',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const active = data.summaryVariables.filter((v) => v.SBQQ__Active__c);

      // Group by function + field + target object + scope
      const groups: Record<string, typeof active> = {};
      for (const v of active) {
        if (!v.SBQQ__AggregateFunction__c || !v.SBQQ__AggregateField__c) continue;
        const key = `${v.SBQQ__AggregateFunction__c}|${v.SBQQ__AggregateField__c}|${v.SBQQ__TargetObject__c || ''}|${v.SBQQ__Scope__c || ''}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(v);
      }

      for (const [key, vars] of Object.entries(groups)) {
        if (vars.length < 2) continue;
        const [fn, field, target] = key.split('|');
        issues.push({
          check_id: 'SV-003',
          category: 'summary_variables',
          severity: 'warning',
          title: `${vars.length} duplicate summary variables computing ${fn}(${field})`,
          description: `${vars.map((v) => `"${v.Name}"`).join(', ')} all compute ${fn} of "${field}" on ${target || 'unknown object'}. This is redundant — the same result is calculated multiple times.`,
          impact:
            'Wastes quote calculation time and creates confusion about which variable to use in rule conditions.',
          recommendation: `Consolidate into a single summary variable and update all rule references to point to it. Deactivate the duplicates.`,
          affected_records: vars.map((v) => ({
            id: v.Id,
            name: v.Name,
            type: 'SBQQ__SummaryVariable__c',
          })),
        });
      }

      return issues;
    },
  },

  // SV-004: Filter Without Operator
  {
    id: 'SV-004',
    name: 'Summary Variable Filter Misconfiguration',
    category: 'summary_variables',
    severity: 'warning',
    description: 'Summary variables with partial filter configuration',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const v of data.summaryVariables) {
        if (!v.SBQQ__Active__c) continue;

        const hasFilterField = !!v.SBQQ__FilterField__c;
        const hasFilterValue = !!v.SBQQ__FilterValue__c;
        const hasOperator = !!v.SBQQ__Operator__c;

        // Partial filter: some filter fields set but not all
        if ((hasFilterField || hasFilterValue) && !(hasFilterField && hasFilterValue && hasOperator)) {
          const missing: string[] = [];
          if (!hasFilterField) missing.push('Filter Field');
          if (!hasFilterValue) missing.push('Filter Value');
          if (!hasOperator) missing.push('Operator');

          issues.push({
            check_id: 'SV-004',
            category: 'summary_variables',
            severity: 'warning',
            title: `Summary variable "${v.Name}" has incomplete filter`,
            description: `"${v.Name}" has a partial filter configured but is missing: ${missing.join(', ')}. The filter may not work as intended, causing the variable to aggregate over wrong records.`,
            impact:
              'Variable may return incorrect values — either too broad (no filter applied) or error out silently.',
            recommendation: `Complete the filter configuration on "${v.Name}" by setting the ${missing.join(' and ')}.`,
            affected_records: [
              { id: v.Id, name: v.Name, type: 'SBQQ__SummaryVariable__c' },
            ],
          });
        }
      }

      return issues;
    },
  },

  // SV-005: Composite Variable Missing Second Operand
  {
    id: 'SV-005',
    name: 'Composite Variable Missing Operand',
    category: 'summary_variables',
    severity: 'critical',
    description: 'Composite summary variables missing the second operand or operator',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const v of data.summaryVariables) {
        if (!v.SBQQ__Active__c) continue;
        if (!v.SBQQ__CombineWith__c && !v.SBQQ__CompositeOperator__c) continue;

        const missing: string[] = [];
        if (v.SBQQ__CombineWith__c && !v.SBQQ__CompositeOperator__c) {
          missing.push('Composite Operator');
        }
        if (v.SBQQ__CompositeOperator__c && !v.SBQQ__CombineWith__c) {
          missing.push('Combine With (second variable)');
        }

        if (missing.length > 0) {
          issues.push({
            check_id: 'SV-005',
            category: 'summary_variables',
            severity: 'critical',
            title: `Composite variable "${v.Name}" missing ${missing.join(', ')}`,
            description: `"${v.Name}" is configured as a composite variable but is missing: ${missing.join(', ')}. The composite calculation cannot produce a valid result.`,
            impact:
              'Returns null or incorrect values. Any rule referencing this variable will malfunction.',
            recommendation: `Set the ${missing.join(' and ')} on "${v.Name}", or remove the composite configuration if it was set by mistake.`,
            affected_records: [
              { id: v.Id, name: v.Name, type: 'SBQQ__SummaryVariable__c' },
            ],
          });
        }
      }

      return issues;
    },
  },
];
