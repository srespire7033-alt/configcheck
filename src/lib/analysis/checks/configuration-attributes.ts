import type { HealthCheck, CPQData, Issue } from '@/types';

export const configurationAttributeChecks: HealthCheck[] = [
  // CA-001: Hidden and Required Attributes
  {
    id: 'CA-001',
    name: 'Hidden Required Configuration Attributes',
    category: 'configuration_attributes',
    severity: 'critical',
    description: 'Configuration attributes that are both required and hidden',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const hiddenRequired = data.configurationAttributes.filter(
        (a) => a.SBQQ__Required__c && a.SBQQ__Hidden__c
      );

      for (const attr of hiddenRequired) {
        const productName = attr.SBQQ__Product__r?.Name || attr.SBQQ__Product__c || 'Unknown';
        issues.push({
          check_id: 'CA-001',
          category: 'configuration_attributes',
          severity: 'critical',
          title: `Attribute "${attr.Name}" is both hidden and required`,
          description: `"${attr.Name}" on product "${productName}" is marked as Required but also Hidden. Users cannot see or fill in a hidden field, making it impossible to configure the product.`,
          impact: 'Product configuration will fail or block users. They cannot proceed past the configurator.',
          recommendation: `Either make "${attr.Name}" visible (uncheck Hidden) or remove the Required flag. If a default value is always used, set the Default Field.`,
          affected_records: [{ id: attr.Id, name: attr.Name, type: 'SBQQ__ConfigurationAttribute__c' }],
        });
      }

      return issues;
    },
  },

  // CA-002: Attributes Without Target Field
  {
    id: 'CA-002',
    name: 'Configuration Attributes Missing Target Field',
    category: 'configuration_attributes',
    severity: 'warning',
    description: 'Configuration attributes with no target field mapped',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const noTarget = data.configurationAttributes.filter((a) => !a.SBQQ__TargetField__c);

      if (noTarget.length > 0) {
        // Group by product for cleaner output
        const byProduct: Record<string, typeof noTarget> = {};
        for (const attr of noTarget) {
          const productName = attr.SBQQ__Product__r?.Name || attr.SBQQ__Product__c || 'Unknown';
          if (!byProduct[productName]) byProduct[productName] = [];
          byProduct[productName].push(attr);
        }

        for (const [productName, attrs] of Object.entries(byProduct)) {
          issues.push({
            check_id: 'CA-002',
            category: 'configuration_attributes',
            severity: 'warning',
            title: `${attrs.length} attribute(s) on "${productName}" missing target field`,
            description: `${attrs.map((a) => `"${a.Name}"`).join(', ')} on product "${productName}" have no Target Field set. The user's selection in the configurator won't be saved anywhere.`,
            impact: 'Configuration data entered by users is lost. Product options may not be applied correctly.',
            recommendation: 'Map each attribute to a Target Field on the quote line so the selected value is persisted.',
            affected_records: attrs.map((a) => ({
              id: a.Id,
              name: a.Name,
              type: 'SBQQ__ConfigurationAttribute__c',
            })),
          });
        }
      }

      return issues;
    },
  },

  // CA-003: Duplicate Attribute Names on Same Product
  {
    id: 'CA-003',
    name: 'Duplicate Configuration Attribute Names',
    category: 'configuration_attributes',
    severity: 'warning',
    description: 'Multiple configuration attributes with the same name on the same product',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      // Group by product + attribute name
      const groups: Record<string, typeof data.configurationAttributes> = {};
      for (const attr of data.configurationAttributes) {
        const key = `${attr.SBQQ__Product__c}|${attr.Name}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(attr);
      }

      for (const [key, attrs] of Object.entries(groups)) {
        if (attrs.length < 2) continue;
        const productName = attrs[0].SBQQ__Product__r?.Name || 'Unknown';
        issues.push({
          check_id: 'CA-003',
          category: 'configuration_attributes',
          severity: 'warning',
          title: `Duplicate attribute "${attrs[0].Name}" on "${productName}"`,
          description: `Product "${productName}" has ${attrs.length} configuration attributes all named "${attrs[0].Name}". This creates confusion in the configurator and may cause values to overwrite each other.`,
          impact: 'Users see duplicate fields in the product configurator. Saved values may be unpredictable.',
          recommendation: `Remove or rename the duplicate attributes on "${productName}". Each attribute should have a unique name.`,
          affected_records: attrs.map((a) => ({
            id: a.Id,
            name: a.Name,
            type: 'SBQQ__ConfigurationAttribute__c',
          })),
        });
      }

      return issues;
    },
  },

  // CA-004: Required Attributes Without Default
  {
    id: 'CA-004',
    name: 'Required Attributes Without Default Value',
    category: 'configuration_attributes',
    severity: 'info',
    description: 'Required configuration attributes that have no default value set',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const requiredNoDefault = data.configurationAttributes.filter(
        (a) => a.SBQQ__Required__c && !a.SBQQ__Hidden__c && !a.SBQQ__DefaultField__c
      );

      if (requiredNoDefault.length > 0) {
        const byProduct: Record<string, typeof requiredNoDefault> = {};
        for (const attr of requiredNoDefault) {
          const productName = attr.SBQQ__Product__r?.Name || 'Unknown';
          if (!byProduct[productName]) byProduct[productName] = [];
          byProduct[productName].push(attr);
        }

        for (const [productName, attrs] of Object.entries(byProduct)) {
          issues.push({
            check_id: 'CA-004',
            category: 'configuration_attributes',
            severity: 'info',
            title: `${attrs.length} required attribute(s) on "${productName}" without defaults`,
            description: `${attrs.map((a) => `"${a.Name}"`).join(', ')} on "${productName}" are required but have no default value. Users must manually fill these every time they configure the product.`,
            impact: 'Slows down configuration. Users may abandon if too many required fields have no defaults.',
            recommendation: 'Consider setting sensible default values for frequently used configurations.',
            affected_records: attrs.map((a) => ({
              id: a.Id,
              name: a.Name,
              type: 'SBQQ__ConfigurationAttribute__c',
            })),
          });
        }
      }

      return issues;
    },
  },
];
