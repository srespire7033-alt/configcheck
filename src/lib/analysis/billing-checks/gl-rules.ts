import type { BillingData, BillingHealthCheck, Issue } from '@/types';

export const glRuleChecks: BillingHealthCheck[] = [
  {
    id: 'GL-001',
    name: 'GL Treatment Missing GL Account',
    category: 'gl_rules',
    severity: 'critical',
    description: 'Finds GL treatments where both credit and debit GL accounts are null',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const missingAccounts = data.glTreatments.filter(
        t => t.blng__Active__c && !t.blng__CreditGLAccount__c && !t.blng__DebitGLAccount__c
      );

      if (missingAccounts.length > 0) {
        issues.push({
          check_id: 'GL-001',
          category: 'gl_rules',
          severity: 'critical',
          title: 'GL treatments with no GL accounts',
          description: `${missingAccounts.length} active GL treatment(s) have neither credit nor debit GL accounts mapped. Financial transactions will not be recorded properly.`,
          impact: 'Revenue, billing, and tax transactions will fail to post to the general ledger.',
          recommendation: 'Map appropriate credit and debit GL accounts to each active GL treatment.',
          affected_records: missingAccounts.slice(0, 50).map(t => ({
            id: t.Id,
            name: t.Name,
            type: 'blng__GLTreatment__c',
          })),
          effort_hours: missingAccounts.length * 0.25,
        });
      }

      return issues;
    },
  },
  {
    id: 'GL-002',
    name: 'GL Rule Without Treatments',
    category: 'gl_rules',
    severity: 'critical',
    description: 'Finds active GL rules that have no GL treatments mapped',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const rulesWithoutTreatments = data.glRules.filter(r => {
        if (!r.blng__Active__c) return false;
        const treatmentCount = r.blng__GLTreatments__r?.totalSize || 0;
        return treatmentCount === 0;
      });

      if (rulesWithoutTreatments.length > 0) {
        issues.push({
          check_id: 'GL-002',
          category: 'gl_rules',
          severity: 'critical',
          title: 'GL rules with no treatments',
          description: `${rulesWithoutTreatments.length} active GL rule(s) have no GL treatments configured. These rules serve no purpose without treatments.`,
          impact: 'Financial transactions referencing these rules will not have GL account mappings.',
          recommendation: 'Create GL treatments for each GL rule with appropriate account mappings.',
          affected_records: rulesWithoutTreatments.slice(0, 50).map(r => ({
            id: r.Id,
            name: r.Name,
            type: 'blng__GLRule__c',
          })),
          effort_hours: rulesWithoutTreatments.length * 0.5,
        });
      }

      return issues;
    },
  },
  {
    id: 'GL-003',
    name: 'Inactive GL Treatments on Active Rules',
    category: 'gl_rules',
    severity: 'warning',
    description: 'Finds inactive GL treatments under active GL rules',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const activeRuleIds = new Set(data.glRules.filter(r => r.blng__Active__c).map(r => r.Id));
      const inactiveOnActive = data.glTreatments.filter(
        t => !t.blng__Active__c && t.blng__GLRule__c && activeRuleIds.has(t.blng__GLRule__c)
      );

      if (inactiveOnActive.length > 0) {
        issues.push({
          check_id: 'GL-003',
          category: 'gl_rules',
          severity: 'warning',
          title: 'Inactive GL treatments on active GL rules',
          description: `${inactiveOnActive.length} inactive GL treatment(s) exist under active GL rules. Certain transaction types may not post to GL.`,
          impact: 'If a transaction matches only inactive treatments, GL posting will silently fail.',
          recommendation: 'Review and reactivate necessary treatments or remove them if no longer needed.',
          affected_records: inactiveOnActive.slice(0, 50).map(t => ({
            id: t.Id,
            name: t.Name,
            type: 'blng__GLTreatment__c',
          })),
          effort_hours: inactiveOnActive.length * 0.15,
        });
      }

      return issues;
    },
  },
  {
    id: 'GL-004',
    name: 'GL Treatment Missing One Side',
    category: 'gl_rules',
    severity: 'warning',
    description: 'Finds GL treatments where only credit OR debit account is set',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const oneSided = data.glTreatments.filter(t => {
        if (!t.blng__Active__c) return false;
        const hasCredit = !!t.blng__CreditGLAccount__c;
        const hasDebit = !!t.blng__DebitGLAccount__c;
        return (hasCredit && !hasDebit) || (!hasCredit && hasDebit);
      });

      if (oneSided.length > 0) {
        issues.push({
          check_id: 'GL-004',
          category: 'gl_rules',
          severity: 'warning',
          title: 'GL treatments with only one account mapped',
          description: `${oneSided.length} active GL treatment(s) have only a credit or debit account mapped, not both. Double-entry bookkeeping requires both sides.`,
          impact: 'Journal entries may be unbalanced, causing GL reconciliation issues.',
          recommendation: 'Map both credit and debit GL accounts on each treatment.',
          affected_records: oneSided.slice(0, 50).map(t => ({
            id: t.Id,
            name: t.Name,
            type: 'blng__GLTreatment__c',
          })),
          effort_hours: oneSided.length * 0.15,
        });
      }

      return issues;
    },
  },
  {
    id: 'GL-005',
    name: 'Inactive GL Rules Cleanup',
    category: 'gl_rules',
    severity: 'info',
    description: 'Inactive GL rules that add maintenance overhead',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const inactive = data.glRules.filter(r => !r.blng__Active__c);

      if (inactive.length > 0) {
        issues.push({
          check_id: 'GL-005',
          category: 'gl_rules',
          severity: 'info',
          title: `${inactive.length} inactive GL rule(s)`,
          description: `${inactive.length} GL rule(s) are inactive: ${inactive.slice(0, 5).map(r => `"${r.Name}"`).join(', ')}${inactive.length > 5 ? ` and ${inactive.length - 5} more` : ''}.`,
          impact: 'Inactive GL rules clutter the org and may confuse admins.',
          recommendation: 'Delete inactive GL rules that are no longer needed.',
          affected_records: inactive.slice(0, 10).map(r => ({
            id: r.Id,
            name: r.Name,
            type: 'blng__GLRule__c',
          })),
          effort_hours: inactive.length * 0.1,
        });
      }

      return issues;
    },
  },
];
