import type { HealthCheck, CPQData, Issue } from '@/types';

export const guidedSellingChecks: HealthCheck[] = [
  // GS-001: Guided Selling Without Inputs
  {
    id: 'GS-001',
    name: 'Guided Selling Without Inputs',
    category: 'guided_selling',
    severity: 'critical',
    description: 'Active guided selling processes with no input questions',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const proc of data.guidedSellingProcesses) {
        if (!proc.SBQQ__Active__c) continue;

        if (proc.inputCount === 0) {
          issues.push({
            check_id: 'GS-001',
            category: 'guided_selling',
            severity: 'critical',
            title: `Guided selling "${proc.Name}" has no input questions`,
            description: `"${proc.Name}" is active but has no input questions configured. The guided selling wizard will show an empty page with nothing for the user to answer.`,
            impact: 'Broken user experience. Users see a blank guided selling page and cannot proceed meaningfully.',
            recommendation: `Add input questions to "${proc.Name}" to gather user requirements, or deactivate it if not needed.`,
            affected_records: [{ id: proc.Id, name: proc.Name, type: 'SBQQ__GuidedSellingProcess__c' }],
          });
        }
      }

      return issues;
    },
  },

  // GS-002: Guided Selling Without Outputs
  {
    id: 'GS-002',
    name: 'Guided Selling Without Outputs',
    category: 'guided_selling',
    severity: 'critical',
    description: 'Active guided selling processes with no product outputs',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const proc of data.guidedSellingProcesses) {
        if (!proc.SBQQ__Active__c) continue;

        if (proc.outputCount === 0) {
          issues.push({
            check_id: 'GS-002',
            category: 'guided_selling',
            severity: 'critical',
            title: `Guided selling "${proc.Name}" has no product outputs`,
            description: `"${proc.Name}" is active and may have input questions, but has no output mappings. After the user answers questions, no products will be suggested.`,
            impact: 'Users go through the guided selling wizard but get no product recommendations — a dead-end experience.',
            recommendation: `Add output records to "${proc.Name}" to map user answers to product suggestions.`,
            affected_records: [{ id: proc.Id, name: proc.Name, type: 'SBQQ__GuidedSellingProcess__c' }],
          });
        }
      }

      return issues;
    },
  },

  // GS-003: Inactive Guided Selling Processes
  {
    id: 'GS-003',
    name: 'Inactive Guided Selling Processes',
    category: 'guided_selling',
    severity: 'info',
    description: 'Guided selling processes that are not active',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const inactive = data.guidedSellingProcesses.filter((p) => !p.SBQQ__Active__c);

      if (inactive.length > 0) {
        issues.push({
          check_id: 'GS-003',
          category: 'guided_selling',
          severity: 'info',
          title: `${inactive.length} inactive guided selling process(es)`,
          description: `${inactive.map((p) => `"${p.Name}"`).join(', ')} ${inactive.length === 1 ? 'is' : 'are'} not active. These processes exist but won't appear in the guided selling wizard.`,
          impact: 'Dead configuration. May confuse admins reviewing the setup.',
          recommendation: 'Either activate processes that should be in use, or delete them to keep the org clean.',
          affected_records: inactive.map((p) => ({
            id: p.Id,
            name: p.Name,
            type: 'SBQQ__GuidedSellingProcess__c',
          })),
        });
      }

      return issues;
    },
  },

  // GS-004: Low Input-to-Output Ratio
  {
    id: 'GS-004',
    name: 'Guided Selling Low Output Ratio',
    category: 'guided_selling',
    severity: 'warning',
    description: 'Active guided selling process with many inputs but very few outputs',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const proc of data.guidedSellingProcesses) {
        if (!proc.SBQQ__Active__c) continue;
        if (proc.inputCount >= 5 && proc.outputCount > 0 && proc.outputCount <= 1) {
          issues.push({
            check_id: 'GS-004',
            category: 'guided_selling',
            severity: 'warning',
            title: `Guided selling "${proc.Name}" has ${proc.inputCount} inputs but only ${proc.outputCount} output`,
            description: `"${proc.Name}" asks ${proc.inputCount} questions but only maps to ${proc.outputCount} product output(s). Users answer many questions to get minimal product suggestions — poor ROI on the guided selling experience.`,
            impact: 'Users may perceive the guided selling wizard as tedious and skip it, defeating its purpose.',
            recommendation: `Review "${proc.Name}" — either add more output mappings or reduce the number of input questions to improve the user experience.`,
            affected_records: [{ id: proc.Id, name: proc.Name, type: 'SBQQ__GuidedSellingProcess__c' }],
          });
        }
      }

      return issues;
    },
  },
];
