import type { HealthCheck, CPQData, Issue } from '@/types';

export const quoteTemplateChecks: HealthCheck[] = [
  // QT-001: No Default Quote Template
  {
    id: 'QT-001',
    name: 'No Default Quote Template',
    category: 'quote_templates',
    severity: 'warning',
    description: 'No quote template is marked as default',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      if (data.quoteTemplates.length === 0) return issues;

      const hasDefault = data.quoteTemplates.some((t) => t.SBQQ__Default__c);

      if (!hasDefault) {
        issues.push({
          check_id: 'QT-001',
          category: 'quote_templates',
          severity: 'warning',
          title: 'No default quote template set',
          description: `There are ${data.quoteTemplates.length} quote template(s) but none is marked as Default. Users must manually select a template every time they generate a quote document.`,
          impact: 'Extra clicks for every quote. Users may forget to select a template or pick the wrong one.',
          recommendation: 'Mark the most commonly used template as Default to streamline quote document generation.',
          affected_records: data.quoteTemplates.map((t) => ({
            id: t.Id,
            name: t.Name,
            type: 'SBQQ__QuoteTemplate__c',
          })),
        });
      }

      return issues;
    },
  },

  // QT-002: Inactive/Draft Quote Templates
  {
    id: 'QT-002',
    name: 'Non-Active Quote Templates',
    category: 'quote_templates',
    severity: 'info',
    description: 'Quote templates in Draft or Inactive status',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const nonActive = data.quoteTemplates.filter(
        (t) => t.SBQQ__Status__c && t.SBQQ__Status__c !== 'Active'
      );

      if (nonActive.length > 0) {
        issues.push({
          check_id: 'QT-002',
          category: 'quote_templates',
          severity: 'info',
          title: `${nonActive.length} non-active quote template(s)`,
          description: `${nonActive.map((t) => `"${t.Name}" (${t.SBQQ__Status__c})`).join(', ')} ${nonActive.length === 1 ? 'is' : 'are'} not in Active status.`,
          impact: 'Non-active templates add clutter. If important templates are accidentally left in Draft, they cannot be used.',
          recommendation: 'Either activate templates that are ready for use, or delete draft templates that are no longer needed.',
          affected_records: nonActive.map((t) => ({
            id: t.Id,
            name: t.Name,
            type: 'SBQQ__QuoteTemplate__c',
          })),
        });
      }

      return issues;
    },
  },

  // QT-003: Quote Templates Without Sections
  {
    id: 'QT-003',
    name: 'Empty Quote Templates',
    category: 'quote_templates',
    severity: 'warning',
    description: 'Quote templates with no sections configured',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const template of data.quoteTemplates) {
        const sections = template.SBQQ__TemplateSections__r?.records || [];

        if (sections.length === 0) {
          issues.push({
            check_id: 'QT-003',
            category: 'quote_templates',
            severity: 'warning',
            title: `Quote template "${template.Name}" has no sections`,
            description: `"${template.Name}" exists but has no template sections configured. Generating a document from this template will produce a blank or minimal PDF.`,
            impact: 'Users may generate empty quote documents and lose credibility with prospects.',
            recommendation: `Add sections (header, line items, terms, signature) to "${template.Name}" or delete it if unused.`,
            affected_records: [{ id: template.Id, name: template.Name, type: 'SBQQ__QuoteTemplate__c' }],
          });
        }
      }

      return issues;
    },
  },

  // QT-004: Multiple Default Templates
  {
    id: 'QT-004',
    name: 'Multiple Default Templates',
    category: 'quote_templates',
    severity: 'warning',
    description: 'More than one quote template marked as default',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const defaults = data.quoteTemplates.filter((t) => t.SBQQ__Default__c);

      if (defaults.length > 1) {
        issues.push({
          check_id: 'QT-004',
          category: 'quote_templates',
          severity: 'warning',
          title: `${defaults.length} templates marked as default`,
          description: `${defaults.map((t) => `"${t.Name}"`).join(', ')} are all marked as Default. Only one template should be the default.`,
          impact: 'Unpredictable behavior when auto-selecting template. Users may get the wrong template applied.',
          recommendation: 'Choose one primary template as the Default and uncheck Default on the others.',
          affected_records: defaults.map((t) => ({
            id: t.Id,
            name: t.Name,
            type: 'SBQQ__QuoteTemplate__c',
          })),
        });
      }

      return issues;
    },
  },
];
