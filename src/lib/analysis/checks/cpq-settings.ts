import type { HealthCheck, CPQData, Issue } from '@/types';

export const cpqSettingsChecks: HealthCheck[] = [
  // SET-001: Triggers Disabled
  {
    id: 'SET-001',
    name: 'CPQ Triggers Disabled',
    category: 'cpq_settings',
    severity: 'critical',
    description: 'SBQQ TriggerControl is disabled - all CPQ automation stopped',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      if (data.cpqSettings?.SBQQ__TriggerDisabled__c === true) {
        issues.push({
          check_id: 'SET-001',
          category: 'cpq_settings',
          severity: 'critical',
          title: 'CPQ Triggers are DISABLED',
          description: 'SBQQ__TriggerDisabled__c is set to TRUE. This disables ALL CPQ managed package triggers. Quotes will not calculate properly, subscriptions will not be created from contracts, and renewal processes will fail.',
          impact: 'Entire CPQ automation is broken. This is often left disabled after a deployment or data migration and forgotten.',
          recommendation: 'Re-enable CPQ triggers immediately. Go to Setup → Custom Settings → SBQQ__GeneralSettings__c → set TriggerDisabled to FALSE. Verify quote calculations work afterward.',
          affected_records: [],
        });
      }

      return issues;
    },
  },

  // SET-002: Quote Calculator Plugin Detected
  {
    id: 'SET-002',
    name: 'Quote Calculator Plugin Detected',
    category: 'cpq_settings',
    severity: 'info',
    description: 'A custom Quote Calculator Plugin (QCP) is overriding standard pricing',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const settings = data.cpqSettings as Record<string, unknown> | null;

      if (settings?.hasQuoteCalculatorPlugin === true) {
        issues.push({
          check_id: 'SET-002',
          category: 'cpq_settings',
          severity: 'info',
          title: 'Custom Quote Calculator Plugin is active',
          description: 'A Quote Calculator Plugin (QCP) is configured. This JavaScript code runs during quote calculation and can override standard pricing logic including NetPrice, List Price, and custom fields.',
          impact: 'Any pricing issue could be caused by the QCP rather than standard CPQ configuration. The QCP must be reviewed separately.',
          recommendation: 'When debugging pricing issues, always check the QCP code first. Standard Price Rules and Discount Schedules may be overridden by the plugin.',
          affected_records: [],
        });
      }

      return issues;
    },
  },
];
